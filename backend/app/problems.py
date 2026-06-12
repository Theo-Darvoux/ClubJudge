from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_user
from app.contests import hidden_problem_ids, running_contest_for
from app.db import as_utc, get_db
from app.judge.types import Verdict
from app.models import ContestProblem, Problem, ProblemTag, Submission, User

router = APIRouter(prefix="/api/problems", tags=["problems"])


class ProblemSummary(BaseModel):
    slug: str
    title: str
    category: str
    difficulty: int
    tags: list[str]
    solved: bool
    attempted: bool


class SampleOut(BaseModel):
    input: str
    expected_output: str


class ProblemContestRef(BaseModel):
    """Contest en cours par lequel l'utilisateur accède à ce problème."""

    slug: str
    title: str
    label: str
    end_at: datetime


class ProblemDetail(ProblemSummary):
    statement_fr: str
    statement_en: str | None
    time_limit_s: float
    memory_limit_kb: int
    samples: list[SampleOut]
    hints: list[str]
    has_editorial: bool
    contest: ProblemContestRef | None = None


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
    # Les problèmes d'un contest non terminé restent secrets ; ils rejoignent
    # la liste à la fin de la fenêtre (upsolving, PLAN.md Phase 2).
    hidden = hidden_problem_ids(db, datetime.now(UTC))
    if hidden:
        query = query.where(Problem.id.not_in(hidden))
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
        select(Problem)
        .options(
            selectinload(Problem.tags),
            selectinload(Problem.tests),
            selectinload(Problem.hints),
        )
        .where(Problem.slug == slug)
    )
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")

    now = datetime.now(UTC)
    contest_ref: ProblemContestRef | None = None
    if problem.id in hidden_problem_ids(db, now):
        contest = running_contest_for(db, user, problem.id, now)
        if contest is None:
            # Même 404 qu'un slug inconnu : ne pas révéler l'existence d'un
            # problème de contest à venir.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")
        label = db.scalar(
            select(ContestProblem.label).where(
                ContestProblem.contest_id == contest.id,
                ContestProblem.problem_id == problem.id,
            )
        )
        contest_ref = ProblemContestRef(
            slug=contest.slug,
            title=contest.title,
            label=label or "?",
            end_at=as_utc(contest.end_at),
        )

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
        samples=[
            SampleOut(input=t.input, expected_output=t.expected_output)
            for t in problem.tests
            if t.is_sample
        ],
        # Pendant un contest, pas d'indices ni d'éditorial : conditions ICPC.
        hints=[] if contest_ref else [h.content_fr for h in problem.hints],
        has_editorial=problem.editorial_fr is not None and contest_ref is None,
        contest=contest_ref,
    )


def _get_problem_or_404(db: Session, slug: str) -> Problem:
    problem = db.scalar(select(Problem).where(Problem.slug == slug))
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")
    return problem


def _require_contest_over(db: Session, problem: Problem) -> None:
    """Éditorial et solutions des autres restent fermés tant que le problème
    appartient à un contest non terminé — conditions ICPC, même après son AC."""
    if problem.id in hidden_problem_ids(db, datetime.now(UTC)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "contest_running")


def _require_own_ac(db: Session, user: User, problem: Problem) -> None:
    """Éditorial et solutions des autres ne s'ouvrent qu'après son propre AC
    (PLAN.md : « on apprend en séchant »)."""
    solved = db.scalar(
        select(Submission.id)
        .where(
            Submission.user_id == user.id,
            Submission.problem_id == problem.id,
            Submission.verdict == Verdict.ACCEPTED,
        )
        .limit(1)
    )
    if solved is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "solve_first")


class EditorialOut(BaseModel):
    editorial_fr: str
    editorial_en: str | None


@router.get("/{slug}/editorial")
def get_editorial(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> EditorialOut:
    problem = _get_problem_or_404(db, slug)
    if problem.editorial_fr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no_editorial")
    _require_contest_over(db, problem)
    _require_own_ac(db, user, problem)
    return EditorialOut(editorial_fr=problem.editorial_fr, editorial_en=problem.editorial_en)


class SolutionOut(BaseModel):
    id: int
    author: str
    is_mine: bool
    language: str
    time_s: float | None
    memory_kb: int | None
    created_at: datetime
    source_code: str


@router.get("/{slug}/solutions")
def list_solutions(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[SolutionOut]:
    problem = _get_problem_or_404(db, slug)
    _require_contest_over(db, problem)
    _require_own_ac(db, user, problem)

    accepted = db.scalars(
        select(Submission)
        .options(selectinload(Submission.user))
        .where(Submission.problem_id == problem.id, Submission.verdict == Verdict.ACCEPTED)
        .order_by(Submission.time_s.asc().nulls_last(), Submission.created_at.asc())
    ).all()

    # Une seule entrée par membre et par langage : sa plus rapide.
    best: dict[tuple[int, str], Submission] = {}
    for s in accepted:
        best.setdefault((s.user_id, s.language), s)

    return [
        SolutionOut(
            id=s.id,
            author=s.user.display_name,
            is_mine=s.user_id == user.id,
            language=s.language,
            time_s=s.time_s,
            memory_kb=s.memory_kb,
            created_at=s.created_at,
            source_code=s.source_code,
        )
        for s in sorted(best.values(), key=lambda s: (s.time_s is None, s.time_s or 0.0))
    ]
