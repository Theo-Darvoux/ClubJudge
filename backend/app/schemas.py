"""Schémas Pydantic partagés entre routeurs.

Centralise les formes recopiées d'un endpoint à l'autre : la référence à un
problème (liste, arbre, contest, cours) et la référence à un article de cours
(page problème, arbre de compétences).
"""

from pydantic import BaseModel


class ProblemRef(BaseModel):
    """Référence compacte à un problème, avec l'état « résolu » de l'utilisateur."""

    slug: str
    title: str
    difficulty: int
    solved: bool


class AttemptedProblemRef(ProblemRef):
    """ProblemRef qui distingue en plus « tenté sans réussir » de « jamais ouvert »."""

    attempted: bool


class ArticleRef(BaseModel):
    """Référence `cours/article` vers un article de cours qui couvre une notion."""

    course_slug: str
    article_slug: str
    title_fr: str
    title_en: str | None
