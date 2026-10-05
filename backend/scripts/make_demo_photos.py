"""Generate the synthetic demo photos used in the prototype.

They are drawn from scratch (no real homes, no people, no third-party images),
so they carry no privacy or copyright risk. Each "photo" is the same scene shot
from a slightly different position with different exposure, like a real retake.

Run from prototype/backend:  .venv/Scripts/python scripts/make_demo_photos.py
"""

from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parent.parent / "app" / "demo_photos"
SCENE_W, SCENE_H = 1800, 1350
PHOTO_W, PHOTO_H = 1600, 1200


def _noise(rng: np.random.Generator, scales: list[tuple[float, float]]) -> np.ndarray:
    total = np.zeros((SCENE_H, SCENE_W), np.float32)
    for sigma, amp in scales:
        layer = cv2.GaussianBlur(rng.normal(0, 1, (SCENE_H, SCENE_W)).astype(np.float32), (0, 0), sigma)
        total += layer / (layer.std() + 1e-6) * amp
    return total


def _surface(rng: np.random.Generator, bgr: tuple[int, int, int]) -> np.ndarray:
    img = np.zeros((SCENE_H, SCENE_W, 3), np.float32) + np.array(bgr, np.float32)
    img += _noise(rng, [(1.0, 2.5), (5, 3.5), (40, 6.0)])[..., None]
    light = np.linspace(1.07, 0.90, SCENE_W)[None, :] * np.linspace(1.03, 0.95, SCENE_H)[:, None]
    return img * light[..., None]


def _specks(img: np.ndarray, rng: np.random.Generator, n: int) -> None:
    for _ in range(n):
        x, y = int(rng.uniform(80, SCENE_W - 80)), int(rng.uniform(80, SCENE_H - 80))
        r = int(rng.integers(1, 3))
        shade = float(rng.uniform(0.75, 0.9))
        cv2.circle(img, (x, y), r, tuple(float(c * shade) for c in img[y, x]), -1, cv2.LINE_AA)


