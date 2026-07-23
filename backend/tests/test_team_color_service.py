from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from app.services import team_color_service


def test_extract_team_palette_uses_distinct_crest_colors(monkeypatch: pytest.MonkeyPatch) -> None:
    image = Image.new("RGBA", (90, 30), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 39, 29), fill=(255, 0, 0, 255))
    draw.rectangle((40, 0, 69, 29), fill=(0, 0, 255, 255))
    draw.rectangle((70, 0, 89, 29), fill=(255, 255, 0, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    monkeypatch.setattr(
        team_color_service,
        "_download_public_image",
        lambda _url: buffer.getvalue(),
    )

    palette = team_color_service.extract_team_palette("https://images.example/team.png")

    assert palette == ("#FF0000", "#0000FF", "#FFFF00")


def test_private_crest_urls_are_rejected() -> None:
    with pytest.raises(ValueError, match="red privada"):
        team_color_service._validate_public_url("http://127.0.0.1/logo.png")
