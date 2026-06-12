"""Compétitions ICPC (PLAN.md Phase 2).

Règles de visibilité : un problème rattaché à un contest **non terminé** est
caché partout (liste, page problème, soumission). Pendant la fenêtre, seuls
les inscrits y accèdent — leurs soumissions sont rattachées au contest et
alimentent le scoreboard. À la fin, les problèmes rejoignent la liste générale
(upsolving) et le scoreboard devient le classement final.

Scoring ICPC classique : classé par problèmes résolus, départagé par la
pénalité = somme, sur les problèmes résolus, de (minute du premier AC
+ 20 min par essai rejeté avant lui). CE et IE ne comptent pas comme essai.
"""

import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app import notify
from app.auth import AdminUser, get_current_user
from app.db import as_utc, get_db
from app.judge.types import Verdict
from app.models import (
    Contest,
    ContestProblem,
    ContestRegistration,
    Problem,
    Submission,
    SubmissionStatus,
    User,
)

router = APIRouter(prefix="/api/contests", tags=["contests"])

PENALTY_PER_REJECT_MIN = 20
# Verdicts qui ne coûtent pas de pénalité : la compilation ratée n'a jamais
# tourné, l'erreur interne n'est pas la faute du participant.
NO_PENALTY_VERDICTS = {Verdict.COMPILATION_ERROR, Verdict.INTERNAL_ERROR}

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
LABEL_RE = re.compile(r"^[A-Z][0-9]?$")

Phase = Literal["upcoming", "running", "finished"]


def utcnow() -> datetime:
    return datetime.now(UTC)


def contest_phase(contest: Contest, now: datetime) -> Phase:
    if now < as_utc(contest.start_at):
        return "upcoming"
    if now < as_utc(contest.end_at):
        return "running"
    return "finished"


def hidden_problem_ids(db: Session, now: datetime) -> set[int]:
    """Problèmes rattachés à un contest pas encore terminé : hors de la liste
    générale et inaccessibles, sauf via le contest pour ses inscrits."""
    return set(
        db.scalars(
            select(ContestProblem.problem_id)
            .join(Contest, ContestProblem.contest_id == Contest.id)
            .where(Contest.end_at > now)
        )
    )


def running_contest_for(db: Session, user: User, problem_id: int, now: datetime) -> Contest | None:
    """Contest en cours qui contient ce problème et où l'utilisateur est
    inscrit — c'est lui qui donne accès au problème pendant la fenêtre."""
    return db.scalar(
        select(Contest)
        .join(ContestProblem, ContestProblem.contest_id == Contest.id)
        .join(ContestRegistration, ContestRegistration.contest_id == Contest.id)
        .where(
            ContestProblem.problem_id == problem_id,
            ContestRegistration.user_id == user.id,
            Contest.start_at <= now,
            Contest.end_at > now,
        )
    )


# ---------------------------------------------------------------------------
# Scoring ICPC — fonction pure, testable sans base.


@dataclass(frozen=True)
class CellScore:
    tries: int  # essais pénalisés (rejetés avant le 1er AC, ou en tout si non résolu)
    solved_at_min: int | None
    first_blood: bool = False
    pending: bool = False  # au moins une soumission encore dans la file


@dataclass(frozen=True)
class RowScore:
    user_id: int
    solved: int
    penalty_min: int
    last_solve_min: int  # départage : minute du dernier AC (0 si aucun)
    cells: dict[int, CellScore]  # par problem_id