def wall_scene(seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = _surface(rng, (204, 214, 222))  # warm off-white paint
    # Room corner on the right: the side wall is in shadow.
    img[:, 1560:] *= 0.86
    cv2.line(img, (1560, 0), (1560, SCENE_H), (150, 160, 168), 2, cv2.LINE_AA)
    # Skirting board.
    cv2.rectangle(img, (0, 1180), (SCENE_W, 1260), (120, 140, 160), -1)
    cv2.line(img, (0, 1180), (SCENE_W, 1180), (235, 240, 245), 2, cv2.LINE_AA)
    # Power socket.
    cv2.rectangle(img, (1240, 960), (1380, 1060), (236, 238, 240), -1)
    cv2.rectangle(img, (1240, 960), (1380, 1060), (150, 155, 160), 2, cv2.LINE_AA)
    for dx in (1272, 1330):
        cv2.rectangle(img, (dx, 990), (dx + 14, 1030), (70, 70, 70), -1)
    # Light switch.
    cv2.rectangle(img, (230, 560), (320, 680), (236, 238, 240), -1)
    cv2.rectangle(img, (230, 560), (320, 680), (150, 155, 160), 2, cv2.LINE_AA)
    cv2.rectangle(img, (262, 590), (288, 650), (205, 208, 212), -1)
    # Picture hook, a small scuff and plaster specks give the matcher more anchors.
    cv2.circle(img, (760, 330), 4, (80, 80, 80), -1, cv2.LINE_AA)
    cv2.ellipse(img, (520, 1100), (40, 6), 10, 0, 360, (175, 182, 190), -1, cv2.LINE_AA)
    _specks(img, rng, 70)
    return img


def ceiling_scene(seed: int = 11) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = _surface(rng, (226, 230, 232))
    # Cornice along the top and a wall edge on the left.
    cv2.rectangle(img, (0, 0), (SCENE_W, 70), (200, 206, 210), -1)
    cv2.line(img, (0, 70), (SCENE_W, 70), (165, 170, 175), 2, cv2.LINE_AA)
    # Ceiling light.
    cv2.circle(img, (520, 520), 95, (245, 247, 248), -1, cv2.LINE_AA)
    cv2.circle(img, (520, 520), 95, (170, 175, 180), 3, cv2.LINE_AA)
    cv2.circle(img, (520, 520), 22, (190, 195, 200), -1, cv2.LINE_AA)
    # Exhaust fan grille.
    cv2.rectangle(img, (1200, 780), (1420, 1000), (238, 240, 241), -1)
    cv2.rectangle(img, (1200, 780), (1420, 1000), (150, 155, 160), 2, cv2.LINE_AA)
    for y in range(800, 990, 18):
        cv2.line(img, (1215, y), (1405, y), (160, 165, 170), 2, cv2.LINE_AA)
    # Smoke detector.
    cv2.circle(img, (1350, 300), 40, (240, 242, 243), -1, cv2.LINE_AA)
    cv2.circle(img, (1350, 300), 40, (160, 165, 170), 2, cv2.LINE_AA)
    cv2.circle(img, (1350, 300), 6, (60, 60, 200), -1, cv2.LINE_AA)
    _specks(img, rng, 60)
    return img


def add_crack(img: np.ndarray, seed: int = 3, strength: float = 0.55) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = img.copy()
    layer = np.zeros(img.shape[:2], np.float32)

    def walk(x: float, y: float, steps: int, angle: float, width: int) -> None:
        pts = [(x, y)]
        for _ in range(steps):
            angle += rng.normal(0, 0.28)
            x += np.cos(angle) * 9
            y += np.sin(angle) * 9
            pts.append((x, y))
            if width > 1 and rng.random() < 0.05:
                walk(x, y, int(rng.integers(8, 20)), angle + rng.choice([-0.9, 0.9]), width - 1)
        cv2.polylines(layer, [np.int32(pts)], False, 1.0, width, cv2.LINE_AA)

    walk(880, 180, 75, np.deg2rad(72), 3)
    layer = cv2.GaussianBlur(layer, (0, 0), 0.7)
    out *= (1 - strength * np.clip(layer, 0, 1))[..., None]
    return out


def add_stain(img: np.ndarray, seed: int = 5, strength: float = 1.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = img.copy()
    blob = np.zeros(img.shape[:2], np.float32)
    for _ in range(7):
        cx, cy = 900 + rng.normal(0, 60), 700 + rng.normal(0, 45)
        cv2.ellipse(blob, (int(cx), int(cy)), (int(rng.uniform(60, 130)), int(rng.uniform(40, 90))),
                    float(rng.uniform(0, 180)), 0, 360, 1.0, -1, cv2.LINE_AA)
    blob = cv2.GaussianBlur(blob, (0, 0), 18)
    blob = np.clip(blob, 0, 1)
    ring = np.clip(blob * (1 - blob) * 4, 0, 1)  # tide-mark edge, typical of water stains
    stain_bgr = np.array([120, 160, 190], np.float32)  # yellow-brown
    alpha = (strength * (0.35 * blob + 0.25 * ring))[..., None]
    return out * (1 - alpha) + stain_bgr * alpha


def shoot(scene: np.ndarray, seed: int, gain: float, bias: float) -> np.ndarray:
    """Photograph the scene from a slightly different position and exposure."""
    rng = np.random.default_rng(seed)
    x0, y0 = (SCENE_W - PHOTO_W) / 2, (SCENE_H - PHOTO_H) / 2
    corners = np.float32([[x0, y0], [x0 + PHOTO_W, y0], [x0 + PHOTO_W, y0 + PHOTO_H], [x0, y0 + PHOTO_H]])
    shift = rng.uniform(-30, 30, 2)
    scene_pts = corners + shift + rng.uniform(-22, 22, (4, 2)).astype(np.float32)
    photo_pts = np.float32([[0, 0], [PHOTO_W, 0], [PHOTO_W, PHOTO_H], [0, PHOTO_H]])
    m = cv2.getPerspectiveTransform(np.float32(scene_pts), photo_pts)
    photo = cv2.warpPerspective(scene, m, (PHOTO_W, PHOTO_H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    photo = photo * gain + bias + rng.normal(0, 2.0, photo.shape)
    return np.clip(photo, 0, 255).astype(np.uint8)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    wall, ceiling = wall_scene(), ceiling_scene()
    photos = {
        "wall_before": shoot(wall, seed=1, gain=1.0, bias=0),
        "wall_after_crack": shoot(add_crack(wall), seed=2, gain=1.05, bias=-6),
        "wall_after_same": shoot(wall, seed=3, gain=0.94, bias=4),
        "ceiling_before": shoot(ceiling, seed=4, gain=1.0, bias=0),
        "ceiling_after_stain": shoot(add_stain(ceiling), seed=5, gain=0.96, bias=3),
        # After SDP's repair: properly restored, or patched badly so the mark still shows.
        "wall_repair_good": shoot(wall, seed=6, gain=1.03, bias=-3),
        "wall_repair_poor": shoot(add_crack(wall, strength=0.3), seed=7, gain=0.98, bias=2),
        "ceiling_repair_good": shoot(ceiling, seed=8, gain=1.02, bias=-2),
        "ceiling_repair_poor": shoot(add_stain(ceiling, strength=0.8), seed=9, gain=0.99, bias=1),
    }
    for name, img in photos.items():
        cv2.imwrite(str(OUT / f"{name}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        print("wrote", name)


if __name__ == "__main__":
    main()
