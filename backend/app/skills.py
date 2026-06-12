"""Arbre de compétences (PLAN.md §Phase 1.5).

Déblocage souple : l'état des nœuds (maîtrisé / recommandé / pas encore prêt)
est purement visuel, aucun problème n'est verrouillé.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_user
from app.db import get_db
from app.judge.types import Verdict
from app.models import Skill, SkillProblem, Submission, User

router = APIRouter(prefix="/api/skills", tags=["skills"])

SkillState = Literal["mastered", "recommended", "not_ready"]


class SkillProblemOut(BaseModel):
    slug: str
    title: str
    difficulty: int
    solved: bool


class SkillNodeOut(BaseModel):
    slug: str
    name_fr: str
    name_en: str | None
    description_fr: str | None
    description_en: str | None
    x: float
    y: float
    requires: list[str]
    problems: list[SkillProblemOut]
    solved_count: int
    mastery_threshold: int
    state: SkillState


@router.get("/tree")
def get_tree(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[SkillNodeOut]:
    skills = db.scalars(
        select(Skill).options(
            selectinload(Skill.prerequisites),
            selectinload(Skill.problems).selectinload(SkillProblem.problem),
        )
    ).all()
    by_id = {s.id: s for s in skills}

    solved_ids = {
        pid
        for (pid,) in db.execute(
            select(Submission.problem_id).distinct().where(
                Submission.user_id == user.id, Submission.verdict == Verdict.ACCEPTED
            )
        )
    }

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
                SkillProblemOut(
                    slug=sp.problem.slug,
                    title=sp.problem.title,
                    difficulty=sp.problem.difficulty,
                    solved=sp.problem_id in solved_ids,
                )
                for sp in s.problems
            ],
            solved_count=solved_count[s.id],
            mastery_threshold=s.mastery_threshold,
            state=state_of(s),
        )
        for s in skills
    ]
