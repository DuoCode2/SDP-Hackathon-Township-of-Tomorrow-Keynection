import io
from pathlib import Path

import pytest
from PIL import Image

from app import vision

DEMO = Path(__file__).resolve().parent.parent / "app" / "demo_photos"


def _demo(name: str) -> bytes:
    return vision.ingest((DEMO / f"{name}.jpg").read_bytes()).full_jpeg


def test_ingest_strips_all_metadata_including_camera_and_location():
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # camera make
    exif[0x0132] = "2026:10:05 12:00:00"  # date taken
    buf = io.BytesIO()
    Image.new("RGB", (1200, 900), (200, 210, 220)).save(buf, "JPEG", exif=exif)
    assert len(Image.open(buf).getexif()) == 2

    stored = vision.ingest(buf.getvalue()).full_jpeg
    assert len(Image.open(io.BytesIO(stored)).getexif()) == 0


def test_ingest_strips_jpeg_comments_too():
    buf = io.BytesIO()
    Image.new("RGB", (1200, 900), (200, 210, 220)).save(buf, "JPEG", comment=b"Taken at No. 12, 7am, Siti's phone")
    assert Image.open(io.BytesIO(buf.getvalue())).info.get("comment")

    p = vision.ingest(buf.getvalue())
    for stored in (p.full_jpeg, p.thumb_jpeg):
        assert b"Siti" not in stored
        assert "comment" not in Image.open(io.BytesIO(stored)).info


def test_ingest_accepts_multi_picture_phone_jpegs():
    # Some phones save "MPO" files: a JPEG with extra embedded pictures. The first picture is the photo.
    buf = io.BytesIO()
    first, second = Image.new("RGB", (1200, 900), (200, 210, 220)), Image.new("RGB", (600, 450), (10, 10, 10))
    first.save(buf, "MPO", save_all=True, append_images=[second])
    assert Image.open(io.BytesIO(buf.getvalue())).format == "MPO"

    p = vision.ingest(buf.getvalue())
    assert (p.width, p.height) == (1200, 900)


def test_ingest_rejects_non_images_and_oversized_files():
    with pytest.raises(vision.PhotoError, match="not_an_image"):
        vision.ingest(b"<script>alert(1)</script>")
    with pytest.raises(vision.PhotoError, match="too_large"):
        vision.ingest(b"0" * (vision.MAX_UPLOAD_BYTES + 1))


def test_ingest_rejects_gif():
    buf = io.BytesIO()
    Image.new("RGB", (900, 900)).save(buf, "GIF")
    with pytest.raises(vision.PhotoError, match="unsupported_format"):
        vision.ingest(buf.getvalue())


def test_ingest_downsizes_large_photos():
    buf = io.BytesIO()
    Image.new("RGB", (4000, 3000), (180, 180, 180)).save(buf, "JPEG")
    p = vision.ingest(buf.getvalue())
    assert max(p.width, p.height) == vision.FULL_SIDE


def test_quality_flags_blurry_dark_and_small_photos():
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), (20, 20, 20)).save(buf, "JPEG")
    checks = vision.ingest(buf.getvalue()).quality["checks"]
    assert checks == {"sharp": False, "well_lit": False, "resolution": False}
    assert vision.ingest((DEMO / "wall_before.jpg").read_bytes()).quality["ok"] is True


def test_crack_is_found_as_a_line():
    r = vision.compare(_demo("wall_before"), _demo("wall_after_crack")).result
    assert r["aligned"] and r["changed"]
    assert [reg["shape"] for reg in r["regions"]] == ["line"]


def test_water_stain_is_found_as_a_patch():
    r = vision.compare(_demo("ceiling_before"), _demo("ceiling_after_stain")).result
    assert r["aligned"] and [reg["shape"] for reg in r["regions"]] == ["patch"]


def test_retake_of_unchanged_wall_flags_nothing():
    r = vision.compare(_demo("wall_before"), _demo("wall_after_same")).result
    assert r["aligned"] and not r["changed"] and r["regions"] == []


def test_photos_of_different_places_are_not_matched():
    c = vision.compare(_demo("wall_before"), _demo("ceiling_after_stain"))
    assert c.result["aligned"] is False and c.overlay_jpeg is None
