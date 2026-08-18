import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import AdminAuditLog, User


def record_admin_action(
    db: Session,
    admin: User,
    action: str,
    target: str,
    details: dict[str, Any] | None = None,
) -> None:
    """Append an admin action to the audit trail in the caller's transaction."""
    db.add(
        AdminAuditLog(
            admin_user_id=admin.id,
            action=action,
            target=target,
            details=json.dumps(details, ensure_ascii=False, sort_keys=True) if details else None,
        )
    )
