"""Cours et TP interactifs (PLAN.md §Phase 3).

Un cours est une suite ordonnée d'articles ; un article peut embarquer des
blocs TP (fence ```tp dans le Markdown, rendus côté front comme éditeur +
juge) et lister des problèmes « pour pratiquer ». La progression est simple :
articles lus (marque explicite) et TP réussis (calculés depuis les soumissions,
comme partout ailleurs).
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_user
from app.contests import hidden_problem_ids
from app.db import get_db
from app.judge.types import Verdict
from app.models import (
    ArticleProblem,
    ArticleProblemKind,
    ArticleRead,
    Course,
    CourseArticle,
    Submission,
    User,
)

router = APIRouter(prefix="/api/courses", tags=["courses"])


class CourseSummary(BaseModel):
    slug: str
    title: str
    category: str
    description: str | None
    article_count: int
    read_count: int
    tp_total: int
    tp_solved: int


class ArticleSummary(BaseModel):
    slug: str
    title_fr: str
    title_en: str | None
    read: bool
    tp_total: int
    tp_solved: int


class CourseDetail(CourseSummary):
    articles: list[ArticleSummary]


class ArticleProblemRef(BaseModel):
    slug: str
    title: str
    difficulty: int
    solved: bool


class ArticleNeighbor(BaseModel):
    slug: str
    title_fr: str
    title_en: str | None


class ArticleDetail(BaseModel):
    slug: str
    title_fr: str
    title_en: str | None
    body_fr: str
    body_en: str | None
    read: bool
    course_slug: str
    course_title: str
    practice: list[ArticleProblemRef]
    prev: ArticleNeighbor | None
    next: ArticleNeighbor | None


def _solved_ids(db: Session, user: User) -> set[int]:
    return {
        pid
        for (pid,) in db.execute(
            select(Submission.problem_id).distinct().where(
                Submission.user_id == user.id, Submission.verdict == Verdict.ACCEPTED
            )
        )
    }


def _read_ids(db: Session, user: User) -> set[int]:
    return set(
        db.scalars(select(ArticleRead.article_id).where(ArticleRead.user_id == user.id))
    )


def _tp_ids(article: CourseArticle) -> list[int]:
    return [ap.problem_id for ap in article.problems if ap.kind == ArticleProblemKind.TP]


@router.get("")
def list_courses(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[CourseSummary]:
    courses = db.scalars(
        select(Course)
        .options(selectinload(Course.articles).selectinload(CourseArticle.problems))
        .order_by(Course.category, Course.position, Course.title)
    ).all()
    solved = _solved_ids(db, user)
    read = _read_ids(db, user)

    out = []
    for course in courses:
        tps = [pid for a in course.articles for pid in _tp_ids(a)]
        out.append(CourseSummary(
            slug=course.slug,
            title=course.title,
            category=course.category,
            description=course.description,
            article_count=len(course.articles),
            read_count=sum(1 for a in course.articles if a.id in read),
            tp_total=len(tps),
            tp_solved=sum(1 for pid in tps if pid in solved),
        ))
    return out


def _get_course_or_404(db: Session, slug: str) -> Course:
    course = db.scalar(
        select(Course)
        .options(
            selectinload(Course.articles)
            .selectinload(CourseArticle.problems)
            .selectinload(ArticleProblem.problem)
        )
        .where(Course.slug == slug)
    )
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "course_not_found")
    return course


@router.get("/{slug}")
def get_course(
    slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CourseDetail:
    course = _get_course_or_404(db, slug)
    solved = _solved_ids(db, user)
    read = _read_ids(db, user)

    articles = [
        ArticleSummary(
            slug=a.slug,
            title_fr=a.title_fr,
            title_en=a.title_en,
            read=a.id in read,
            tp_total=len(_tp_ids(a)),
            tp_solved=sum(1 for pid in _tp_ids(a) if pid in solved),
        )
        for a in course.articles
    ]
    return CourseDetail(
        slug=course.slug,
        title=course.title,
        category=course.category,
        description=course.description,
        article_count=len(articles),
        read_count=sum(1 for a in articles if a.read),
        tp_total=sum(a.tp_total for a in articles),
        tp_solved=sum(a.tp_solved for a in articles),
        articles=articles,
    )


def _get_article_or_404(course: Course, article_slug: str) -> CourseArticle:
    for article in course.articles:
        if article.slug == article_slug:
            return article
    raise HTTPException(status.HTTP_404_NOT_FOUND, "article_not_found")


@router.get("/{slug}/articles/{article_slug}")
def get_article(
    slug: str,
    article_slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> ArticleDetail:
    course = _get_course_or_404(db, slug)
    article = _get_article_or_404(course, article_slug)
    solved = _solved_ids(db, user)
    # Un problème rattaché à un contest non terminé reste secret partout, y
    # compris dans la liste « pour pratiquer ». (Un bloc TP sur un tel problème
    # tombera sur le 404 de la page problème — à éviter côté éditorial.)
    hidden = hidden_problem_ids(db, datetime.now(UTC))

    index = course.articles.index(article)
    prev = course.articles[index - 1] if index > 0 else None
    next_ = course.articles[index + 1] if index + 1 < len(course.articles) else None

    return ArticleDetail(
        slug=article.slug,
        title_fr=article.title_fr,
        title_en=article.title_en,
        body_fr=article.body_fr,
        body_en=article.body_en,
        read=db.scalar(
            select(ArticleRead.id).where(
                ArticleRead.user_id == user.id, ArticleRead.article_id == article.id
            )
        ) is not None,
        course_slug=course.slug,
        course_title=course.title,
        practice=[
            ArticleProblemRef(
                slug=ap.problem.slug,
                title=ap.problem.title,
                difficulty=ap.problem.difficulty,
                solved=ap.problem_id in solved,
            )
            for ap in article.problems
            if ap.kind == ArticleProblemKind.PRACTICE and ap.problem_id not in hidden
        ],
        prev=ArticleNeighbor(slug=prev.slug, title_fr=prev.title_fr, title_en=prev.title_en)
        if prev else None,
        next=ArticleNeighbor(slug=next_.slug, title_fr=next_.title_fr, title_en=next_.title_en)
        if next_ else None,
    )


@router.post("/{slug}/articles/{article_slug}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(
    slug: str,
    article_slug: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    course = _get_course_or_404(db, slug)
    article = _get_article_or_404(course, article_slug)
    existing = db.scalar(
        select(ArticleRead).where(
            ArticleRead.user_id == user.id, ArticleRead.article_id == article.id
        )
    )
    if existing is None:
        db.add(ArticleRead(user_id=user.id, article_id=article.id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
