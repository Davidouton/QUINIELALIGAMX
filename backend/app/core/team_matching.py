from __future__ import annotations

import re
import unicodedata
from datetime import datetime

from app.core.datetime import MEXICO_CITY_TZ, ensure_utc
from app.models.entities import Team

TEAM_CODE_ALIASES = {
    "club america": "AME",
    "america": "AME",
    "cf america": "AME",
    "guadalajara": "GDL",
    "chivas": "GDL",
    "guadalajara chivas": "GDL",
    "cd guadalajara": "GDL",
    "cruz azul": "CAZ",
    "pumas unam": "PUM",
    "u.n.a.m. - pumas": "PUM",
    "u.n.a.m.": "PUM",
    "unam": "PUM",
    "pumas": "PUM",
    "toluca": "TOL",
    "monterrey": "MTY",
    "rayados": "MTY",
    "cf monterrey": "MTY",
    "tigres uanl": "TIG",
    "u.a.n.l. - tigres": "TIG",
    "tigres": "TIG",
    "pachuca": "PAC",
    "leon": "LEO",
    "santos laguna": "SAN",
    "santos": "SAN",
    "atlas": "ATL",
    "queretaro": "QRO",
    "queretaro fc": "QRO",
    "necaxa": "NEC",
    "puebla": "PUE",
    "mazatlan fc": "MAZ",
    "mazatlan": "MAZ",
    "fc juarez": "JUA",
    "juarez": "JUA",
    "bravos": "JUA",
    "club tijuana": "TIJ",
    "tijuana": "TIJ",
    "xolos": "TIJ",
    "atletico san luis": "ASL",
    "atletico de san luis": "ASL",
    "san luis": "ASL",
}

EQUIVALENT_TEAM_CODES = {
    "GDL": ("GDL", "CHI"),
    "CHI": ("CHI", "GDL"),
    "ASL": ("ASL", "SLP"),
    "SLP": ("SLP", "ASL"),
    "ATL": ("ATL", "ATLX"),
    "ATLX": ("ATLX", "ATL"),
}


def normalize_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip().lower())
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    compact = re.sub(r"[^a-z0-9]+", " ", ascii_only)
    return " ".join(compact.split())


def team_lookup_keys(team: Team) -> list[str]:
    return [
        normalize_text(team.short_name),
        normalize_text(team.name),
        normalize_text(team.slug),
    ]


def build_team_code_lookup(teams: list[Team]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for team in teams:
        code = team.short_name.upper()
        for key in team_lookup_keys(team):
            if key:
                lookup[key] = code
    for alias, code in TEAM_CODE_ALIASES.items():
        lookup.setdefault(normalize_text(alias), code)
    return lookup


def resolve_team_code(
    value: str | None,
    lookup: dict[str, str],
    actual_codes: set[str] | None = None,
) -> str | None:
    key = normalize_text(value)
    if not key:
        return None
    code = lookup.get(key)
    if code is None:
        return None

    available_codes = actual_codes or set(lookup.values())
    for candidate in EQUIVALENT_TEAM_CODES.get(code, (code,)):
        if candidate in available_codes:
            return candidate
    return code


def mexico_city_match_date(value: datetime) -> str:
    return ensure_utc(value).astimezone(MEXICO_CITY_TZ).date().isoformat()
