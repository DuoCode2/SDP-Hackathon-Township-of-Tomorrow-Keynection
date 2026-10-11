"""Add an estate-office or SDP staff member, and print the one-time code for their first sign-in.

The first staff member of a pilot is made here, on the server, so no web page can create staff accounts. After that,
signed-in staff add colleagues in the app. The code works once, for a week; with it the person signs in on their own
phone and makes their digital key.

Run from prototype/backend, with the same JIRAN_DB_PATH as the server:
    .venv/Scripts/python scripts/add_staff.py "Farah Aziz" --role estate
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import auth, db  # noqa: E402
from app.main import DEFAULT_DB  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("name", help="the name that signs their records, e.g. \"Farah Aziz\"")
    parser.add_argument("--role", choices=("estate", "sdp"), default="estate")
    parser.add_argument("--site", default=os.environ.get("KEYNECTION_ORIGIN", "").split(",")[0].strip(),
                        help="the pilot's web address, to print a ready-made link")
    args = parser.parse_args(argv)
    name = args.name.strip()
    if len(name) < 2:
        parser.error("the name needs at least 2 characters")
    conn = db.connect(os.environ.get("JIRAN_DB_PATH", str(DEFAULT_DB)))
    try:
        db.init_db(conn, keep_data=True)  # never rebuilds a pilot's records
        staff_id, token, expires = auth.add_staff(conn, name, args.role)
    finally:
        conn.close()
    print(f"Staff member {staff_id}: {name} ({args.role})")
    print(f"One-time code (works once, until {expires}): {token}")
    if args.site:
        print(f"Link for their phone: {args.site.rstrip('/')}/?code={token}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
