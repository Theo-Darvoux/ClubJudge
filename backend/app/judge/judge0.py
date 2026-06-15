import asyncio
import base64

import httpx

from app.judge.base import Judge
from app.judge.types import (
    JudgeResult,
    Language,
    RunOutput,
    RunResult,
    TestCase,
    TestVerdict,
    Verdict,
)

# Judge0 CE language ids (GET /languages on the instance to verify).
LANGUAGE_IDS: dict[Language, int] = {
    Language.C: 50,  # C (GCC 9.2.0)
    Language.CPP: 54,  # C++ (GCC 9.2.0)
    Language.PYTHON: 71,  # Python (3.8.1)
    Language.JAVA: 62,  # Java (OpenJDK 13.0.1)
    Language.OCAML: 65,  # OCaml (4.09.0)
}

# Judge0 status ids → our verdicts. 1/2 (queued/processing) are not final.
STATUS_TO_VERDICT: dict[int, Verdict] = {
    3: Verdict.ACCEPTED,
    4: Verdict.WRONG_ANSWER,
    5: Verdict.TIME_LIMIT_EXCEEDED,
    6: Verdict.COMPILATION_ERROR,
    7: Verdict.RUNTIME_ERROR,  # SIGSEGV
    8: Verdict.RUNTIME_ERROR,  # SIGXFSZ
    9: Verdict.RUNTIME_ERROR,  # SIGFPE
    10: Verdict.RUNTIME_ERROR,  # SIGABRT
    11: Verdict.RUNTIME_ERROR,  # NZEC
    12: Verdict.RUNTIME_ERROR,  # other
    13: Verdict.INTERNAL_ERROR,
    14: Verdict.INTERNAL_ERROR,  # exec format error
}

_FINAL_STATUSES = frozenset(STATUS_TO_VERDICT)


def _b64(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


def _b64decode(value: str | None) -> str | None:
    if not value:
        return None
    return base64.b64decode(value).decode(errors="replace")


class Judge0Judge(Judge):
    """Judge against a self-hosted Judge0 instance, one batch per submission."""

    def __init__(self, base_url: str, *, poll_interval_s: float = 0.5, timeout_s: float = 60.0):
        self._base_url = base_url.rstrip("/")
        self._poll_interval_s = poll_interval_s
        self._timeout_s = timeout_s

    async def submit(
        self,
        source_code: str,
        language: Language,
        tests: list[TestCase],
        *,
        time_limit_s: float = 2.0,
        memory_limit_kb: int = 262_144,
    ) -> JudgeResult:
        if not tests:
            raise ValueError("at least one test case is required")

        payload = {
            "submissions": [
                {
                    "source_code": _b64(source_code),
                    "language_id": LANGUAGE_IDS[language],
                    "stdin": _b64(test.input),
                    "expected_output": _b64(test.expected_output),
                    "cpu_time_limit": time_limit_s,
                    "memory_limit": memory_limit_kb,
                }
                for test in tests
            ]
        }

        raw = await self._submit_batch(payload, fields="status_id,time,memory,compile_output")
        return self._aggregate(raw, memory_limit_kb)

    async def run(
        self,
        source_code: str,
        language: Language,
        inputs: list[str],
        *,
        time_limit_s: float = 2.0,
        memory_limit_kb: int = 262_144,
    ) -> RunResult:
        if not inputs:
            raise ValueError("at least one input is required")

        # Pas d'expected_output : Judge0 répond Accepted dès que l'exécution
        # aboutit, et on récupère stdout/stderr pour les montrer à l'utilisateur.
        payload = {
            "submissions": [
                {
                    "source_code": _b64(source_code),
                    "language_id": LANGUAGE_IDS[language],
                    "stdin": _b64(stdin),
                    "cpu_time_limit": time_limit_s,
                    "memory_limit": memory_limit_kb,
                }
                for stdin in inputs
            ]
        }

        raw = await self._submit_batch(
            payload, fields="status_id,time,memory,compile_output,stdout,stderr"
        )

        runs: list[RunOutput] = []
        compile_output: str | None = None
        for sub in raw:
            verdict = STATUS_TO_VERDICT[sub["status_id"]]
            if (
                verdict is Verdict.RUNTIME_ERROR
                and sub.get("memory") is not None
                and sub["memory"] >= memory_limit_kb
            ):
                verdict = Verdict.MEMORY_LIMIT_EXCEEDED
            if compile_output is None:
                compile_output = _b64decode(sub.get("compile_output"))
            runs.append(
                RunOutput(
                    verdict=verdict,
                    stdout=_b64decode(sub.get("stdout")),
                    stderr=_b64decode(sub.get("stderr")),
                    time_s=float(sub["time"]) if sub.get("time") is not None else None,
                    memory_kb=sub.get("memory"),
                )
            )
        return RunResult(runs=runs, compile_output=compile_output)

    async def _submit_batch(self, payload: dict, *, fields: str) -> list[dict]:
        async with httpx.AsyncClient(base_url=self._base_url, timeout=30.0) as client:
            resp = await client.post("/submissions/batch?base64_encoded=true", json=payload)
            resp.raise_for_status()
            tokens = [entry["token"] for entry in resp.json()]
            return await self._poll(client, tokens, fields=fields)

    async def _poll(
        self, client: httpx.AsyncClient, tokens: list[str], *, fields: str
    ) -> list[dict]:
        params = {
            "tokens": ",".join(tokens),
            "base64_encoded": "true",
            "fields": fields,
        }
        async with asyncio.timeout(self._timeout_s):
            while True:
                resp = await client.get("/submissions/batch", params=params)
                resp.raise_for_status()
                subs = resp.json()["submissions"]
                if all(s["status_id"] in _FINAL_STATUSES for s in subs):
                    return subs
                await asyncio.sleep(self._poll_interval_s)

    def _aggregate(self, submissions: list[dict], memory_limit_kb: int) -> JudgeResult:
        tests: list[TestVerdict] = []
        compile_output: str | None = None
        for sub in submissions:
            verdict = STATUS_TO_VERDICT[sub["status_id"]]
            # Judge0 reports an exceeded memory limit as SIGSEGV/SIGABRT; we
            # reclassify using the reported peak so users see MLE, not RE.
            if (
                verdict is Verdict.RUNTIME_ERROR
                and sub.get("memory") is not None
                and sub["memory"] >= memory_limit_kb
            ):
                verdict = Verdict.MEMORY_LIMIT_EXCEEDED
            if sub.get("compile_output") and compile_output is None:
                compile_output = base64.b64decode(sub["compile_output"]).decode(errors="replace")
            tests.append(
                TestVerdict(
                    verdict=verdict,
                    time_s=float(sub["time"]) if sub.get("time") is not None else None,
                    memory_kb=sub.get("memory"),
                )
            )

        overall = next(
            (t.verdict for t in tests if t.verdict is not Verdict.ACCEPTED), Verdict.ACCEPTED
        )
        return JudgeResult(verdict=overall, tests=tests, compile_output=compile_output)
