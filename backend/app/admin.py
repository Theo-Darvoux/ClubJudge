"""Outils admin minimaux (PLAN.md Phase 2) : rejuger une soumission ou toutes
celles d'un problème — typiquement après correction d'un test ou d'une limite.

Le rejudge remet la soumission dans la file : verdict effacé, re-jugée par le
worker comme une soumission neuve. Son rattachement contest et sa date de
création sont conservés — le scoreboard se recalcule tout seul.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import record_admin_action
from app.auth import AdminUser
from app.db import get_db
from app.judging import JudgeWorker
from app.models import Problem, Submission, SubmissionStatus
from app.submissions import get_worker

router = APIRouter(prefix="/api/admin", tags=["admin"])


class RejudgeOut(BaseModel):
    rejudged: int


def _reset_submissions(submissions: list[Submission]) -> list[int]:
    ids: list[int] = []
    for s in submissions:
        ids.append(s.id)
        s.status = SubmissionStatus.QUEUED
        s.verdict = None
        s.time_s = None
        s.memory_kb = None
        s.compile_output = None
        s.failed_test = None
        s.judged_at = None
    return ids


@router.post("/submissions/{submission_id}/rejudge")
def rejudge_submission(
    submission_id: int,
    db: Annotated[Session, Depends(get_db)],
    worker: Annotated[JudgeWorker, Depends(get_worker)],
    admin: AdminUser,
) -> RejudgeOut:
    submission = db.get(Submission, submission_id)
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "submission_not_found")
    ids = _reset_submissions([submission])
    record_admin_action(
        db, admin, "submission.rejudge", f"submission:{submission_id}"
    )
    db.commit()
    for sid in ids:
        worker.enqueue(sid)
    return RejudgeOut(rejudged=len(ids))


@router.post("/problems/{slug}/rejudge")
def rejudge_problem(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    worker: Annotated[JudgeWorker, Depends(get_worker)],
    admin: AdminUser,
) -> RejudgeOut:
    problem = db.scalar(select(Problem).where(Problem.slug == slug))
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")
    submissions = db.scalars(
        select(Submission)
        .where(Submission.problem_id == problem.id)
        .order_by(Submission.created_at)
    ).all()
    ids = _reset_submissions(list(submissions))
    record_admin_action(
        db,
        admin,
        "problem.rejudge",
        f"problem:{slug}",
        {"submission_count": len(ids)},
    )
    db.commit()
    for sid in ids:
        worker.enqueue(sid)
    return RejudgeOut(rejudged=len(ids))
