"""Arbre de compétences (PLAN.md §Phase 1.5).

Déblocage souple : l'état des nœuds (maîtrisé / recommandé / pas encore prêt)
est purement visuel, aucun problème n'est verrouillé.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only, selectinload

from app.auth import get_current_user
from app.db import get_db
from app.models import CourseArticle, Problem, Skill, SkillArticle, SkillProblem, User
from app.progress import solved_attempted_ids
from app.schemas import ArticleRef, AttemptedProblemRef

router = APIRouter(prefix="/api/skills", tags=["skills"])

SkillState = Literal["mastered", "recommended", "not_ready"]


class SkillNodeOut(BaseModel):
    slug: str
    name_fr: str
    name_en: str | None
    description_fr: str | None
    description_en: str | None
    x: float
    y: float
    requires: list[str]
    problems: list[AttemptedProblemRef]
    solved_count: int
    mastery_threshold: int
    state: SkillState
    articles: list[ArticleRef]


@router.get("/tree")
def get_tree(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[SkillNodeOut]:
    # Les problèmes de l'arbre de compétences sont une sélection de problèmes
    # programmés/curés par les administrateurs qui n'ont pas vocation à servir de
    # problèmes secrets de contest. Le filtrage des problèmes cachés y est donc omis
    # de manière intentionnelle (les problèmes de l'arbre ne sont pas censés être utilisés
    # en contest).
    skills = db.scalars(
        select(Skill)
        .options(
            selectinload(Skill.prerequisites),
            selectinload(Skill.problems)
            .joinedload(SkillProblem.problem)
            .options(load_only(Problem.slug, Problem.title, Problem.difficulty)),
            selectinload(Skill.articles)
            .joinedload(SkillArticle.article)
            .options(load_only(CourseArticle.slug, CourseArticle.title_fr, CourseArticle.title_en))
            .joinedload(CourseArticle.course),
        )
        # Ordre déterministe : la sélection initiale du panneau (premier nœud
        # recommandé) et l'ordre des recommandations côté liste en dépendent.
        .order_by(Skill.id)
    ).all()
    by_id = {s.id: s for s in skills}

    # Tenté = au moins une soumission, résolu = au moins un verdict ACCEPTED.
    # Permet au panneau de l'arbre de distinguer « essayé sans réussir » de
    # « jamais ouvert », comme la vue liste (logique partagée).
    solved_ids, attempted_ids = solved_attempted_ids(db, user.id)

    solved_count = {
        s.id: sum(1 for sp in s.problems if sp.problem_id in solved_ids) for s in skills
    }
    mastered = {s.id for s in skills if solved_count[s.id] >= s.mastery_threshold}

    def state_of(skill: Skill) -> SkillState:
        if skill.id in mastered:
            return "mastered"
        if all(p.prerequisite_id in mastered for p in skill.prerequisites):
            return "recommended"
        return "not_ready"

    return [
        SkillNodeOut(
            slug=s.slug,
            name_fr=s.name_fr,
            name_en=s.name_en,
            description_fr=s.description_fr,
            description_en=s.description_en,
            x=s.x,
            y=s.y,
            requires=[by_id[p.prerequisite_id].slug for p in s.prerequisites],
            problems=[
                AttemptedProblemRef(
                    slug=sp.problem.slug,
                    title=sp.problem.title,
                    difficulty=sp.problem.difficulty,
                    solved=sp.problem_id in solved_ids,
                    attempted=sp.problem_id in attempted_ids,
                )
                for sp in s.problems
            ],
            solved_count=solved_count[s.id],
            mastery_threshold=s.mastery_threshold,
            state=state_of(s),
            articles=[
                ArticleRef(
                    course_slug=sa.article.course.slug,
                    article_slug=sa.article.slug,
                    title_fr=sa.article.title_fr,
                    title_en=sa.article.title_en,
                )
                for sa in s.articles
            ],
        )
        for s in skills
    ]
