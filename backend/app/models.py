from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Role(StrEnum):
    MEMBER = "member"
    ADMIN = "admin"


class SubmissionStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(16), default=Role.MEMBER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    submissions: Mapped[list["Submission"]] = relationship(back_populates="user")


class UserSession(Base):
    __tablename__ = "user_sessions"

    # SHA-256 du token de session : un dump de la base ne donne pas les cookies.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship()


class Problem(Base):
    __tablename__ = "problems"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(64), index=True)
    difficulty: Mapped[int] = mapped_column(Integer, index=True)  # 1 (intro) à 5 (boss)
    time_limit_s: Mapped[float] = mapped_column(default=2.0)
    memory_limit_kb: Mapped[int] = mapped_column(default=262_144)
    statement_fr: Mapped[str] = mapped_column(Text)
    statement_en: Mapped[str | None] = mapped_column(Text, default=None)
    editorial_fr: Mapped[str | None] = mapped_column(Text, default=None)
    editorial_en: Mapped[str | None] = mapped_column(Text, default=None)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    tags: Mapped[list["ProblemTag"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan"
    )
    tests: Mapped[list["ProblemTest"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan", order_by="ProblemTest.position"
    )
    hints: Mapped[list["ProblemHint"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan", order_by="ProblemHint.position"
    )


class ProblemTag(Base):
    __tablename__ = "problem_tags"
    __table_args__ = (UniqueConstraint("problem_id", "tag"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    tag: Mapped[str] = mapped_column(String(48), index=True)

    problem: Mapped[Problem] = relationship(back_populates="tags")


class ProblemTest(Base):
    __tablename__ = "problem_tests"
    __table_args__ = (UniqueConstraint("problem_id", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    input: Mapped[str] = mapped_column(Text)
    expected_output: Mapped[str] = mapped_column(Text)
    # Les exemples de l'énoncé : visibles, et exécutables sans soumettre.
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)

    problem: Mapped[Problem] = relationship(back_populates="tests")


class ProblemHint(Base):
    __tablename__ = "problem_hints"
    __table_args__ = (UniqueConstraint("problem_id", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    content_fr: Mapped[str] = mapped_column(Text)

    problem: Mapped[Problem] = relationship(back_populates="hints")


class Skill(Base):
    """Nœud de l'arbre de compétences (content/skills.yaml), synchronisé à
    l'import. Positions fixées à la main par l'auteur de l'arbre."""

    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name_fr: Mapped[str] = mapped_column(String(64))
    name_en: Mapped[str | None] = mapped_column(String(64), default=None)
    description_fr: Mapped[str | None] = mapped_column(Text, default=None)
    description_en: Mapped[str | None] = mapped_column(Text, default=None)
    x: Mapped[float] = mapped_column()
    y: Mapped[float] = mapped_column()
    # Nb de problèmes du nœud à résoudre pour le considérer maîtrisé.
    mastery_threshold: Mapped[int] = mapped_column(Integer)

    prerequisites: Mapped[list["SkillPrerequisite"]] = relationship(
        back_populates="skill",
        cascade="all, delete-orphan",
        foreign_keys="SkillPrerequisite.skill_id",
    )
    problems: Mapped[list["SkillProblem"]] = relationship(
        back_populates="skill", cascade="all, delete-orphan", order_by="SkillProblem.position"
    )
    articles: Mapped[list["SkillArticle"]] = relationship(
        back_populates="skill", cascade="all, delete-orphan", order_by="SkillArticle.position"
    )


class SkillPrerequisite(Base):
    __tablename__ = "skill_prerequisites"
    __table_args__ = (UniqueConstraint("skill_id", "prerequisite_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"))
    prerequisite_id: Mapped[int] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"))

    skill: Mapped[Skill] = relationship(
        back_populates="prerequisites", foreign_keys=[skill_id]
    )
    prerequisite: Mapped[Skill] = relationship(foreign_keys=[prerequisite_id])


class SkillProblem(Base):
    __tablename__ = "skill_problems"
    __table_args__ = (UniqueConstraint("skill_id", "problem_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"))
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)

    skill: Mapped[Skill] = relationship(back_populates="problems")
    problem: Mapped[Problem] = relationship()


class Course(Base):
    """Cours (content/courses/<slug>/) : une suite ordonnée d'articles dans une
    catégorie. Synchronisé à l'import par upsert (les marques de lecture des
    membres survivent à une mise à jour du contenu)."""

    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(64), index=True)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    # Ordre d'affichage dans la catégorie (course.yaml, défaut 0 puis titre).
    position: Mapped[int] = mapped_column(Integer, default=0)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    articles: Mapped[list["CourseArticle"]] = relationship(
        back_populates="course", cascade="all, delete-orphan", order_by="CourseArticle.position"
    )


class CourseArticle(Base):
    __tablename__ = "course_articles"
    __table_args__ = (
        UniqueConstraint("course_id", "slug"),
        UniqueConstraint("course_id", "position"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    slug: Mapped[str] = mapped_column(String(64), index=True)
    position: Mapped[int] = mapped_column(Integer)  # préfixe NN- du nom de fichier
    title_fr: Mapped[str] = mapped_column(String(128))
    title_en: Mapped[str | None] = mapped_column(String(128), default=None)
    body_fr: Mapped[str] = mapped_column(Text)
    body_en: Mapped[str | None] = mapped_column(Text, default=None)

    course: Mapped[Course] = relationship(back_populates="articles")
    problems: Mapped[list["ArticleProblem"]] = relationship(
        back_populates="article", cascade="all, delete-orphan", order_by="ArticleProblem.position"
    )


class ArticleProblemKind(StrEnum):
    TP = "tp"  # bloc TP interactif dans le corps de l'article
    PRACTICE = "practice"  # « pour pratiquer » (frontmatter de l'article)


class ArticleProblem(Base):
    __tablename__ = "article_problems"
    __table_args__ = (UniqueConstraint("article_id", "problem_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(
        ForeignKey("course_articles.id", ondelete="CASCADE")
    )
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("problems.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    position: Mapped[int] = mapped_column(Integer)

    article: Mapped[CourseArticle] = relationship(back_populates="problems")
    problem: Mapped[Problem] = relationship()


class ArticleRead(Base):
    """Marque « article lu » par membre — le suivi de progression des cours
    (les TP réussis, eux, se calculent depuis les soumissions)."""

    __tablename__ = "article_reads"
    __table_args__ = (UniqueConstraint("user_id", "article_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    article_id: Mapped[int] = mapped_column(
        ForeignKey("course_articles.id", ondelete="CASCADE"), index=True
    )
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SkillArticle(Base):
    """Lien d'un nœud de l'arbre de compétences vers un article de cours
    (clé `articles` de skills.yaml — reliquat de la Phase 1.5)."""

    __tablename__ = "skill_articles"
    __table_args__ = (UniqueConstraint("skill_id", "article_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    skill_id: Mapped[int] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"))
    article_id: Mapped[int] = mapped_column(
        ForeignKey("course_articles.id", ondelete="CASCADE")
    )
    position: Mapped[int] = mapped_column(Integer)

    skill: Mapped["Skill"] = relationship(back_populates="articles")
    article: Mapped[CourseArticle] = relationship()


class Contest(Base):
    """Compétition ICPC : une fenêtre temporelle, un ensemble de problèmes
    lettrés (A, B, C…), des inscrits. Les problèmes rattachés à un contest non
    terminé sont cachés de la liste générale ; ils la rejoignent à la fin
    (upsolving)."""

    __tablename__ = "contests"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Annonces Discord déjà envoyées (la tâche d'annonce ne les renvoie pas).
    start_announced: Mapped[bool] = mapped_column(Boolean, default=False)
    results_announced: Mapped[bool] = mapped_column(Boolean, default=False)

    problems: Mapped[list["ContestProblem"]] = relationship(
        back_populates="contest", cascade="all, delete-orphan", order_by="ContestProblem.label"
    )
    registrations: Mapped[list["ContestRegistration"]] = relationship(
        back_populates="contest", cascade="all, delete-orphan"
    )


class ContestProblem(Base):
    __tablename__ = "contest_problems"
    __table_args__ = (
        UniqueConstraint("contest_id", "problem_id"),
        UniqueConstraint("contest_id", "label"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    contest_id: Mapped[int] = mapped_column(ForeignKey("contests.id", ondelete="CASCADE"))
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(2))  # lettre ICPC : A, B, C…

    contest: Mapped[Contest] = relationship(back_populates="problems")
    problem: Mapped[Problem] = relationship()


class ContestRegistration(Base):
    __tablename__ = "contest_registrations"
    __table_args__ = (UniqueConstraint("contest_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    contest_id: Mapped[int] = mapped_column(ForeignKey("contests.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    contest: Mapped[Contest] = relationship(back_populates="registrations")
    user: Mapped[User] = relationship()


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (Index("ix_submissions_user_problem", "user_id", "problem_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
    # Renseigné quand la soumission est faite pendant un contest où
    # l'utilisateur est inscrit — c'est elle qui alimente le scoreboard.
    contest_id: Mapped[int | None] = mapped_column(
        ForeignKey("contests.id", ondelete="SET NULL"), default=None, index=True
    )
    language: Mapped[str] = mapped_column(String(16))
    source_code: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default=SubmissionStatus.QUEUED, index=True)
    verdict: Mapped[str | None] = mapped_column(String(8), default=None)
    time_s: Mapped[float | None] = mapped_column(default=None)
    memory_kb: Mapped[int | None] = mapped_column(default=None)
    compile_output: Mapped[str | None] = mapped_column(Text, default=None)
    failed_test: Mapped[int | None] = mapped_column(default=None)  # position du 1er test non-AC
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    judged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    user: Mapped[User] = relationship(back_populates="submissions")
    problem: Mapped[Problem] = relationship()
    contest: Mapped[Contest | None] = relationship()
