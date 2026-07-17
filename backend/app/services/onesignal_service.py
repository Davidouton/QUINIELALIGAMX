from __future__ import annotations

from uuid import NAMESPACE_URL, uuid5

import httpx

from app.core.config import get_settings

settings = get_settings()


class OneSignalPushService:
    base_url = "https://api.onesignal.com/notifications"

    def is_configured(self) -> bool:
        return bool(settings.onesignal_app_id and settings.onesignal_rest_api_key)

    def send_to_external_id(
        self,
        *,
        external_id: str,
        title: str,
        message: str,
        url: str,
        dedupe_key: str,
    ) -> str:
        if not self.is_configured():
            raise RuntimeError("Configura ONESIGNAL_APP_ID y ONESIGNAL_REST_API_KEY para enviar push.")

        payload = {
            "app_id": settings.onesignal_app_id,
            "include_aliases": {"external_id": [external_id]},
            "target_channel": "push",
            "headings": {"es": title, "en": title},
            "contents": {"es": message, "en": message},
            "url": url,
            "idempotency_key": str(uuid5(NAMESPACE_URL, f"quiniela-push:{dedupe_key}")),
        }
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                self.base_url,
                headers={
                    "Authorization": f"Key {settings.onesignal_rest_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.status_code >= 400:
            try:
                detail = response.json()
            except ValueError:
                detail = response.text
            raise RuntimeError(f"OneSignal rechazó la notificación: {detail}")
        return str(response.json().get("id") or "")
