"""Validation des solutions de référence et synchronisation en base."""

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.content.loader import (
    ContentError,
    LoadedCourse,
    LoadedProblem,
    LoadedSkill,
    load_problem,
)
from app.judge.base import Judge
from app.judge.types import Verdict
from app.models import (
    ArticleProblem,
    ArticleProblemKind,
    Course,
    CourseArticle,
    Problem,
    ProblemHint,
    ProblemTag,
    ProblemTest,
    Skill,
    SkillArticle,
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
    problem.hints = [ProblemHint(position=i + 1, content_fr=h) for i, h in enumerate(loaded.hints)]
    db.commit()
    return problem


async def import_problem_dir(db: Session, judge: Judge, problem_dir: Path) -> Problem:
    loaded = load_problem(problem_dir)
    await validate_solutions(loaded, judge)
    return upsert_problem(db, loaded)


def sync_courses(db: Session, loaded: list[LoadedCourse]) -> list[Course]:
    """Synchronise les cours par upsert (et non par resynchronisation totale
    comme l'arbre de compétences) : les marques « article lu » des membres
    pointent sur les articles et doivent survivre à une mise à jour du contenu.
    Les cours/articles disparus du dépôt sont supprimés (avec leurs marques)."""
    problems = {p.slug: p for p in db.scalars(select(Problem))}
    for course_def in loaded:
        missing = sorted(
            {
                s
                for a in course_def.articles
                for s in [*a.tp_problems, *a.practice]
                if s not in problems
            }
        )
        if missing:
            raise ContentError(
                Path(f"courses/{course_def.slug}"),
                f"problème(s) absent(s) de la base (importez les problèmes d'abord) : {missing}",
            )

    courses = {c.slug: c for c in db.scalars(select(Course))}
    for slug in set(courses) - {c.slug for c in loaded}:
        db.delete(courses.pop(slug))

    result: list[Course] = []
    for course_def in loaded:
        course = courses.get(course_def.slug)
        if course is None:
            course = Course(slug=course_def.slug)
            db.add(course)
        course.title = course_def.title
        course.category = course_def.category
        course.description = course_def.description
        course.position = course_def.position

        existing = {a.slug: a for a in course.articles}
        for slug in set(existing) - {a.slug for a in course_def.articles}:
            course.articles.remove(existing.pop(slug))
        # Deux temps pour les positions : libérer d'abord les anciennes, sinon
        # la contrainte d'unicité (course_id, position) saute pendant le flush.
        for i, article in enumerate(existing.values()):
            article.position = -(i + 1)
        db.flush()
        for article_def in course_def.articles:
            article = existing.get(article_def.slug)
            if article is None:
                article = CourseArticle(slug=article_def.slug)
                course.articles.append(article)
            article.position = article_def.position
            article.title_fr = article_def.title_fr
            article.title_en = article_def.title_en
            article.body_fr = article_def.body_fr
            article.body_en = article_def.body_en
            article.problems.clear()
            db.flush()
            article.problems = [
                ArticleProblem(
                    problem_id=problems[slug].id, kind=ArticleProblemKind.TP, position=i + 1
                )
                for i, slug in enumerate(article_def.tp_problems)
            ] + [
                ArticleProblem(
                    problem_id=problems[slug].id,
                    kind=ArticleProblemKind.PRACTICE,
                    position=i + 1,
                )
                for i, slug in enumerate(article_def.practice)
            ]
        result.append(course)
    db.commit()
    return result


def _article_ids_by_ref(db: Session) -> dict[str, int]:
    rows = db.execute(
        select(Course.slug, CourseArticle.slug, CourseArticle.id).join(
            CourseArticle, CourseArticle.course_id == Course.id
        )
    )
    return {f"{course_slug}/{article_slug}": aid for course_slug, article_slug, aid in rows}


def sync_skills(db: Session, loaded: list[LoadedSkill]) -> list[Skill]:
    """Remplace l'arbre de compétences par celui du dépôt de contenu. Aucune
    donnée utilisateur n'est rattachée aux nœuds (la progression est calculée
    depuis les soumissions), donc la resynchronisation totale est sans perte."""
    problems = {p.slug: p for p in db.scalars(select(Problem))}
    articles = _article_ids_by_ref(db)
    for skill_def in loaded:
        missing = [s for s in skill_def.problems if s not in problems]
        if missing:
            raise ContentError(
                Path("skills.yaml"),
                f"nœud `{skill_def.id}` : problème(s) absent(s) de la base "
                f"(importez les problèmes d'abord) : {missing}",
            )
        missing = [a for a in skill_def.articles if a not in articles]
        if missing:
            raise ContentError(
                Path("skills.yaml"),
                f"nœud `{skill_def.id}` : article(s) absent(s) de la base "
                f"(importez les cours d'abord) : {missing}",
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
            articles=[
                SkillArticle(article_id=articles[ref], position=i + 1)
                for i, ref in enumerate(skill_def.articles)
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
