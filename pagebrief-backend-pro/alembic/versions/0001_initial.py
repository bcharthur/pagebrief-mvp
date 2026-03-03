"""initial tables"""

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("plan", sa.String(length=32), nullable=False, server_default="free"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("format", sa.String(length=32), nullable=False, server_default="express"),
        sa.Column("scope", sa.String(length=32), nullable=False, server_default="document"),
        sa.Column("source_type", sa.String(length=32), nullable=False, server_default="html"),
        sa.Column("title", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("source_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("text_content", sa.Text(), nullable=False, server_default=""),
        sa.Column("upload_path", sa.Text(), nullable=True),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress_label", sa.String(length=255), nullable=False, server_default="En file d'attente"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("result_payload", sa.Text(), nullable=True),
        sa.Column("reading_time_min", sa.Integer(), nullable=True),
        sa.Column("confidence", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_analysis_jobs_status", "analysis_jobs", ["status"], unique=False)
    op.create_index("ix_analysis_jobs_user_id", "analysis_jobs", ["user_id"], unique=False)

    op.create_table(
        "history_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("analysis_jobs.id"), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("source_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("summary_excerpt", sa.Text(), nullable=False, server_default=""),
        sa.Column("format", sa.String(length=32), nullable=False, server_default="express"),
        sa.Column("source_type", sa.String(length=32), nullable=False, server_default="html"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_history_items_user_id", "history_items", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_history_items_user_id", table_name="history_items")
    op.drop_table("history_items")
    op.drop_index("ix_analysis_jobs_user_id", table_name="analysis_jobs")
    op.drop_index("ix_analysis_jobs_status", table_name="analysis_jobs")
    op.drop_table("analysis_jobs")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
