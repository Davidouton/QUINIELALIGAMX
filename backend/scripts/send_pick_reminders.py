#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime

from app.core.database import SessionLocal
from app.core.datetime import ensure_utc
from app.services.reminder_service import ReminderService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Envia recordatorios de picks por mail.")
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra los correos candidatos sin enviarlos.")
    parser.add_argument(
        "--window-minutes",
        type=int,
        default=70,
        help="Ventana de tolerancia para encontrar recordatorios vencidos por pocos minutos.",
    )
    parser.add_argument(
        "--now",
        type=str,
        default="",
        help="Fecha/hora ISO en UTC para pruebas. Ejemplo: 2026-05-04T18:00:00+00:00",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    now = ensure_utc(datetime.fromisoformat(args.now)) if args.now else datetime.now(UTC)
    service = ReminderService()

    db = SessionLocal()
    try:
        results = service.send_due_email_reminders(
            db,
            now_utc=now,
            window_minutes=args.window_minutes,
            dry_run=args.dry_run,
        )
    finally:
        db.close()

    summary = {
        "dry_run": args.dry_run,
        "now_utc": now.isoformat(),
        "results": [
            {
                "dedupe_key": row.dedupe_key,
                "profile_id": row.profile_id,
                "recipient_email": row.recipient_email,
                "subject": row.subject,
                "status": row.status,
                "provider_message_id": row.provider_message_id,
            }
            for row in results
        ],
    }
    print(json.dumps(summary, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
