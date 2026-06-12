from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_user
from app.db import get_db
from app.judge.types import Verdict
from app.models import Problem, ProblemTag, Submission, User

router = APIRouter(prefix="/api/problems", tags=["problems"])


class ProblemSummary(BaseModel):
    slug: str
    title: str
    category: str
    difficulty: int
    tags: list[str]
    solved: bool
    attempted: bool


class ProblemDetail(ProblemSummary):
    statement_fr: str
    statement_en: str | None
    time_limit_s: float
    memory_limit_kb: int


@router.get("")
def list_problems(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    category: str | None = None,
    difficulty: int | None = None,
    tag: str | None = None,
    q: str | None = None,
) -> list[ProblemSummary]:
    query = select(Problem).options(selectinload(Problem.tags)).order_by(
        Problem.difficulty, Problem.title
    )
    if category:
        query = query.where(Problem.category == category)
    if difficulty:
        query = query.where(Problem.difficulty == difficulty)
    if tag:
        query = query.where(Problem.tags.any(ProblemTag.tag == tag.lower()))
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(Problem.title.ilike(pattern), Problem.slug.ilike(pattern))
        )
    problems = db.scalars(query).all()

    verdicts = db.execute(
        select(Submission.problem_id, Submission.verdict).where(Submission.user_id == user.id)
    ).all()
    solved = {pid for pid, v in verdicts if v == Verdict.ACCEPTED}
    attempted = {pid for pid, _ in verdicts}

    return [
        ProblemSummary(
            slug=p.slug,
            title=p.title,
            category=p.category,
            difficulty=p.difficulty,
            tags=[t.tag for t in p.tags],
            solved=p.id in solved,
            attempted=p.id in attempted,
        )
        for p in problems
    ]


@router.get("/categories")
def list_categories(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[str]:
    return list(db.scalars(select(Problem.category).distinct().order_by(Problem.category)))


@router.get("/{slug}")
def get_problem(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> ProblemDetail:
    problem = db.scalar(
        select(Problem).options(selectinload(Problem.tags)).where(Problem.slug == slug)
    )
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")

    verdicts = [
        v for (v,) in db.execute(
            select(Submission.verdict).where(
                Submission.user_id == user.id, Submission.problem_id == problem.id
            )
        )
    ]
    return ProblemDetail(
        slug=problem.slug,
        title=problem.title,
        category=problem.category,
        difficulty=problem.difficulty,
        tags=[t.tag for t in problem.tags],
        solved=Verdict.ACCEPTED in verdicts,
        attempted=len(verdicts) > 0,
        statement_fr=problem.statement_fr,
        statement_en=problem.statement_en,
        time_limit_s=problem.time_limit_s,
        memory_limit_kb=problem.memory_limit_kb,
    )
