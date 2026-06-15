"""drop_unused_problem_category_index

L'index sur problems.category n'est jamais interrogé : la colonne est
renseignée à l'import mais aucune requête ne filtre dessus. On retire l'index
(surcoût d'écriture/stockage) en conservant la colonne (métadonnée d'auteur).

Revision ID: 0008
Revises: 013417cef731
Create Date: 2026-06-15 17:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "013417cef731"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(op.f("ix_problems_category"), table_name="problems")


def downgrade() -> None:
    op.create_index(op.f("ix_problems_category"), "problems", ["category"], unique=False)
