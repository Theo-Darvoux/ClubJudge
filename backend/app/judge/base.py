from abc import ABC, abstractmethod

from app.judge.types import JudgeResult, Language, TestCase


class Judge(ABC):
    """Abstract judging engine.

    The rest of the platform only ever talks to this interface, so the
    backing engine (Judge0 today, a custom isolate worker someday) can be
    swapped without touching submission handling.
    """

    @abstractmethod
    async def submit(
        self,
        source_code: str,
        language: Language,
        tests: list[TestCase],
        *,
        time_limit_s: float = 2.0,
        memory_limit_kb: int = 262_144,
    ) -> JudgeResult: ...
