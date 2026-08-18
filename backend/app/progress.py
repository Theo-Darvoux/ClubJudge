"""Agrégation de la progression d'un utilisateur sur les problèmes.

Centralise la lecture des soumissions recopiée à l'identique par la liste des
problèmes, le détail d'un problème et l'arbre de compétences : un seul passage,
une seule définition de « résolu » (≥ 1 AC) et « tenté » (≥ 1 soumission).
"""

from collections.abc import Collection

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.judge.types import NON_ATTEMPT_VERDICTS, Verdict
from app.models import Submission, SubmissionStatus


def _is_solved_agg():
    """Expression agrégée « résolu » (≥ 1 AC → 1, sinon 0 ; NULL si aucune
    soumission). Définition unique partagée par les deux lectures ci-dessous,
    pour qu'elles ne puissent pas diverger."""
    return func.max(case((Submission.verdict == Verdict.ACCEPTED, 1), else_=0))


def solved_attempted_ids(
    db: Session, user_id: int, problem_ids: Collection[int] | None = None
) -> tuple[set[int], set[int]]:
    """Renvoie (problèmes résolus, problèmes tentés) pour cet utilisateur.

    Résolu = au moins un verdict ACCEPTED ; tenté = au moins une soumission
    (résolu ⊆ tenté). Un seul aller-retour DB.

    `problem_ids` restreint le balayage à ces problèmes : un appelant qui ne
    s'intéresse qu'à une poignée de problèmes (les énoncés d'un contest) ne paie
    pas le scan de tout l'historique de l'utilisateur. `None` ⇒ tous. Une
    collection vide ⇒ aucun problème (deux ensembles vides).
    """
    if problem_ids is not None and not problem_ids:
        return set(), set()
    stmt = (
        select(
            Submission.problem_id,
            _is_solved_agg().label("is_solved"),
        )
        .where(Submission.user_id == user_id)
        .group_by(Submission.problem_id)
    )
    if problem_ids is not None:
        stmt = stmt.where(Submission.problem_id.in_(problem_ids))
    rows = db.execute(stmt).all()
    solved = {pid for pid, is_solved in rows if is_solved == 1}
    attempted = {pid for pid, _ in rows}
    return solved, attempted


def solve_stats_one(db: Session, user_id: int, problem_id: int) -> tuple[bool, bool, int | None]:
    """Renvoie (résolu, tenté, essais) pour un seul problème — même définition de
    « résolu »/« tenté » que [[solved_attempted_ids]], plus le nombre d'essais
    jugés jusqu'au premier AC inclus (badge « résolu en N essais »).

    Un « essai » suit la même définition que la pénalité du classement : seules les
    soumissions JUGÉES comptent, exclusion faite des verdicts qui ne sont pas une
    vraie tentative (CE/IE, cf. NON_ATTEMPT_VERDICTS). L'AC final est lui-même un
    essai jugé, donc compté.

    `essais` vaut None tant que le problème n'est pas résolu. Fiable entre
    sessions, là où le compte « en direct » côté client ne voit que l'historique
    courant (plafonné). Un seul passage agrégé pour le statut et le comptage.
    """
    subq = (
        select(func.min(Submission.id))
        .where(
            Submission.user_id == user_id,
            Submission.problem_id == problem_id,
            Submission.verdict == Verdict.ACCEPTED,
        )
        .scalar_subquery()
    )

    row = db.execute(
        select(
            func.max(case((Submission.verdict == Verdict.ACCEPTED, 1), else_=0)).label("is_solved"),
            func.count(Submission.id).label("total_subs"),
            func.sum(
                case(
                    (
                        (Submission.status == SubmissionStatus.DONE)
                        & Submission.verdict.not_in(NON_ATTEMPT_VERDICTS)
                        & (Submission.id <= subq),
                        1,
                    ),
                    else_=0,
                )
            ).label("attempts"),
        ).where(Submission.user_id == user_id, Submission.problem_id == problem_id)
    ).one()

    is_solved = row.is_solved == 1
    attempted = row.total_subs > 0
    attempts = int(row.attempts) if row.attempts is not None and is_solved else None
    return is_solved, attempted, attempts
