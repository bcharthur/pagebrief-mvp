"""add scope-specific fields to analysis_jobs"""

from alembic import op
import sqlalchemy as sa

revision = "0002_add_job_scope_fields"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analysis_jobs", sa.Column("selected_text", sa.Text(), nullable=True))
    op.add_column("analysis_jobs", sa.Column("page_number", sa.Integer(), nullable=True))
    op.add_column("analysis_jobs", sa.Column("page_from", sa.Integer(), nullable=True))
    op.add_column("analysis_jobs", sa.Column("page_to", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("analysis_jobs", "page_to")
    op.drop_column("analysis_jobs", "page_from")
    op.drop_column("analysis_jobs", "page_number")
    op.drop_column("analysis_jobs", "selected_text")
