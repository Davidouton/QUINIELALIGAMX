"""create users table

Revision ID: 20260302_0001
Revises:
Create Date: 2026-03-02 19:55:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260302_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lmx_users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lmx_users_email", "lmx_users", ["email"], unique=True)
    op.create_index("ix_lmx_users_id", "lmx_users", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_lmx_users_id", table_name="lmx_users")
    op.drop_index("ix_lmx_users_email", table_name="lmx_users")
    op.drop_table("lmx_users")
