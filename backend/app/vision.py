"""Photo evidence: safe intake, quality check, and before/after comparison.

The computer only flags visible changes between two photos of the same spot.
People decide what caused them.
"""

import hashlib
import io
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps

MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 40_000_000
# MPO is a JPEG with extra embedded pictures (some phones save these); only its first picture is used.
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}
FULL_SIDE = 1600
THUMB_SIDE = 480
WORK_WIDTH = 1000  # comparisons run at this width: fast and stable

# Quality thresholds (tuned on the synthetic demo photos and phone photos of walls).
MIN_SHARPNESS = 25.0
MIN_BRIGHTNESS, MAX_BRIGHTNESS = 45.0, 235.0
MIN_SHORT_SIDE = 720

# Comparison thresholds.
MIN_GOOD_MATCHES = 12
MIN_INLIERS = 12
DARKENING_THRESHOLD = 0.10  # after flat-field normalisation, 1.0 = unchanged brightness
PATCH_DARKENING_THRESHOLD = 0.07  # relative darkening of a large soft patch
MIN_REGION_FRACTION = 0.00025  # of the compared area


class PhotoError(ValueError):
    """Raised with a short machine-readable code: too_large, not_an_image, unsupported_format, too_many_pixels."""


@dataclass
class ProcessedPhoto:
    full_jpeg: bytes
    thumb_jpeg: bytes
    width: int
    height: int
    sha256: str
    quality: dict[str, Any] = field(default_factory=dict)


def ingest(raw: bytes) -> ProcessedPhoto:
    """Validate an upload and re-encode it.

    Re-encoding drops every piece of metadata (EXIF, GPS location, camera serial, JPEG comments),
    so stored photos never leak where or with what device they were taken.
    """
    if len(raw) > MAX_UPLOAD_BYTES:
        raise PhotoError("too_large")
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        if probe.width * probe.height > MAX_PIXELS:
            raise PhotoError("too_many_pixels")
        probe.verify()
        img = Image.open(io.BytesIO(raw))
        img.load()
    except PhotoError:
        raise
    except Exception as exc:  # truncated, corrupt, or not an image at all
        raise PhotoError("not_an_image") from exc
    if fmt not in ALLOWED_FORMATS:
        raise PhotoError("unsupported_format")

    img = ImageOps.exif_transpose(img).convert("RGB")
    # convert() carries the source's info over, and Pillow writes a JPEG comment back out if it finds one there.
    # Clear it so nothing the phone attached (comments, profiles, XMP) reaches the stored copies.
    img.info.clear()
    img.thumbnail((FULL_SIDE, FULL_SIDE), Image.Resampling.LANCZOS)
    thumb = img.copy()
    thumb.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.Resampling.LANCZOS)
    full_jpeg = _to_jpeg(img, 88)
    return ProcessedPhoto(
        full_jpeg=full_jpeg,
        thumb_jpeg=_to_jpeg(thumb, 80),
        width=img.width,
        height=img.height,
        sha256=hashlib.sha256(full_jpeg).hexdigest(),
        quality=check_quality(np.asarray(img)),
    )


def check_quality(rgb: np.ndarray) -> dict[str, Any]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    small = _resize_to_width(gray, WORK_WIDTH)
    sharpness = float(cv2.Laplacian(small, cv2.CV_64F).var())
    brightness = float(gray.mean())
    h, w = gray.shape
    checks = {
        "sharp": sharpness >= MIN_SHARPNESS,
        "well_lit": MIN_BRIGHTNESS <= brightness <= MAX_BRIGHTNESS,
        "resolution": min(h, w) >= MIN_SHORT_SIDE,
    }
    return {
        "sharpness": round(sharpness, 1),
        "brightness": round(brightness, 1),
        "width": w,
        "height": h,
        "checks": checks,
        "ok": all(checks.values()),
    }


@dataclass
class Comparison:
    result: dict[str, Any]
    overlay_jpeg: bytes | None
    aligned_after_jpeg: bytes | None
    before_jpeg: bytes | None


