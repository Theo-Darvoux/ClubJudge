"""admin audit log

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_audit_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "admin_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target", sa.String(length=256), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_admin_audit_log_admin_user_id", "admin_audit_log", ["admin_user_id"])
    op.create_index("ix_admin_audit_log_created_at", "admin_audit_log", ["created_at"])
    op.create_index("ix_admin_audit_log_action", "admin_audit_log", ["action"])


def downgrade() -> None:
    op.drop_index("ix_admin_audit_log_action", table_name="admin_audit_log")
    op.drop_index("ix_admin_audit_log_admin_user_id", table_name="admin_audit_log")
    op.drop_index("ix_admin_audit_log_created_at", table_name="admin_audit_log")
    op.drop_table("admin_audit_log")
