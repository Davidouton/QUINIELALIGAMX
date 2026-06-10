import httpx

from app.core.config import get_settings
from app.core.security import AuthUser


class SupabaseAdminError(RuntimeError):
    pass


class SupabaseAdminService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _headers(self) -> dict[str, str]:
        if not self.settings.supabase_service_role_key:
            raise SupabaseAdminError("SUPABASE_SERVICE_ROLE_KEY no esta configurada")

        return {
            "apikey": self.settings.supabase_service_role_key,
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "Content-Type": "application/json",
        }

    def _auth_url(self, path: str) -> str:
        return f"{self.settings.supabase_url.rstrip('/')}/auth/v1{path}"

    def _parse_auth_user(self, payload: dict) -> AuthUser:
        user_payload = payload.get("user") if isinstance(payload.get("user"), dict) else payload
        auth_user_id = user_payload.get("id")
        if not auth_user_id:
            raise SupabaseAdminError("Supabase no regreso el id del usuario")

        return AuthUser(
            auth_user_id=auth_user_id,
            email=user_payload.get("email"),
            raw_claims={
                "user_metadata": user_payload.get("user_metadata")
                or user_payload.get("raw_user_meta_data")
                or {},
            },
        )

    def _raise_for_error(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return

        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = (
            payload.get("msg")
            or payload.get("message")
            or payload.get("error_description")
            or payload.get("error")
            or response.text
            or "No se pudo crear el usuario en Supabase"
        )
        raise SupabaseAdminError(str(detail))

    def invite_user(self, *, email: str, display_name: str) -> AuthUser:
        payload = {
            "email": email,
            "data": {"display_name": display_name},
            "redirect_to": f"{self.settings.frontend_site_url.rstrip('/')}/reset-password",
        }
        with httpx.Client(timeout=15.0) as client:
            response = client.post(self._auth_url("/invite"), headers=self._headers(), json=payload)
        self._raise_for_error(response)
        return self._parse_auth_user(response.json())

    def create_user(self, *, email: str, display_name: str, password: str) -> AuthUser:
        payload = {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"display_name": display_name},
        }
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                self._auth_url("/admin/users"),
                headers=self._headers(),
                json=payload,
            )
        self._raise_for_error(response)
        return self._parse_auth_user(response.json())

    def update_user_password(self, *, auth_user_id: str, password: str) -> None:
        payload = {
            "password": password,
        }
        with httpx.Client(timeout=15.0) as client:
            response = client.put(
                self._auth_url(f"/admin/users/{auth_user_id}"),
                headers=self._headers(),
                json=payload,
            )
        self._raise_for_error(response)