def compute_scores(
    start_at: datetime,
    user_ids: list[int],
    problem_ids: list[int],
    submissions: list[Submission],
) -> list[RowScore]:
    """Classement ICPC à partir des soumissions du contest, triées ici par date.

    Renvoie les lignes triées : résolus desc, pénalité asc, dernier AC asc.
    Seules les soumissions jugées comptent ; les soumissions d'utilisateurs
    désinscrits ou de problèmes retirés sont ignorées.
    """
    start = as_utc(start_at)
    known = {(u, p) for u in user_ids for p in problem_ids}

    tries: dict[tuple[int, int], int] = {}
    solved_at: dict[tuple[int, int], int] = {}
    pending: set[tuple[int, int]] = set()

    for sub in sorted(submissions, key=lambda s: (as_utc(s.created_at), s.id)):
        key = (sub.user_id, sub.problem_id)
        if key not in known or key in solved_at:
            continue
        if sub.status != SubmissionStatus.DONE:
            pending.add(key)
            continue
        if sub.verdict == Verdict.ACCEPTED:
            minute = math.floor((as_utc(sub.created_at) - start).total_seconds() / 60)
            solved_at[key] = max(0, minute)
        elif sub.verdict not in NO_PENALTY_VERDICTS:
            tries[key] = tries.get(key, 0) + 1

    first_blood: dict[int, int] = {}  # problem_id -> user_id
    for (user_id, problem_id), minute in solved_at.items():
        best = first_blood.get(problem_id)
        if best is None or minute < solved_at[(best, problem_id)]:
            first_blood[problem_id] = user_id

    rows = []
    for user_id in user_ids:
        cells = {}
        solved = penalty = last = 0
        for problem_id in problem_ids:
            key = (user_id, problem_id)
            minute = solved_at.get(key)
            cells[problem_id] = CellScore(
                tries=tries.get(key, 0),
                solved_at_min=minute,
                first_blood=first_blood.get(problem_id) == user_id,
                pending=key in pending,
            )
            if minute is not None:
                solved += 1
                penalty += minute + PENALTY_PER_REJECT_MIN * tries.get(key, 0)
                last = max(last, minute)
        rows.append(
            RowScore(
                user_id=user_id, solved=solved, penalty_min=penalty,
                last_solve_min=last, cells=cells,
            )
        )
    rows.sort(key=lambda r: (-r.solved, r.penalty_min, r.last_solve_min))
    return rows


# ---------------------------------------------------------------------------
# Schémas API.


class ContestSummary(BaseModel):
    slug: str
    title: str
    phase: Phase
    start_at: datetime
    end_at: datetime
    problem_count: int
    registered_count: int
    registered: bool


class ContestProblemOut(BaseModel):
    label: str
    slug: str
    title: str
    difficulty: int
    solved: bool


class ContestDetail(ContestSummary):
    description: str | None
    # None tant que les énoncés sont cachés (avant le début, ou pendant la
    # fenêtre pour les non-inscrits).
    problems: list[ContestProblemOut] | None


class ScoreCellOut(BaseModel):
    tries: int
    solved_at_min: int | None
    first_blood: bool
    pending: bool


class ScoreRowOut(BaseModel):
    rank: int
    display_name: str
    is_me: bool
    solved: int
    penalty_min: int
    cells: list[ScoreCellOut]  # alignées sur `problems`


class ScoreboardOut(BaseModel):
    phase: Phase
    problems: list[str]  # labels, dans l'ordre
    rows: list[ScoreRowOut]


# ---------------------------------------------------------------------------
# Endpoints membres.


def _load_contest(db: Session, slug: str) -> Contest:
    contest = db.scalar(
        select(Contest)
        .options(selectinload(Contest.problems).selectinload(ContestProblem.problem))
        .where(Contest.slug == slug)
    )
    if contest is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "contest_not_found")
    return contest


def _registration_counts(db: Session, contest_ids: list[int]) -> dict[int, int]:
    if not contest_ids:
        return {}
    rows = db.execute(
        select(ContestRegistration.contest_id, func.count())
        .where(ContestRegistration.contest_id.in_(contest_ids))
        .group_by(ContestRegistration.contest_id)
    ).all()
    return dict(rows)


