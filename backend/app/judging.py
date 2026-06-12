"""File de jugement : les soumissions sont persistées en base AVANT tout envoi
au juge (PLAN.md Phase 1a). Le worker les consomme avec retry à backoff plafonné
si Judge0 est injoignable ; au démarrage, les soumissions non jugées sont
re-enfilées — un crash ou une panne de Judge0 ne perd jamais de soumission.
"""

import asyncio
import contextlib
import logging
from datetime import UTC, datetime

import httpx
from sqlalchemy import select

from app import notify
from app.db import SessionLocal, as_utc
from app.judge.base import Judge
from app.judge.types import Language, TestCase, Verdict
from app.models import Contest, ContestProblem, Submission, SubmissionStatus

logger = logging.getLogger(__name__)

RETRY_DELAYS_S = [2, 5, 15, 30, 60]  # puis 60s en boucle


class JudgeWorker:
    def __init__(self, judge: Judge, session_factory=SessionLocal):
        self._judge = judge
        self._session_factory = session_factory
        self._queue: asyncio.Queue[int] = asyncio.Queue()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        try:
            with self._session_factory() as db:
                pending = db.scalars(
                    select(Submission.id)
                    .where(Submission.status != SubmissionStatus.DONE)
                    .order_by(Submission.created_at)
                ).all()
        except Exception:
            # Base indisponible au démarrage (ex. CI sans PostgreSQL) : on
            # démarre quand même, les soumissions seront re-enfilées au prochain boot.
            logger.warning("could not re-enqueue pending submissions", exc_info=True)
            pending = []
        for submission_id in pending:
            self._queue.put_nowait(submission_id)
        if pending:
            logger.info("re-enqueued %d pending submission(s)", len(pending))
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    def enqueue(self, submission_id: int) -> None:
        self._queue.put_nowait(submission_id)

    @property
    def queue_length(self) -> int:
        return self._queue.qsize()

    async def _run(self) -> None:
        while True:
            submission_id = await self._queue.get()
            try:
                await self._judge_one(submission_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("unexpected error judging submission %d", submission_id)

    async def _judge_one(self, submission_id: int) -> None:
        with self._session_factory() as db:
            submission = db.get(Submission, submission_id)
            if submission is None or submission.status == SubmissionStatus.DONE:
                return
            submission.status = SubmissionStatus.RUNNING
            db.commit()
            tests = [
                TestCase(input=t.input, expected_output=t.expected_output)
                for t in submission.problem.tests
            ]
            source_code = submission.source_code
            language = Language(submission.language)
            time_limit_s = submission.problem.time_limit_s
            memory_limit_kb = submission.problem.memory_limit_kb

        attempt = 0
        while True:
            try:
                result = await self._judge.submit(
                    source_code,
                    language,
                    tests,
                    time_limit_s=time_limit_s,
                    memory_limit_kb=memory_limit_kb,
                )
                break
            except (httpx.HTTPError, TimeoutError) as exc:
                delay = RETRY_DELAYS_S[min(attempt, len(RETRY_DELAYS_S) - 1)]
                attempt += 1
                logger.warning(
                    "judge unreachable for submission %d (attempt %d, retry in %ds): %s",
                    submission_id, attempt, delay, exc,
                )
                await asyncio.sleep(delay)

        failed_test = next(
            (i + 1 for i, t in enumerate(result.tests) if t.verdict is not Verdict.ACCEPTED),
            None,
        )
        with self._session_factory() as db:
            submission = db.get(Submission, submission_id)
            if submission is None:
                return
            submission.status = SubmissionStatus.DONE
            submission.verdict = result.verdict
            submission.time_s = result.max_time_s
            submission.memory_kb = result.max_memory_kb
            submission.compile_output = result.compile_output
            submission.failed_test = failed_test
            submission.judged_at = datetime.now(UTC)
            db.commit()

        if result.verdict is Verdict.ACCEPTED:
            await self._maybe_first_blood(submission_id)

    async def _maybe_first_blood(self, submission_id: int) -> None:
        """Annonce Discord du premier AC d'un problème de contest (le « ballon »
        ICPC). Détection au jugement, sur la date de soumission ; le contest
        doit encore être en cours (un rejudge a posteriori ne ré-annonce pas)."""
        with self._session_factory() as db:
            submission = db.get(Submission, submission_id)
            if submission is None or submission.contest_id is None:
                return
            contest = db.get(Contest, submission.contest_id)
            if contest is None or as_utc(contest.end_at) <= datetime.now(UTC):
                return
            earlier = db.scalar(
                select(Submission.id)
                .where(
                    Submission.contest_id == submission.contest_id,
                    Submission.problem_id == submission.problem_id,
                    Submission.verdict == Verdict.ACCEPTED,
                    Submission.id != submission.id,
                    Submission.created_at <= submission.created_at,
                )
                .limit(1)
            )
            if earlier is not None:
                return
            label = db.scalar(
                select(ContestProblem.label).where(
                    ContestProblem.contest_id == contest.id,
                    ContestProblem.problem_id == submission.problem_id,
                )
            )
            contest_title = contest.title
            problem_title = submission.problem.title
            member = submission.user.display_name
        await notify.first_blood(contest_title, label or "?", problem_title, member)
