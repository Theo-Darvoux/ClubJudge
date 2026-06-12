"""Validation des solutions de référence et synchronisation en base."""

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.content.loader import ContentError, LoadedProblem, LoadedSkill, load_problem
from app.judge.base import Judge
from app.judge.types import Verdict
from app.models import (
    Problem,
    ProblemHint,
    ProblemTag,
    ProblemTest,
    Skill,
    SkillPrerequisite,
    SkillProblem,
)


async def validate_solutions(problem: LoadedProblem, judge: Judge) -> None:
    """Garde-fou qualité : chaque solution de référence doit avoir AC dans les
    limites du problème, sinon l'import est refusé (PLAN.md §7)."""
    for solution in problem.solutions:
        result = await judge.submit(
            solution.source_code,
            solution.language,
            problem.tests,
            time_limit_s=problem.time_limit_s,
            memory_limit_kb=problem.memory_limit_kb,
        )
        if result.verdict is not Verdict.ACCEPTED:
            raise ContentError(
                solution.path,
                f"la solution de référence obtient {result.verdict} au lieu de AC "
                f"(temps max {result.max_time_s}s / limite {problem.time_limit_s}s)",
            )


def upsert_problem(db: Session, loaded: LoadedProblem) -> Problem:
    problem = db.scalar(select(Problem).where(Problem.slug == loaded.slug))
    if problem is None:
        problem = Problem(slug=loaded.slug)
        db.add(problem)

    problem.title = loaded.title
    problem.category = loaded.category
    problem.difficulty = loaded.difficulty
    problem.time_limit_s = loaded.time_limit_s
    problem.memory_limit_kb = loaded.memory_limit_kb
    problem.statement_fr = loaded.statement_fr
    problem.statement_en = loaded.statement_en
    problem.editorial_fr = loaded.editorial_fr
    problem.editorial_en = loaded.editorial_en
    # Supprimer les anciens tags/tests/indices avant d'insérer les nouveaux, sinon
    # les contraintes d'unicité sautent (l'INSERT est flushé avant le DELETE orphelin).
    problem.tags.clear()
    problem.tests.clear()
    problem.hints.clear()
    db.flush()
    problem.tags = [ProblemTag(tag=t) for t in loaded.tags]
    problem.tests = [
        ProblemTest(
            position=i + 1,
            input=t.input,
            expected_output=t.expected_output,
            is_sample=i < loaded.sample_count,
        )
        for i, t in enumerate(loaded.tests)
    ]
    problem.hints = [
        ProblemHint(position=i + 1, content_fr=h) for i, h in enumerate(loaded.hints)
    ]
    db.commit()
    return problem


async def import_problem_dir(db: Session, judge: Judge, problem_dir: Path) -> Problem:
    loaded = load_problem(problem_dir)
    await validate_solutions(loaded, judge)
    return upsert_problem(db, loaded)


def sync_skills(db: Session, loaded: list[LoadedSkill]) -> list[Skill]:
    """Remplace l'arbre de compétences par celui du dépôt de contenu. Aucune
    donnée utilisateur n'est rattachée aux nœuds (la progression est calculée
    depuis les soumissions), donc la resynchronisation totale est sans perte."""
    problems = {p.slug: p for p in db.scalars(select(Problem))}
    for skill_def in loaded:
        missing = [s for s in skill_def.problems if s not in problems]
        if missing:
            raise ContentError(
                Path("skills.yaml"),
                f"nœud `{skill_def.id}` : problème(s) absent(s) de la base "
                f"(importez les problèmes d'abord) : {missing}",
            )

    for skill in db.scalars(select(Skill)):
        db.delete(skill)
    db.flush()

    skills: dict[str, Skill] = {}
    for skill_def in loaded:
        skill = Skill(
            slug=skill_def.id,
            name_fr=skill_def.name_fr,
            name_en=skill_def.name_en,
            description_fr=skill_def.description_fr,
            description_en=skill_def.description_en,
            x=skill_def.x,
            y=skill_def.y,
            mastery_threshold=skill_def.mastery,
            problems=[
                SkillProblem(problem_id=problems[slug].id, position=i + 1)
                for i, slug in enumerate(skill_def.problems)
            ],
        )
        db.add(skill)
        skills[skill_def.id] = skill
    db.flush()
    for skill_def in loaded:
        skills[skill_def.id].prerequisites = [
            SkillPrerequisite(prerequisite_id=skills[req].id) for req in skill_def.requires
        ]
    db.commit()
    return list(skills.values())
