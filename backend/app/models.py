from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
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
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    tags: Mapped[list["ProblemTag"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan"
    )
    tests: Mapped[list["ProblemTest"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan", order_by="ProblemTest.position"
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

    problem: Mapped[Problem] = relationship(back_populates="tests")


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (Index("ix_submissions_user_problem", "user_id", "problem_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id", ondelete="CASCADE"))
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
