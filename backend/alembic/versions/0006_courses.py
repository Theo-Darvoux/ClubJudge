"""Phase 3 : cours et TP interactifs.

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=128), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_courses_slug"), "courses", ["slug"], unique=True)
    op.create_index(op.f("ix_courses_category"), "courses", ["category"], unique=False)
    op.create_table(
        "course_articles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title_fr", sa.String(length=128), nullable=False),
        sa.Column("title_en", sa.String(length=128), nullable=True),
        sa.Column("body_fr", sa.Text(), nullable=False),
        sa.Column("body_en", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("course_id", "slug"),
        sa.UniqueConstraint("course_id", "position"),
    )
    op.create_index(op.f("ix_course_articles_slug"), "course_articles", ["slug"], unique=False)
    op.create_table(
        "article_problems",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["article_id"], ["course_articles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["problem_id"], ["problems.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("article_id", "problem_id"),
    )
    op.create_index(
        op.f("ix_article_problems_problem_id"), "article_problems", ["problem_id"], unique=False
    )
    op.create_table(
        "article_reads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column(
            "read_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["article_id"], ["course_articles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "article_id"),
    )
    op.create_index(op.f("ix_article_reads_user_id"), "article_reads", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_article_reads_article_id"), "article_reads", ["article_id"], unique=False
    )
    op.create_table(
        "skill_articles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("skill_id", sa.Integer(), nullable=False),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["article_id"], ["course_articles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("skill_id", "article_id"),
    )


def downgrade() -> None:
    op.drop_table("skill_articles")
    op.drop_index(op.f("ix_article_reads_article_id"), table_name="article_reads")
    op.drop_index(op.f("ix_article_reads_user_id"), table_name="article_reads")
    op.drop_table("article_reads")
    op.drop_index(op.f("ix_article_problems_problem_id"), table_name="article_problems")
    op.drop_table("article_problems")
    op.drop_index(op.f("ix_course_articles_slug"), table_name="course_articles")
    op.drop_table("course_articles")
    op.drop_index(op.f("ix_courses_category"), table_name="courses")
    op.drop_index(op.f("ix_courses_slug"), table_name="courses")
    op.drop_table("courses")
