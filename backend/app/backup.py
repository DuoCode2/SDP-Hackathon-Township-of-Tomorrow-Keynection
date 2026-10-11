"""Pilot: a copy of everything every day, kept 14 days (the privacy notice says so).

A fault, a bad upgrade or a mistake can be undone from yesterday's copy, and what was deleted (a closed account,
records whose time was up) leaves the copies within two weeks too. The database is copied with SQLite's own online
backup, so it is consistent even while the server is writing; photo and comparison files are mirrored (new ones
copied, deleted ones removed). The copies sit next to the data: copy the backups folder off the server as well.
"""
from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

KEEP_DAYS = 14
STAMP = "keynection-%Y%m%d-%H%M.db"


def _made(path: Path) -> datetime | None:
    try:
        return datetime.strptime(path.name, STAMP).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def backup_now(db_file: str, folder: Path, mirror: dict[str, Path], now: datetime | None = None) -> Path:
    """Copy the database and mirror the file folders into `folder`; keep the newest 14 copies, none older than 14 days."""
    now = now or datetime.now(timezone.utc)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / now.strftime(STAMP)
    source, copy = sqlite3.connect(db_file), sqlite3.connect(target)
    try:
        with copy:
            source.backup(copy)
    finally:
        source.close()
        copy.close()
    copies = sorted((p for p in folder.glob("keynection-*.db") if _made(p)), key=lambda p: _made(p) or now)
    for old in copies[:-KEEP_DAYS]:
        old.unlink(missing_ok=True)
    for old in copies[-KEEP_DAYS:]:
        made = _made(old)
        if made is not None and made < now - timedelta(days=KEEP_DAYS):
            old.unlink(missing_ok=True)
    for name, files in mirror.items():
        dest = folder / name
        dest.mkdir(exist_ok=True)
        present = {p.name for p in files.iterdir() if p.is_file()} if files.exists() else set()
        for p in dest.iterdir():
            if p.name not in present:
                p.unlink()
        for n in present:
            if not (dest / n).exists():
                shutil.copy2(files / n, dest / n)
    return target


def newest(folder: Path) -> datetime | None:
    stamps = [m for m in (_made(p) for p in folder.glob("keynection-*.db")) if m]
    return max(stamps) if stamps else None
