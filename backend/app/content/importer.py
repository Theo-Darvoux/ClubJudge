"""Validation des solutions de référence et synchronisation en base."""

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.content.loader import ContentError, LoadedProblem, load_problem
from app.judge.base import Judge
from app.judge.types import Verdict
from app.models import Problem, ProblemTag, ProblemTest


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
    # Supprimer les anciens tags/tests avant d'insérer les nouveaux, sinon les
    # contraintes d'unicité sautent (l'INSERT est flushé avant le DELETE orphelin).
    problem.tags.clear()
    problem.tests.clear()
    db.flush()
    problem.tags = [ProblemTag(tag=t) for t in loaded.tags]
    problem.tests = [
        ProblemTest(position=i + 1, input=t.input, expected_output=t.expected_output)
        for i, t in enumerate(loaded.tests)
    ]
    db.commit()
    return problem


async def import_problem_dir(db: Session, judge: Judge, problem_dir: Path) -> Problem:
    loaded = load_problem(problem_dir)
    await validate_solutions(loaded, judge)
    return upsert_problem(db, loaded)
