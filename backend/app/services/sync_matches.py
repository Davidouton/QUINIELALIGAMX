from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.entities import SyncLog, SyncStatus
from app.providers.base import SportsDataProvider


def sync_matches(db: Session, provider: SportsDataProvider) -> dict[str, str | int]:
    records = provider.fetch_matches()
    db.add(
        SyncLog(
            provider_name=provider.name,
            resource_type="matches",
            status=SyncStatus.SUCCESS,
            records_processed=len(records),
            started_at=datetime.now(UTC),
            finished_at=datetime.now(UTC),
        )
    )
    db.commit()
    return {
        "provider_name": provider.name,
        "resource_type": "matches",
        "records_processed": len(records),
        "status": "success",
    }

