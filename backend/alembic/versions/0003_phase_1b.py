"""Phase 1b : tests exemples, indices progressifs, éditorial.

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "problem_hints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("content_fr", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["problem_id"], ["problems.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("problem_id", "position"),
    )
    op.add_column(
        "problem_tests",
        sa.Column("is_sample", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("problems", sa.Column("editorial_fr", sa.Text(), nullable=True))
    op.add_column("problems", sa.Column("editorial_en", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("problems", "editorial_en")
    op.drop_column("problems", "editorial_fr")
    op.drop_column("problem_tests", "is_sample")
    op.drop_table("problem_hints")
