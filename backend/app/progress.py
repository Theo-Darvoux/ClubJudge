"""Agrégation de la progression d'un utilisateur sur les problèmes.

Centralise la lecture des soumissions recopiée à l'identique par la liste des
problèmes, le détail d'un problème et l'arbre de compétences : un seul passage,
une seule définition de « résolu » (≥ 1 AC) et « tenté » (≥ 1 soumission).
"""

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.judge.types import Verdict
from app.models import Submission


def solved_attempted_ids(db: Session, user_id: int) -> tuple[set[int], set[int]]:
    """Renvoie (problèmes résolus, problèmes tentés) pour cet utilisateur.

    Résolu = au moins un verdict ACCEPTED ; tenté = au moins une soumission
    (résolu ⊆ tenté). Un seul aller-retour DB.
    """
    rows = db.execute(
        select(
            Submission.problem_id,
            func.max(case((Submission.verdict == Verdict.ACCEPTED, 1), else_=0)).label("is_solved"),
        )
        .where(Submission.user_id == user_id)
        .group_by(Submission.problem_id)
    ).all()
    solved = {pid for pid, is_solved in rows if is_solved == 1}
    attempted = {pid for pid, _ in rows}
    return solved, attempted


def solved_attempted_one(db: Session, user_id: int, problem_id: int) -> tuple[bool, bool]:
    """Renvoie (résolu, tenté) pour un seul problème — même définition que
    [[solved_attempted_ids]] mais sans matérialiser tous les problèmes."""
    is_solved = db.scalar(
        select(func.max(case((Submission.verdict == Verdict.ACCEPTED, 1), else_=0))).where(
            Submission.user_id == user_id, Submission.problem_id == problem_id
        )
    )
    # max() sur un ensemble vide renvoie NULL : aucune soumission ⇒ pas tenté.
    return is_solved == 1, is_solved is not None
