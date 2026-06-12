import time
from datetime import UTC, datetime, timedelta
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_user
from app.config import get_settings
from app.db import as_utc, get_db
from app.judge.base import Judge
from app.judge.types import Language, Verdict
from app.judging import JudgeWorker
from app.models import Problem, Submission, User

router = APIRouter(prefix="/api", tags=["submissions"])

MAX_SOURCE_BYTES = 64 * 1024
MAX_CUSTOM_INPUT_BYTES = 64 * 1024
MAX_RUN_OUTPUT_CHARS = 4096
RUN_COOLDOWN_S = 3.0

# Anti-spam léger pour les exécutions d'essai (non persistées, donc en mémoire ;
# suffisant tant que l'API tourne en un seul process).
_last_run_at: dict[int, float] = {}


def get_worker(request: Request) -> JudgeWorker:
    return request.app.state.judge_worker


def get_judge(request: Request) -> Judge:
    return request.app.state.judge


class SubmissionPayload(BaseModel):
    language: Language
    source_code: str = Field(min_length=1)


class SubmissionOut(BaseModel):
    id: int
    problem_slug: str
    language: str
    status: str
    verdict: str | None
    time_s: float | None
    memory_kb: int | None
    compile_output: str | None
    failed_test: int | None
    created_at: datetime

    @classmethod
    def from_model(cls, s: Submission) -> "SubmissionOut":
        return cls(
            id=s.id,
            problem_slug=s.problem.slug,
            language=s.language,
            status=s.status,
            verdict=s.verdict,
            time_s=s.time_s,
            memory_kb=s.memory_kb,
            compile_output=s.compile_output,
            failed_test=s.failed_test,
            created_at=s.created_at,
        )


@router.post("/problems/{slug}/submissions", status_code=status.HTTP_201_CREATED)
def submit(
    slug: str,
    payload: SubmissionPayload,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    worker: Annotated[JudgeWorker, Depends(get_worker)],
) -> SubmissionOut:
    if len(payload.source_code.encode()) > MAX_SOURCE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "source_too_large")

    problem = db.scalar(select(Problem).where(Problem.slug == slug))
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")

    # Rate limiting par utilisateur : protège la file et la machine (PLAN.md 1a).
    cooldown = timedelta(seconds=get_settings().submission_cooldown_s)
    last = db.scalar(
        select(Submission.created_at)
        .where(Submission.user_id == user.id)
        .order_by(Submission.created_at.desc())
        .limit(1)
    )
    if last is not None:
        elapsed = datetime.now(UTC) - as_utc(last)
        if elapsed < cooldown:
            retry_after = int((cooldown - elapsed).total_seconds()) + 1
            response.headers["Retry-After"] = str(retry_after)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                {"code": "cooldown", "retry_after_s": retry_after},
                headers={"Retry-After": str(retry_after)},
            )

    submission = Submission(
        user_id=user.id,
        problem_id=problem.id,
        language=payload.language,
        source_code=payload.source_code,
    )
    db.add(submission)
    db.commit()  # persistée avant tout envoi au juge
    worker.enqueue(submission.id)
    return SubmissionOut.from_model(submission)


class RunPayload(BaseModel):
    language: Language
    source_code: str = Field(min_length=1)
    # None = exécuter sur les exemples ; sinon, une entrée personnalisée unique.
    custom_input: str | None = None


class RunCaseOut(BaseModel):
    verdict: str
    input: str
    expected_output: str | None
    stdout: str | None
    stderr: str | None
    time_s: float | None
    memory_kb: int | None


class RunOut(BaseModel):
    compile_output: str | None
    cases: list[RunCaseOut]


def _normalized_lines(text: str) -> list[str]:
    """Même tolérance que Judge0 : espaces de fin de ligne et lignes vides
    finales ignorés."""
    return [line.rstrip() for line in text.rstrip("\n").split("\n")]


def _truncate(text: str | None) -> str | None:
    if text is None or len(text) <= MAX_RUN_OUTPUT_CHARS:
        return text
    return text[:MAX_RUN_OUTPUT_CHARS] + "\n… (sortie tronquée)"


@router.post("/problems/{slug}/run")
async def run_code(
    slug: str,
    payload: RunPayload,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    judge: Annotated[Judge, Depends(get_judge)],
) -> RunOut:
    """Exécution d'essai : exemples de l'énoncé ou entrée personnalisée.

    Jamais enregistrée comme soumission — c'est le filet de sécurité qui lève
    la peur de soumettre (PLAN.md 1b).
    """
    if len(payload.source_code.encode()) > MAX_SOURCE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "source_too_large")
    if (
        payload.custom_input is not None
        and len(payload.custom_input.encode()) > MAX_CUSTOM_INPUT_BYTES
    ):
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "input_too_large")

    problem = db.scalar(
        select(Problem).options(selectinload(Problem.tests)).where(Problem.slug == slug)
    )
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")

    now = time.monotonic()
    last = _last_run_at.get(user.id)
    if last is not None and now - last < RUN_COOLDOWN_S:
        retry_after = int(RUN_COOLDOWN_S - (now - last)) + 1
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            {"code": "cooldown", "retry_after_s": retry_after},
            headers={"Retry-After": str(retry_after)},
        )
    _last_run_at[user.id] = now

    if payload.custom_input is not None:
        inputs = [payload.custom_input]
        expected: list[str | None] = [None]
    else:
        samples = [t for t in problem.tests if t.is_sample]
        if not samples:
            raise HTTPException(status.HTTP_409_CONFLICT, "no_samples")
        inputs = [t.input for t in samples]
        expected = [t.expected_output for t in samples]

    try:
        result = await judge.run(
            payload.source_code,
            payload.language,
            inputs,
            time_limit_s=problem.time_limit_s,
            memory_limit_kb=problem.memory_limit_kb,
        )
    except (httpx.HTTPError, TimeoutError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "judge_unavailable") from exc

    cases: list[RunCaseOut] = []
    for run, stdin, expected_output in zip(result.runs, inputs, expected, strict=True):
        verdict = run.verdict
        # Le juge n'a pas comparé (pas de sortie attendue envoyée) : on compare
        # ici, avec la même tolérance, pour afficher AC/WA sur les exemples.
        if verdict is Verdict.ACCEPTED and expected_output is not None:
            got = _normalized_lines(run.stdout or "")
            if got != _normalized_lines(expected_output):
                verdict = Verdict.WRONG_ANSWER
        cases.append(
            RunCaseOut(
                verdict=verdict,
                input=stdin,
                expected_output=expected_output,
                stdout=_truncate(run.stdout),
                stderr=_truncate(run.stderr),
                time_s=run.time_s,
                memory_kb=run.memory_kb,
            )
        )
    return RunOut(compile_output=result.compile_output, cases=cases)


@router.get("/submissions/{submission_id}")
def get_submission(
    submission_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> SubmissionOut:
    submission = db.get(Submission, submission_id)
    if submission is None or submission.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "submission_not_found")
    return SubmissionOut.from_model(submission)


@router.get("/problems/{slug}/submissions")
def list_my_submissions(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[SubmissionOut]:
    problem = db.scalar(select(Problem).where(Problem.slug == slug))
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")
    submissions = db.scalars(
        select(Submission)
        .where(Submission.user_id == user.id, Submission.problem_id == problem.id)
        .order_by(Submission.created_at.desc())
        .limit(50)
    ).all()
    return [SubmissionOut.from_model(s) for s in submissions]
