#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime

from app.core.database import SessionLocal
from app.core.datetime import ensure_utc
from app.services.reminder_service import ReminderService
from app.services.settlement_service import SettlementService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Envia recordatorios de picks por push.")
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra las notificaciones candidatas sin enviarlas.")
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
    reminder_service = ReminderService()
    settlement_service = SettlementService()

    db = SessionLocal()
    try:
        reminder_results = reminder_service.send_due_push_reminders(
            db,
            now_utc=now,
            window_minutes=args.window_minutes,
            dry_run=args.dry_run,
        )
        settlement_results = [] if args.dry_run else settlement_service.send_due_payment_push_reminders(db, now_utc=now)
    finally:
        db.close()

    summary = {
        "dry_run": args.dry_run,
        "now_utc": now.isoformat(),
        "pick_reminders": [
            {
                "dedupe_key": row.dedupe_key,
                "profile_id": row.profile_id,
                "recipient_reference": row.recipient_reference,
                "title": row.title,
                "status": row.status,
                "provider_message_id": row.provider_message_id,
            }
            for row in reminder_results
        ],
        "settlement_reminders": [
            {
                "dedupe_key": row.dedupe_key,
                "profile_id": row.profile_id,
                "title": row.title,
                "status": row.status,
                "provider_message_id": row.provider_message_id,
            }
            for row in settlement_results
        ],
    }
    print(json.dumps(summary, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
