from __future__ import annotations

import colorsys
import ipaddress
import socket
from collections import Counter
from io import BytesIO
from urllib.parse import urljoin, urlparse

import httpx
from PIL import Image

MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("El escudo requiere una URL publica http(s)")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    for result in socket.getaddrinfo(parsed.hostname, port):
        address = ipaddress.ip_address(result[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            raise ValueError("La URL del escudo no puede apuntar a una red privada")


def _download_public_image(url: str) -> bytes:
    current_url = url
    with httpx.Client(timeout=8.0, headers={"User-Agent": "ElQuinielon/2.0"}) as client:
        for _ in range(4):
            _validate_public_url(current_url)
            response = client.get(current_url, follow_redirects=False)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise ValueError("Redireccion de escudo invalida")
                current_url = urljoin(current_url, location)
                continue
            response.raise_for_status()
            if not response.headers.get("content-type", "").lower().startswith("image/"):
                raise ValueError("La URL no devolvio una imagen")
            if len(response.content) > MAX_IMAGE_BYTES:
                raise ValueError("El escudo excede 5 MB")
            return response.content
    raise ValueError("Demasiadas redirecciones al descargar el escudo")


def _distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return sum((a - b) ** 2 for a, b in zip(left, right, strict=True)) ** 0.5


def _to_hex(color: tuple[int, int, int]) -> str:
    return f"#{color[0]:02X}{color[1]:02X}{color[2]:02X}"


def extract_team_palette(crest_url: str | None) -> tuple[str | None, str | None, str | None]:
    if not crest_url:
        return None, None, None
    image_bytes = _download_public_image(crest_url)
    with Image.open(BytesIO(image_bytes)) as source:
        image = source.convert("RGBA")
        image.thumbnail((160, 160))
        colors: Counter[tuple[int, int, int]] = Counter()
        for red, green, blue, alpha in image.getdata():
            if alpha < 80:
                continue
            hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
            del hue
            if saturation < 0.16 or value < 0.12:
                continue
            quantized = (round(red / 16) * 16, round(green / 16) * 16, round(blue / 16) * 16)
            colors[tuple(min(channel, 255) for channel in quantized)] += 1

    selected: list[tuple[int, int, int]] = []
    for color, _count in colors.most_common(40):
        if all(_distance(color, existing) >= 58 for existing in selected):
            selected.append(color)
        if len(selected) == 3:
            break
    return tuple([*map(_to_hex, selected), None, None, None][:3])
