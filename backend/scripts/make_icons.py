"""Draw Keynection's app icons (PNG) from the same shapes as frontend/public/favicon.svg.

A phone needs PNG icons to put Keynection on its home screen, and an iPhone only shows web notifications for a web
app opened from the home screen. Run from prototype/backend:
    .venv/Scripts/python scripts/make_icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "icons"
ORANGE = (224, 96, 62, 255)  # #e0603e
HOUSE = [(-3, 2.2), (-3, -0.8), (0, -3.4), (3, -0.8), (3, 2.2)]
HOUSES = [(16, 7), (24.6, 13.2), (21.3, 23.3), (10.7, 23.3), (7.4, 13.2)]
DRAW = 1024  # drawn large, then scaled down smoothly


def logo(size: int, scale: float, background: bool) -> Image.Image:
    """The circle of five homes around one, on the brand orange (or white on clear, for the notification badge)."""
    unit = DRAW / 32 * scale
    offset = DRAW / 2 - 16 * unit
    xy = lambda x, y: (offset + x * unit, offset + y * unit)  # noqa: E731
    base = Image.new("RGBA", (DRAW, DRAW), ORANGE if background else (0, 0, 0, 0))
    ring = Image.new("RGBA", (DRAW, DRAW), (0, 0, 0, 0))
    draw = ImageDraw.Draw(ring)
    r, width = 9 * unit, max(1, round(1.2 * unit))
    box = [*xy(16 - 9, 16 - 9), *xy(16 + 9, 16 + 9)]
    dash, gap = math.degrees(1.6 / 9), math.degrees(2.2 / 9)
    angle = 0.0
    while angle < 360:
        draw.arc(box, angle, min(angle + dash, 360), fill=(255, 255, 255, 178), width=width)
        angle += dash + gap
    base.alpha_composite(ring)
    draw = ImageDraw.Draw(base)
    for cx, cy in HOUSES:
        draw.polygon([xy(cx + dx, cy + dy) for dx, dy in HOUSE], fill=(255, 255, 255, 255))
    draw.ellipse([*xy(16 - 2.4, 16 - 2.4), *xy(16 + 2.4, 16 + 2.4)], fill=(255, 255, 255, 255))
    assert r > 0
    return base.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    logo(192, 1.0, True).save(OUT / "icon-192.png", optimize=True)
    logo(512, 1.0, True).save(OUT / "icon-512.png", optimize=True)
    logo(512, 0.8, True).save(OUT / "maskable-512.png", optimize=True)  # Android may crop it to a circle
    logo(180, 0.9, True).save(OUT / "apple-touch-icon.png", optimize=True)  # iPhone rounds the corners itself
    logo(96, 1.1, False).save(OUT / "badge-96.png", optimize=True)  # the small white mark in Android's status bar
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
