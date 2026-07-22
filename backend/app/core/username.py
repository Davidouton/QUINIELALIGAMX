import re
import unicodedata

USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 24
RESERVED_USERNAMES = {"admin", "administrator", "soporte", "support", "quiniela", "quinielon", "sistema"}


def normalize_username(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^a-z0-9._]+", "", ascii_value.lower().strip().replace(" ", ""))
    normalized = re.sub(r"[._]{2,}", lambda match: match.group(0)[0], normalized).strip("._")
    return normalized[:USERNAME_MAX_LENGTH]


def validate_username(value: str) -> str:
    normalized = normalize_username(value)
    if len(normalized) < USERNAME_MIN_LENGTH:
        raise ValueError("El usuario debe tener entre 3 y 24 caracteres.")
    if normalized in RESERVED_USERNAMES:
        raise ValueError("Ese usuario está reservado.")
    return normalized


def unique_username(base_value: str, used: set[str]) -> str:
    base = normalize_username(base_value) or "usuario"
    if len(base) < USERNAME_MIN_LENGTH:
        base = f"{base}user"
    base = base[:USERNAME_MAX_LENGTH]
    candidate = base
    suffix = 2
    while candidate in used or candidate in RESERVED_USERNAMES:
        suffix_text = str(suffix)
        candidate = f"{base[:USERNAME_MAX_LENGTH - len(suffix_text)]}{suffix_text}"
        suffix += 1
    used.add(candidate)
    return candidate
