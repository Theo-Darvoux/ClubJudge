"""add_first_blood_announced

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-16 01:50:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "contest_problems",
        sa.Column(
            "first_blood_announced",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("contest_problems", "first_blood_announced")
