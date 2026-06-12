from dataclasses import dataclass, field
from enum import StrEnum


class Language(StrEnum):
    C = "c"
    CPP = "cpp"
    PYTHON = "python"
    JAVA = "java"


class Verdict(StrEnum):
    ACCEPTED = "AC"
    WRONG_ANSWER = "WA"
    TIME_LIMIT_EXCEEDED = "TLE"
    MEMORY_LIMIT_EXCEEDED = "MLE"
    RUNTIME_ERROR = "RE"
    COMPILATION_ERROR = "CE"
    INTERNAL_ERROR = "IE"


@dataclass(frozen=True)
class TestCase:
    input: str
    expected_output: str


@dataclass(frozen=True)
class TestVerdict:
    verdict: Verdict
    time_s: float | None = None
    memory_kb: int | None = None


@dataclass(frozen=True)
class RunOutput:
    """Result of one execution without expected output (run on examples)."""

    verdict: Verdict  # ACCEPTED = le programme s'est exécuté sans encombre
    stdout: str | None = None
    stderr: str | None = None
    time_s: float | None = None
    memory_kb: int | None = None


@dataclass(frozen=True)
class RunResult:
    runs: list[RunOutput] = field(default_factory=list)
    compile_output: str | None = None


@dataclass(frozen=True)
class JudgeResult:
    """Aggregated verdict: first non-AC test decides, ICPC-style."""

    verdict: Verdict
    tests: list[TestVerdict] = field(default_factory=list)
    compile_output: str | None = None

    @property
    def max_time_s(self) -> float | None:
        times = [t.time_s for t in self.tests if t.time_s is not None]
        return max(times) if times else None

    @property
    def max_memory_kb(self) -> int | None:
        mems = [t.memory_kb for t in self.tests if t.memory_kb is not None]
        return max(mems) if mems else None
