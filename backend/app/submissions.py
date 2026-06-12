from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import as_utc, get_db
from app.judge.types import Language
from app.judging import JudgeWorker
from app.models import Problem, Submission, User

router = APIRouter(prefix="/api", tags=["submissions"])

MAX_SOURCE_BYTES = 64 * 1024


def get_worker(request: Request) -> JudgeWorker:
    return request.app.state.judge_worker


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
