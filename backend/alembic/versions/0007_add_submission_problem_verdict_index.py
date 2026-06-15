"""add_submission_problem_verdict_index

Revision ID: 013417cef731
Revises: 0006
Create Date: 2026-06-15 16:18:23.639066

"""

from collections.abc import Sequence

from alembic import op

revision: str = "013417cef731"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_submissions_problem_verdict", "submissions", ["problem_id", "verdict"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_submissions_problem_verdict", table_name="submissions")