@router.get("")
def list_contests(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[ContestSummary]:
    now = utcnow()
    contests = db.scalars(
        select(Contest).options(selectinload(Contest.problems)).order_by(Contest.start_at.desc())
    ).all()
    counts = _registration_counts(db, [c.id for c in contests])
    mine = set(
        db.scalars(
            select(ContestRegistration.contest_id).where(ContestRegistration.user_id == user.id)
        )
    )
    return [
        ContestSummary(
            slug=c.slug,
            title=c.title,
            phase=contest_phase(c, now),
            start_at=as_utc(c.start_at),
            end_at=as_utc(c.end_at),
            problem_count=len(c.problems),
            registered_count=counts.get(c.id, 0),
            registered=c.id in mine,
        )
        for c in contests
    ]


@router.get("/{slug}")
def get_contest(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> ContestDetail:
    now = utcnow()
    contest = _load_contest(db, slug)
    phase = contest_phase(contest, now)
    registered = (
        db.scalar(
            select(ContestRegistration.id).where(
                ContestRegistration.contest_id == contest.id,
                ContestRegistration.user_id == user.id,
            )
        )
        is not None
    )

    problems: list[ContestProblemOut] | None = None
    if phase == "finished" or (phase == "running" and registered):
        solved_ids = set(
            db.scalars(
                select(Submission.problem_id).where(
                    Submission.user_id == user.id, Submission.verdict == Verdict.ACCEPTED
                )
            )
        )
        problems = [
            ContestProblemOut(
                label=cp.label,
                slug=cp.problem.slug,
                title=cp.problem.title,
                difficulty=cp.problem.difficulty,
                solved=cp.problem_id in solved_ids,
            )
            for cp in contest.problems
        ]

    return ContestDetail(
        slug=contest.slug,
        title=contest.title,
        description=contest.description,
        phase=phase,
        start_at=as_utc(contest.start_at),
        end_at=as_utc(contest.end_at),
        problem_count=len(contest.problems),
        registered_count=_registration_counts(db, [contest.id]).get(contest.id, 0),
        registered=registered,
        problems=problems,
    )


@router.post("/{slug}/register", status_code=status.HTTP_204_NO_CONTENT)
def register_to_contest(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    contest = _load_contest(db, slug)
    if contest_phase(contest, utcnow()) == "finished":
        raise HTTPException(status.HTTP_409_CONFLICT, "contest_finished")
    exists = db.scalar(
        select(ContestRegistration.id).where(
            ContestRegistration.contest_id == contest.id,
            ContestRegistration.user_id == user.id,
        )
    )
    if exists is None:
        db.add(ContestRegistration(contest_id=contest.id, user_id=user.id))
        db.commit()


@router.delete("/{slug}/register", status_code=status.HTTP_204_NO_CONTENT)
def unregister_from_contest(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    contest = _load_contest(db, slug)
    # Une fois le contest commencé, on reste au classement : se désinscrire
    # en cours de route fausserait le scoreboard.
    if contest_phase(contest, utcnow()) != "upcoming":
        raise HTTPException(status.HTTP_409_CONFLICT, "contest_started")
    registration = db.scalar(
        select(ContestRegistration).where(
            ContestRegistration.contest_id == contest.id,
            ContestRegistration.user_id == user.id,
        )
    )
    if registration is not None:
        db.delete(registration)
        db.commit()


def build_scoreboard(
    db: Session, contest: Contest, now: datetime, me: User | None
) -> ScoreboardOut:
    phase = contest_phase(contest, now)
    registrations = db.scalars(
        select(ContestRegistration)
        .options(selectinload(ContestRegistration.user))
        .where(ContestRegistration.contest_id == contest.id)
    ).all()
    users = {r.user_id: r.user.display_name for r in registrations}
    problem_ids = [cp.problem_id for cp in contest.problems]
    submissions = db.scalars(
        select(Submission).where(Submission.contest_id == contest.id)
    ).all()

    rows = compute_scores(contest.start_at, list(users), problem_ids, submissions)

    out: list[ScoreRowOut] = []
    rank = 0
    previous: tuple[int, int] | None = None
    for i, row in enumerate(rows):
        # Rang partagé à égalité parfaite (résolus, pénalité), comme DOMJudge.
        if (row.solved, row.penalty_min) != previous:
            rank = i + 1
            previous = (row.solved, row.penalty_min)
        out.append(
            ScoreRowOut(
                rank=rank,
                display_name=users[row.user_id],
                is_me=me is not None and row.user_id == me.id,
                solved=row.solved,
                penalty_min=row.penalty_min,
                cells=[
                    ScoreCellOut(
                        tries=row.cells[pid].tries,
                        solved_at_min=row.cells[pid].solved_at_min,
                        first_blood=row.cells[pid].first_blood,
                        pending=row.cells[pid].pending,
                    )
                    for pid in problem_ids
                ],
            )
        )
    return ScoreboardOut(
        phase=phase, problems=[cp.label for cp in contest.problems], rows=out
    )


@router.get("/{slug}/scoreboard")
def get_scoreboard(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> ScoreboardOut:
    now = utcnow()
    contest = _load_contest(db, slug)
    if contest_phase(contest, now) == "upcoming":
        raise HTTPException(status.HTTP_409_CONFLICT, "contest_not_started")
    return build_scoreboard(db, contest, now, user)


# ---------------------------------------------------------------------------
# Endpoints admin : création et édition des contests.


class ContestProblemIn(BaseModel):
    slug: str
    label: str


class ContestPayload(BaseModel):
    slug: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=128)
    description: str | None = None
    start_at: datetime
    end_at: datetime
    problems: list[ContestProblemIn]


def _validate_payload(db: Session, payload: ContestPayload) -> list[tuple[int, str]]:
    """Renvoie les (problem_id, label) à rattacher, ou lève une 422 parlante."""
    if not SLUG_RE.fullmatch(payload.slug):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_slug")
    if payload.start_at.tzinfo is None or payload.end_at.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "naive_datetime")
    if payload.end_at <= payload.start_at:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "end_before_start")

    labels = [p.label for p in payload.problems]
    slugs = [p.slug for p in payload.problems]
    if len(set(labels)) != len(labels) or len(set(slugs)) != len(slugs):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "duplicate_problem")
    for label in labels:
        if not LABEL_RE.fullmatch(label):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_label")

    by_slug = {
        p.slug: p.id
        for p in db.scalars(select(Problem).where(Problem.slug.in_(slugs)))
    }
    missing = [s for s in slugs if s not in by_slug]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"code": "unknown_problem", "slugs": missing},
        )
    return [(by_slug[p.slug], p.label) for p in payload.problems]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_contest(
    payload: ContestPayload,
    background: BackgroundTasks,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminUser,
) -> ContestDetail:
    attached = _validate_payload(db, payload)
    if db.scalar(select(Contest.id).where(Contest.slug == payload.slug)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "slug_taken")
    contest = Contest(
        slug=payload.slug,
        title=payload.title,
        description=payload.description,
        start_at=payload.start_at,
        end_at=payload.end_at,
        problems=[
            ContestProblem(problem_id=pid, label=label) for pid, label in attached
        ],
    )
    db.add(contest)
    db.commit()
    background.add_task(notify.contest_created, contest.title, contest.start_at, contest.end_at)
    return get_contest(payload.slug, db, admin)


@router.put("/{slug}", status_code=status.HTTP_200_OK)
def update_contest(
    slug: str,
    payload: ContestPayload,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminUser,
) -> ContestDetail:
    contest = _load_contest(db, slug)
    attached = _validate_payload(db, payload)
    if payload.slug != slug:
        # Le slug est l'identifiant public (URLs, annonces) : on ne le change pas.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "slug_immutable")
    contest.title = payload.title
    contest.description = payload.description
    contest.start_at = payload.start_at
    contest.end_at = payload.end_at
    contest.problems = [ContestProblem(problem_id=pid, label=label) for pid, label in attached]
    db.commit()
    return get_contest(slug, db, admin)


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contest(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    admin: AdminUser,
) -> None:
    contest = _load_contest(db, slug)
    # Après le début il y a des soumissions et un classement : on archive, on
    # ne supprime pas l'histoire.
    if contest_phase(contest, utcnow()) != "upcoming":
        raise HTTPException(status.HTTP_409_CONFLICT, "contest_started")
    db.delete(contest)
    db.commit()
