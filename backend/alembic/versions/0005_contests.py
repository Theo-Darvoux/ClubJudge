"""Phase 2 : compétitions ICPC.

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "contests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("start_announced", sa.Boolean(), nullable=False),
        sa.Column("results_announced", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_contests_slug"), "contests", ["slug"], unique=True)
    op.create_table(
        "contest_problems",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("contest_id", sa.Integer(), nullable=False),
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=2), nullable=False),
        sa.ForeignKeyConstraint(["contest_id"], ["contests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["problem_id"], ["problems.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("contest_id", "problem_id"),
        sa.UniqueConstraint("contest_id", "label"),
    )
    op.create_table(
        "contest_registrations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("contest_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "registered_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["contest_id"], ["contests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("contest_id", "user_id"),
    )
    op.add_column("submissions", sa.Column("contest_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_submissions_contest_id"), "submissions", ["contest_id"], unique=False)
    op.create_foreign_key(
        "fk_submissions_contest_id",
        "submissions",
        "contests",
        ["contest_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_submissions_contest_id", "submissions", type_="foreignkey")
    op.drop_index(op.f("ix_submissions_contest_id"), table_name="submissions")
    op.drop_column("submissions", "contest_id")
    op.drop_table("contest_registrations")
    op.drop_table("contest_problems")
    op.drop_index(op.f("ix_contests_slug"), table_name="contests")
    op.drop_table("contests")