def compare(before_jpeg: bytes, after_jpeg: bytes) -> Comparison:
    """Align the follow-up photo onto the baseline, then flag areas that became darker
    (cracks, water stains, marks). Returns overlay and aligned images for the UI."""
    a = _resize_to_width(_decode(before_jpeg), WORK_WIDTH)
    b = _resize_to_width(_decode(after_jpeg), WORK_WIDTH)
    ga, gb = (cv2.cvtColor(x, cv2.COLOR_BGR2GRAY) for x in (a, b))

    homography, good, inliers = _homography(ga, gb)
    if homography is None:
        return Comparison(
            {"aligned": False, "matches": good, "inliers": inliers, "changed": False,
             "change_ratio": None, "regions": []},
            None, None, None,
        )

    h, w = ga.shape
    b_warp = cv2.warpPerspective(b, homography, (w, h), flags=cv2.INTER_LINEAR)
    valid = cv2.warpPerspective(np.full(gb.shape, 255, np.uint8), homography, (w, h), flags=cv2.INTER_NEAREST)
    valid = cv2.erode(valid, np.ones((31, 31), np.uint8))

    gbw = cv2.cvtColor(b_warp, cv2.COLOR_BGR2GRAY)
    # Fine pass: thin marks such as cracks.
    fine = np.clip(_flatten(ga) - _flatten(gbw), 0, None) > DARKENING_THRESHOLD
    # Coarse pass: large soft patches such as water stains, after removing lighting differences.
    coarse = _patch_darkening(ga, gbw) > PATCH_DARKENING_THRESHOLD
    mask = ((fine | coarse) & (valid > 0)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))

    valid_area = max(int((valid > 0).sum()), 1)
    min_area = MIN_REGION_FRACTION * valid_area
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    kept = np.zeros_like(mask)
    regions = []
    for i in range(1, n):
        x, y, rw, rh, area = stats[i]
        if area < min_area:
            continue
        component = (labels == i).astype(np.uint8)
        contour = max(cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea)
        (_, _), (cw, ch), _ = cv2.minAreaRect(contour)
        elongation = max(cw, ch) / max(min(cw, ch), 1.0)
        shape = "line" if elongation >= 3.5 or area / max(rw * rh, 1) < 0.25 else "patch"
        if shape == "patch":
            cv2.drawContours(kept, [contour], -1, 255, -1)  # fill holes, e.g. the lighter centre of a stain
        else:
            kept |= component * 255
        regions.append({
            "x": round(x / w, 4), "y": round(y / h, 4), "w": round(rw / w, 4), "h": round(rh / h, 4),
            "area_ratio": round(area / valid_area, 5),
            "shape": shape,
        })
    regions.sort(key=lambda r: r["area_ratio"], reverse=True)

    result = {
        "aligned": True,
        "matches": good,
        "inliers": inliers,
        "changed": bool(regions),
        "change_ratio": round(float((kept > 0).sum()) / valid_area, 5),
        "regions": regions,
    }
    overlay = _draw_overlay(b_warp, kept, valid, regions)
    return Comparison(result, _encode(overlay), _encode(b_warp), _encode(a))


# ---------- internals ----------

def _to_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)  # no exif= argument: metadata is not written
    return buf.getvalue()


def _decode(jpeg: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise PhotoError("not_an_image")
    return img


def _encode(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 86])
    if not ok:
        raise RuntimeError("could not encode image")
    return buf.tobytes()


def _resize_to_width(img: np.ndarray, width: int) -> np.ndarray:
    h, w = img.shape[:2]
    if w == width:
        return img
    return cv2.resize(img, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)


def _homography(ga: np.ndarray, gb: np.ndarray) -> tuple[np.ndarray | None, int, int]:
    """Find the perspective transform that maps photo b onto photo a."""
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))  # brings out texture on plain walls
    orb = cv2.ORB_create(nfeatures=5000, fastThreshold=7)
    ka, da = orb.detectAndCompute(clahe.apply(ga), None)
    kb, db = orb.detectAndCompute(clahe.apply(gb), None)
    if da is None or db is None or len(ka) < MIN_GOOD_MATCHES or len(kb) < MIN_GOOD_MATCHES:
        return None, 0, 0
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(db, da, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
    if len(good) < MIN_GOOD_MATCHES:
        return None, len(good), 0
    src = np.float32([kb[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([ka[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    homography, inlier_mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    inliers = int(inlier_mask.sum()) if inlier_mask is not None else 0
    if homography is None or inliers < MIN_INLIERS:
        return None, len(good), inliers
    scale = abs(np.linalg.det(homography[:2, :2]))
    if not 0.4 < scale < 2.5:  # a wild warp means the match is wrong
        return None, len(good), inliers
    return homography, len(good), inliers


def _flatten(gray: np.ndarray) -> np.ndarray:
    """Divide out slow lighting changes so only local marks remain (1.0 = background)."""
    g = gray.astype(np.float32)
    background = cv2.GaussianBlur(g, (0, 0), 25)
    return cv2.GaussianBlur(g / (background + 1.0), (0, 0), 1.0)


def _patch_darkening(ga: np.ndarray, gbw: np.ndarray) -> np.ndarray:
    """Relative darkening of the follow-up photo at patch scale, with the lighting difference
    between the two shots estimated as a very smooth gain field and divided out."""
    a = ga.astype(np.float32)
    b = gbw.astype(np.float32)
    # The gain field is very smooth, so estimate it at quarter size (about 10x faster) and scale back up.
    h, w = a.shape
    qa = cv2.resize(a, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    qb = cv2.resize(b, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    q_gain = cv2.GaussianBlur(cv2.GaussianBlur(qb, (0, 0), 15) / (cv2.GaussianBlur(qa, (0, 0), 15) + 1.0), (0, 0), 30)
    gain = cv2.resize(q_gain, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.GaussianBlur((a - b / (gain + 1e-6)) / (a + 1.0), (0, 0), 3)


def warm_up() -> None:
    """Run one tiny comparison so OpenCV's one-time start-up cost is not paid during a demo."""
    rng = np.random.default_rng(0)
    img = cv2.GaussianBlur((rng.random((300, 400)) * 255).astype(np.uint8), (0, 0), 2)
    jpeg = _encode(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
    compare(jpeg, jpeg)


def _draw_overlay(img: np.ndarray, mask: np.ndarray, valid: np.ndarray, regions: list[dict]) -> np.ndarray:
    """Tint the changed pixels; the app draws numbered frames on top from `regions`."""
    out = img.copy()
    out[valid == 0] = (out[valid == 0] * 0.55).astype(np.uint8)  # outside the overlap of both photos
    highlight = np.zeros_like(out)
    highlight[:] = (110, 80, 255)  # BGR: warm red-pink, readable on pale walls
    soft = cv2.GaussianBlur(mask, (0, 0), 2) > 0  # slightly feathered edge
    out[soft] = cv2.addWeighted(out, 0.3, highlight, 0.7, 0)[soft]
    return out
