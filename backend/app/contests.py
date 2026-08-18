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
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, load_only, selectinload

from app import notify
from app.auth import AdminUser, get_current_user
from app.db import as_utc, get_db
from app.judge.types import NON_ATTEMPT_VERDICTS, Verdict
from app.models import (
    Contest,
    ContestProblem,
    ContestRegistration,
    Problem,
    Submission,
    SubmissionStatus,
    User,
)
from app.progress import solved_attempted_ids
from app.schemas import AttemptedProblemRef

router = APIRouter(prefix="/api/contests", tags=["contests"])

PENALTY_PER_REJECT_MIN = 20
# Verdicts qui ne coûtent pas de pénalité = verdicts qui ne comptent pas comme une
# tentative jugée (cf. NON_ATTEMPT_VERDICTS) : la compilation ratée n'a jamais
# tourné, l'erreur interne n'est pas la faute du participant.
NO_PENALTY_VERDICTS = NON_ATTEMPT_VERDICTS

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


def hidden_problem_ids_select(now: datetime) -> Select[tuple[int]]:
    """Selectable des ids de problèmes rattachés à un contest pas encore
    terminé — la règle de visibilité ICPC, en un seul endroit. Réutilisée comme
    sous-requête (liste générale) ou matérialisée (`hidden_problem_ids`)."""
    return (
        select(ContestProblem.problem_id)
        .join(Contest, ContestProblem.contest_id == Contest.id)
        .where(Contest.end_at > now)
    )


def hidden_problem_ids(db: Session, now: datetime) -> set[int]:
    """Problèmes rattachés à un contest pas encore terminé : hors de la liste
    générale et inaccessibles, sauf via le contest pour ses inscrits."""
    return set(db.scalars(hidden_problem_ids_select(now)))


def is_problem_hidden(db: Session, problem_id: int, now: datetime) -> bool:
    """Vérifie si un problème spécifique appartient à un contest non terminé."""
    return (
        db.scalar(
            hidden_problem_ids_select(now).where(ContestProblem.problem_id == problem_id).limit(1)
        )
        is not None
    )


@dataclass(frozen=True)
class ActiveContestInfo:
    contest: Contest
    label: str


