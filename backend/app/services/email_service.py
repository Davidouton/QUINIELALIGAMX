from __future__ import annotations

import httpx

from app.core.config import get_settings

settings = get_settings()


class ResendEmailService:
    provider_name = "resend"
    base_url = "https://api.resend.com"

    def is_configured(self) -> bool:
        return bool(settings.resend_api_key and settings.resend_from_email)

    def send_email(self, *, to_email: str, subject: str, html: str) -> str:
        if not self.is_configured():
            raise RuntimeError("Configura RESEND_API_KEY y RESEND_FROM_EMAIL para enviar recordatorios.")

        from_field = settings.resend_from_email
        if settings.resend_from_name:
            from_field = f"{settings.resend_from_name} <{settings.resend_from_email}>"

        payload: dict[str, object] = {
            "from": from_field,
            "to": [to_email],
            "subject": subject,
            "html": html,
        }
        if settings.resend_reply_to:
            payload["reply_to"] = settings.resend_reply_to

        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                f"{self.base_url}/emails",
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

        if response.status_code >= 400:
            try:
                detail = response.json()
            except ValueError:
                detail = response.text
            raise RuntimeError(f"Resend rechazo el correo: {detail}")

        body = response.json()
        return str(body.get("id") or "")
