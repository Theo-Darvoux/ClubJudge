from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import (
    Session,
    defer,
    joinedload,
    load_only,
    selectinload,
    with_expression,
)

from app.auth import get_current_user
from app.contests import (
    hidden_problem_ids_select,
    is_problem_hidden,
    require_contest_access,
)
from app.db import as_utc, get_db
from app.judge.types import Verdict
from app.models import (
    ArticleProblem,
    Course,
    CourseArticle,
    Problem,
    ProblemTest,
    Submission,
    User,
)
from app.progress import solve_stats_one, solved_attempted_ids
from app.schemas import ArticleRef, AttemptedProblemRef

router = APIRouter(prefix="/api/problems", tags=["problems"])


class ProblemSummary(AttemptedProblemRef):
    tags: list[str]


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
    articles: list[ArticleRef] = []
    solved_attempts: int | None = None


@router.get("")
def list_problems(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[ProblemSummary]:
    # La liste complète est renvoyée d'un bloc : tout le filtrage (recherche,
    # tag, difficulté, statut) se fait côté client dans la vue liste.
    query = (
        select(Problem)
        .options(
            load_only(Problem.slug, Problem.title, Problem.difficulty),
            selectinload(Problem.tags),
        )
        .order_by(Problem.difficulty, Problem.title)
    )
    # Les problèmes d'un contest non terminé restent secrets ; ils rejoignent
    # la liste à la fin de la fenêtre (upsolving, PLAN.md Phase 2).
    # L'administrateur voit tous les problèmes dans la liste.
    if user.role != "admin":
        query = query.where(Problem.id.not_in(hidden_problem_ids_select(datetime.now(UTC))))
    problems = db.scalars(query).all()

    solved, attempted = solved_attempted_ids(db, user.id)

    return [
        ProblemSummary(
            slug=p.slug,
            title=p.title,
            difficulty=p.difficulty,
            tags=[t.tag for t in p.tags],
            solved=p.id in solved,
            attempted=p.id in attempted,
        )
        for p in problems
    ]


@router.get("/{slug}")
def get_problem(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> ProblemDetail:
    # Les énoncés d'éditorial (Text potentiellement longs) ne servent ici qu'à
    # calculer `has_editorial` : on les diffère et on teste leur présence via une
    # expression booléenne chargée dans la même requête (pas d'aller-retour en plus).
    problem = get_problem_or_404(
        db,
        slug,
        options=[
            selectinload(Problem.tags),
            selectinload(Problem.hints),
            # Seuls les exemples (is_sample) servent à l'énoncé : on les charge
            # filtrés dans la même phase d'eager-loading que tags/indices (un seul
            # lot batché), sans matérialiser les tests cachés ni payer un
            # aller-retour séparé. La relation est déjà triée par position.
            selectinload(Problem.tests.and_(ProblemTest.is_sample)),
            defer(Problem.editorial_fr),
            defer(Problem.editorial_en),
            with_expression(Problem.has_editorial, Problem.editorial_fr.is_not(None)),
        ],
    )

    now = datetime.now(UTC)

    contest_info = require_contest_access(db, user, problem.id, now)

    contest_ref: ProblemContestRef | None = None
    if contest_info is not None:
        contest_ref = ProblemContestRef(
            slug=contest_info.contest.slug,
            title=contest_info.contest.title,
            label=contest_info.label,
            end_at=as_utc(contest_info.contest.end_at),
        )

    # Exemples chargés avec le problème (selectinload filtré ci-dessus), déjà
    # triés par position : pas de requête supplémentaire ici.
    samples = problem.tests

    solved, attempted, solved_attempts = solve_stats_one(db, user.id, problem.id)

    # Articles de cours qui couvrent la notion : uniquement si pas en contest (conditions ICPC).
    article_rows = []
    if contest_ref is None:
        article_rows = db.execute(
            select(Course.slug, CourseArticle.slug, CourseArticle.title_fr, CourseArticle.title_en)
            .join(CourseArticle, CourseArticle.course_id == Course.id)
            .join(ArticleProblem, ArticleProblem.article_id == CourseArticle.id)
            .where(ArticleProblem.problem_id == problem.id)
            .order_by(Course.slug, CourseArticle.position)
        ).all()
    return ProblemDetail(
        slug=problem.slug,
        title=problem.title,
        difficulty=problem.difficulty,
        tags=[t.tag for t in problem.tags],
        solved=solved,
        attempted=attempted,
        statement_fr=problem.statement_fr,
        statement_en=problem.statement_en,
        time_limit_s=problem.time_limit_s,
        memory_limit_kb=problem.memory_limit_kb,
        samples=[SampleOut(input=t.input, expected_output=t.expected_output) for t in samples],
        # Pendant un contest, pas d'indices, d'éditorial ni de lien vers le
        # cours qui couvre la notion : conditions ICPC.
        hints=[] if contest_ref else [h.content_fr for h in problem.hints],
        # Pas d'éditorial pendant un contest ; sinon, présence chargée avec le
        # problème (with_expression) sans matérialiser le texte différé.
        has_editorial=contest_ref is None and bool(problem.has_editorial),
        contest=contest_ref,
        articles=[
            ArticleRef(course_slug=c_slug, article_slug=a_slug, title_fr=t_fr, title_en=t_en)
            for c_slug, a_slug, t_fr, t_en in article_rows
        ],
        solved_attempts=solved_attempts,
    )


class SolveStatsOut(BaseModel):
    solved: bool
    attempted: bool
    solved_attempts: int | None = None


@router.get("/{slug}/solve-stats")
def get_solve_stats(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> SolveStatsOut:
    """Statut de résolution seul (résolu / tenté / essais jusqu'au premier AC).

    Pendant léger là où `GET /{slug}` est lourd : sert à rafraîchir le badge
    « résolu en N essais » juste après une résolution en direct, sans re-télécharger
    l'énoncé, les exemples et les indices."""
    problem_id = get_problem_id_or_404(db, slug)
    solved, attempted, solved_attempts = solve_stats_one(db, user.id, problem_id)
    return SolveStatsOut(solved=solved, attempted=attempted, solved_attempts=solved_attempts)


def get_problem_or_404(db: Session, slug: str, options=None) -> Problem:
    """Charge un problème par slug ou lève une 404 — le lookup partagé par la
    page problème, les soumissions et les exécutions d'essai."""
    stmt = select(Problem).where(Problem.slug == slug)
    if options:
        stmt = stmt.options(*options)
    problem = db.scalar(stmt)
    if problem is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")
    return problem


def get_problem_id_or_404(db: Session, slug: str) -> int:
    """Résout un slug en id de problème ou lève une 404 — variante légère de
    `get_problem_or_404` quand seul l'id est requis (solve-stats, solutions)."""
    problem_id = db.scalar(select(Problem.id).where(Problem.slug == slug))
    if problem_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "problem_not_found")
    return problem_id


def _require_editorial_access(db: Session, user: User, problem_id: int) -> None:
    """Porte commune à l'éditorial et aux solutions des autres. Deux conditions,
    toujours vérifiées ensemble (PLAN.md) :
      - le contest, s'il y en a un, doit être terminé (conditions ICPC, même
        après son propre AC) ;
      - on doit avoir au moins un AC sur le problème (« on apprend en séchant »).
    Bypassé pour les administrateurs."""
    if user.role == "admin":
        return
    if is_problem_hidden(db, problem_id, datetime.now(UTC)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "contest_running")
    solved = db.scalar(
        select(Submission.id)
        .where(
            Submission.user_id == user.id,
            Submission.problem_id == problem_id,
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
    problem_id = get_problem_id_or_404(db, slug)
    # Autorisation d'abord : ne pas révéler l'existence (ou non) d'un éditorial à
    # qui n'y a pas encore droit (contest en cours, ou pas encore résolu).
    _require_editorial_access(db, user, problem_id)
    row = db.execute(
        select(Problem.editorial_fr, Problem.editorial_en).where(Problem.id == problem_id)
    ).first()
    if row is None or row.editorial_fr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no_editorial")
    return EditorialOut(editorial_fr=row.editorial_fr, editorial_en=row.editorial_en)



class SolutionOut(BaseModel):
    id: int
    author: str
    is_mine: bool
    language: str
    time_s: float | None
    memory_kb: int | None
    created_at: datetime
    source_code: str
    # « Plus rapide que X % » : renseigné uniquement pour les solutions de
    # l'appelant (is_mine), None pour celles des autres — c'est tout ce que le
    # client affiche.
    percentile: int | None = None


@router.get("/{slug}/solutions")
def list_solutions(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[SolutionOut]:
    problem_id = get_problem_id_or_404(db, slug)
    _require_editorial_access(db, user, problem_id)

    # Récupérer uniquement la meilleure soumission (la plus rapide puis la plus ancienne)
    # par utilisateur et par langage via un ROW_NUMBER().
    subq = (
        select(
            Submission.id,
            Submission.user_id,
            Submission.language,
            Submission.time_s,
            func.row_number()
            .over(
                partition_by=(Submission.user_id, Submission.language),
                order_by=(Submission.time_s.asc().nulls_last(), Submission.created_at.asc()),
            )
            .label("rn"),
        )
        .where(Submission.problem_id == problem_id, Submission.verdict == Verdict.ACCEPTED)
        .subquery()
    )

    solvers_subq = (
        select(
            subq.c.id,
            subq.c.language,
            subq.c.time_s,
            func.count()
            .over(partition_by=subq.c.language)
            .label("total_solvers"),
            func.rank()
            .over(
                partition_by=subq.c.language,
                order_by=subq.c.time_s.desc().nulls_last(),
            )
            .label("slower_solvers_plus_one"),
        )
        .where(subq.c.rn == 1)
        .subquery()
    )

    query = (
        select(
            Submission,
            solvers_subq.c.total_solvers,
            solvers_subq.c.slower_solvers_plus_one,
        )
        # Seul display_name est rendu : inutile de charger le hash du mot de passe.
        .options(joinedload(Submission.user).load_only(User.display_name))
        .join(solvers_subq, Submission.id == solvers_subq.c.id)
        .order_by(Submission.time_s.asc().nulls_last(), Submission.created_at.asc())
        # On borne le payload aux 50 solutions les PLUS RAPIDES. Conséquence assumée :
        # le tri « plus récentes » côté client ne porte que sur ces 50 — au-delà de
        # 50 résolveurs (× langage), les solutions lentes mais récentes ne sont pas
        # renvoyées. Acceptable à l'échelle d'un club ; à revoir (pagination) si la
        # base grossit.
        .limit(50)
    )
    best = db.execute(query).all()

    solutions_out = []
    for s, total, rank in best:
        is_mine = s.user_id == user.id
        # Le rang (window function ci-dessus) est calculé sur TOUS les résolveurs —
        # c'est ce qui donne le classement. Mais on ne renseigne le percentile que
        # pour les solutions de l'appelant : seul son propre « plus rapide que X % »
        # est affiché (cf. SolutionsPanel). On ne sérialise donc pas un champ que le
        # client ignore pour les solutions des autres.
        pct = None
        if is_mine and total is not None and total > 1 and s.time_s is not None and rank is not None:
            slower = rank - 1
            pct = round((100 * slower) / (total - 1))
        solutions_out.append(
            SolutionOut(
                id=s.id,
                author=s.user.display_name,
                is_mine=is_mine,
                language=s.language,
                time_s=s.time_s,
                memory_kb=s.memory_kb,
                created_at=s.created_at,
                source_code=s.source_code,
                percentile=pct,
            )
        )
    return solutions_out