def require_contest_access(
    db: Session, user: User, problem_id: int, now: datetime
) -> ActiveContestInfo | None:
    """Renvoie le contest en cours qui donne accès à ce problème (l'utilisateur
    y est inscrit), ou None pour un problème public ou un admin. **Lève une 404**
    si le problème est caché par un contest auquel l'utilisateur n'a pas accès.
    """
    stmt = (
        select(
            Contest,
            ContestProblem.label,
            ContestRegistration.id.is_not(None).label("is_registered"),
        )
        .options(load_only(Contest.slug, Contest.title, Contest.start_at, Contest.end_at))
        .join(ContestProblem, ContestProblem.contest_id == Contest.id)
        .outerjoin(
            ContestRegistration,
            (ContestRegistration.contest_id == Contest.id)
            & (ContestRegistration.user_id == user.id),
        )
        .where(ContestProblem.problem_id == problem_id, Contest.end_at > now)
    )
    rows = db.execute(stmt).all()
    if not rows:
        return None

    for contest, label, is_registered in rows:
        if as_utc(contest.start_at) <= now and is_registered:
            return ActiveContestInfo(contest=contest, label=label or "?")

    if user.role == "admin":
        return None
    raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")


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
    # Premier AC de chaque problème, dans l'ordre chronologique (created_at, id) :
    # comme on itère déjà dans cet ordre, le premier AC rencontré EST le premier
    # sang. Même définition que l'annonce Discord (judging._maybe_first_blood), pour
    # que le ballon du scoreboard et le nom annoncé désignent toujours la même
    # personne — y compris à égalité de minute (l'ordre par id départage).
    first_blood: dict[int, int] = {}  # problem_id -> user_id

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
            first_blood.setdefault(sub.problem_id, sub.user_id)
        elif sub.verdict not in NO_PENALTY_VERDICTS:
            tries[key] = tries.get(key, 0) + 1

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
                # « En attente » ne concerne qu'un problème non encore résolu : une
                # soumission en file derrière un AC ne doit pas rallumer la pastille.
                pending=key in pending and minute is None,
            )
            if minute is not None:
                solved += 1
                penalty += minute + PENALTY_PER_REJECT_MIN * tries.get(key, 0)
                last = max(last, minute)
        rows.append(
            RowScore(
                user_id=user_id,
                solved=solved,
                penalty_min=penalty,
                last_solve_min=last,
                cells=cells,
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


class ContestProblemOut(AttemptedProblemRef):
    label: str
    # Éditorial disponible : renseigné seulement une fois le contest terminé
    # (conditions ICPC — fermé pendant la fenêtre, rouvert à l'upsolving).
    has_editorial: bool = False


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
    # Identité stable de la ligne : `display_name` n'est pas unique (cf. User),
    # donc c'est `user_id` qui sert de clé côté client (React key, animation FLIP,
    # diff entre rafraîchissements). Le nom reste purement de l'affichage.
    user_id: int
    display_name: str
    is_me: bool
    solved: int
    penalty_min: int
    cells: list[ScoreCellOut]  # alignées sur `problems`


class ScoreboardOut(BaseModel):
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
    """Nombre d'inscrits par contest, en une seule requête groupée."""
    if not contest_ids:
        return {}
    rows = db.execute(
        select(ContestRegistration.contest_id, func.count())
        .where(ContestRegistration.contest_id.in_(contest_ids))
        .group_by(ContestRegistration.contest_id)
    ).all()
    return dict(rows)


def _problem_counts(db: Session, contest_ids: list[int]) -> dict[int, int]:
    """Nombre de problèmes par contest, en une seule requête groupée — la liste
    n'a pas besoin de matérialiser les lignes `ContestProblem` rien que pour les
    compter."""
    if not contest_ids:
        return {}
    rows = db.execute(
        select(ContestProblem.contest_id, func.count())
        .where(ContestProblem.contest_id.in_(contest_ids))
        .group_by(ContestProblem.contest_id)
    ).all()
    return dict(rows)


@router.get("")
def list_contests(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[ContestSummary]:
    now = utcnow()
    contests = db.scalars(select(Contest).order_by(Contest.start_at.desc())).all()
    ids = [c.id for c in contests]
    reg_counts = _registration_counts(db, ids)
    prob_counts = _problem_counts(db, ids)
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
            problem_count=prob_counts.get(c.id, 0),
            registered_count=reg_counts.get(c.id, 0),
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
        problem_ids = [cp.problem_id for cp in contest.problems]
        # On ne lit la progression que sur les énoncés du contest : pas de scan de
        # tout l'historique de soumissions du membre pour une poignée de problèmes.
        solved_ids, attempted_ids = solved_attempted_ids(db, user.id, problem_ids)
        # Présence d'un éditorial : seulement une fois terminé (à l'upsolving) —
        # un seul SELECT sur les problèmes du contest, sans matérialiser le texte.
        editorial_ids: set[int] = set()
        if phase == "finished":
            editorial_ids = set(
                db.scalars(
                    select(Problem.id).where(
                        Problem.id.in_(problem_ids),
                        Problem.editorial_fr.is_not(None),
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
                attempted=cp.problem_id in attempted_ids,
                has_editorial=cp.problem_id in editorial_ids,
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
        # Un inscrit de plus = une ligne de plus au classement (même à 0 résolu).
        invalidate_scoreboard(contest.id)


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
        invalidate_scoreboard(contest.id)


# Le classement est identique pour tous les spectateurs (seul `is_me` varie) et ne
# change que lorsqu'une soumission du contest est créée ou jugée, ou que l'admin
# modifie le contest. On mémoïse donc le calcul lourd (chargement des soumissions
# + tri ICPC) par contest, invalidé explicitement à chaque écriture concernée
# (cf. invalidate_scoreboard) ; le TTL n'est qu'un filet de sécurité contre une
# voie d'invalidation oubliée ou un champ annexe (display_name), et tombe à l'infini
# pour un contest terminé (classement figé). La vue propre à chaque utilisateur
# (is_me) est superposée à la volée sur la ligne du demandeur — négligeable.


@dataclass(frozen=True)
class _BoardData:
    """Classement prêt à servir, **indépendant du spectateur** : rangs, noms,
    pénalités et cellules sont identiques pour tous. Tout le travail lourd
    (chargement, tri ICPC, attribution des rangs, validation des cellules) est
    fait une seule fois ici puis mémoïsé ; à chaque requête, build_scoreboard ne
    fait que superposer `is_me` sur la ligne du demandeur. Évite de re-classer et
    de re-valider 100×20 cellules à chaque sondage de chaque spectateur."""

    board: ScoreboardOut  # rangs calculés, toutes les lignes avec is_me=False
    me_index: dict[int, int]  # user_id -> index de sa ligne dans board.rows


_SCOREBOARD_TTL_S = 10.0
# Plafond LRU : le cache est borné pour qu'un processus de longue durée voyant
# défiler beaucoup de contests ne fasse pas croître la mémoire sans fin. Chaque
# entrée est minuscule (lignes calculées, pas d'ORM attaché) ; quelques dizaines
# suffisent largement à couvrir les contests réellement consultés en parallèle.
_SCOREBOARD_CACHE_MAX = 64
# Valeur = (échéance d'expiration monotone, données). `inf` pour un contest figé.
_board_cache: OrderedDict[int, tuple[float, _BoardData]] = OrderedDict()
_board_lock = threading.Lock()


def invalidate_scoreboard(contest_id: int) -> None:
    """À appeler après toute écriture affectant le classement d'un contest."""
    with _board_lock:
        _board_cache.pop(contest_id, None)


def _compute_board_data(db: Session, contest: Contest) -> _BoardData:
    registrations = db.scalars(
        select(ContestRegistration)
        .options(selectinload(ContestRegistration.user))
        .where(ContestRegistration.contest_id == contest.id)
    ).all()
    names = {r.user_id: r.user.display_name for r in registrations}
    problem_ids = [cp.problem_id for cp in contest.problems]
    # Seules les colonnes lues par compute_scores : ni le code source ni la sortie
    # de compilation (potentiellement volumineux) ne sont chargés.
    submissions = db.scalars(
        select(Submission)
        .options(
            load_only(
                Submission.user_id,
                Submission.problem_id,
                Submission.status,
                Submission.verdict,
                Submission.created_at,
            )
        )
        .where(Submission.contest_id == contest.id)
    ).all()
    scored = compute_scores(contest.start_at, list(names), problem_ids, list(submissions))

    out: list[ScoreRowOut] = []
    rank = 0
    previous: tuple[int, int] | None = None
    for i, row in enumerate(scored):
        # Rang partagé à égalité parfaite (résolus, pénalité), comme DOMJudge.
        if (row.solved, row.penalty_min) != previous:
            rank = i + 1
            previous = (row.solved, row.penalty_min)
        out.append(
            ScoreRowOut(
                rank=rank,
                user_id=row.user_id,
                display_name=names[row.user_id],
                is_me=False,  # superposé par spectateur dans build_scoreboard
                solved=row.solved,
                penalty_min=row.penalty_min,
                # CellScore et ScoreCellOut ont les mêmes champs : on copie par
                # attribut plutôt qu'à la main, pour qu'un champ ajouté d'un côté
                # ne soit pas silencieusement oublié de l'autre.
                cells=[
                    ScoreCellOut.model_validate(row.cells[pid], from_attributes=True)
                    for pid in problem_ids
                ],
            )
        )
    board = ScoreboardOut(problems=[cp.label for cp in contest.problems], rows=out)
    me_index = {row.user_id: i for i, row in enumerate(out)}
    return _BoardData(board=board, me_index=me_index)


def _board_data(db: Session, contest: Contest) -> _BoardData:
    now = time.monotonic()
    with _board_lock:
        cached = _board_cache.get(contest.id)
        if cached is not None and now < cached[0]:  # cached[0] = échéance d'expiration
            _board_cache.move_to_end(contest.id)  # rafraîchit l'ordre LRU
            return cached[1]
    # Calcul hors verrou : on ne sérialise pas les accès base. Deux requêtes
    # concurrentes peuvent recalculer la même chose (rare) — sans incidence.
    data = _compute_board_data(db, contest)
    # Un contest terminé est figé : son classement ne bougera plus jamais (aucune
    # soumission ne sera jugée, et l'édition admin est interdite après le début).
    # On le garde donc sans expiration — inutile de tout recalculer toutes les 10 s
    # à chaque consultation d'un classement final. En cours, le TTL court n'est
    # qu'un filet de sécurité derrière l'invalidation explicite.
    finished = contest_phase(contest, utcnow()) == "finished"
    expiry = math.inf if finished else time.monotonic() + _SCOREBOARD_TTL_S
    with _board_lock:
        _board_cache[contest.id] = (expiry, data)
        _board_cache.move_to_end(contest.id)
        while len(_board_cache) > _SCOREBOARD_CACHE_MAX:
            _board_cache.popitem(last=False)  # évince la plus ancienne entrée
    return data


def build_scoreboard(db: Session, contest: Contest, me: User | None) -> ScoreboardOut:
    """Vue par spectateur du classement mémoïsé : on ne refait que la superposition
    `is_me` sur la ligne du demandeur ; tout le reste (rangs, cellules) vient du
    cache partagé, identique pour tous."""
    data = _board_data(db, contest)
    board = data.board
    idx = data.me_index.get(me.id) if me is not None else None
    if idx is None:
        return board  # spectateur sans ligne : la vue partagée convient telle quelle
    rows = list(board.rows)
    rows[idx] = rows[idx].model_copy(update={"is_me": True})
    return ScoreboardOut(problems=board.problems, rows=rows)


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
    return build_scoreboard(db, contest, user)


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

    by_slug = {p.slug: p.id for p in db.scalars(select(Problem).where(Problem.slug.in_(slugs)))}
    missing = [s for s in slugs if s not in by_slug]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"code": "unknown_problem", "slugs": missing},
        )
    return [(by_slug[p.slug], p.label) for p in payload.problems]


def _reconcile_problems(db: Session, contest: Contest, attached: list[tuple[int, str]]) -> None:
    """Réécrit les problèmes du contest en **préservant** l'état déjà acquis des
    problèmes conservés. En particulier `first_blood_announced` : éditer un
    contest (renommer un label, ajouter un problème) ne doit pas ré-armer une
    annonce « premier sang » déjà envoyée — sinon le rejudge ou l'annonceur la
    renverrait.

    On vide puis recrée la collection avec un flush intermédiaire : les anciennes
    lignes sont supprimées **avant** l'insertion des nouvelles, faute de quoi une
    simple permutation de labels (A↔B) violerait la contrainte d'unicité
    (contest_id, label) au sein du même flush.
    """
    announced = {cp.problem_id: cp.first_blood_announced for cp in contest.problems}
    contest.problems.clear()
    db.flush()
    contest.problems.extend(
        ContestProblem(
            problem_id=pid,
            label=label,
            first_blood_announced=announced.get(pid, False),
        )
        for pid, label in attached
    )


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
        problems=[ContestProblem(problem_id=pid, label=label) for pid, label in attached],
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
    _reconcile_problems(db, contest, attached)
    db.commit()
    # Les colonnes (labels, problèmes) du classement ont pu changer.
    invalidate_scoreboard(contest.id)
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
    contest_id = contest.id
    db.delete(contest)
    db.commit()
    invalidate_scoreboard(contest_id)
