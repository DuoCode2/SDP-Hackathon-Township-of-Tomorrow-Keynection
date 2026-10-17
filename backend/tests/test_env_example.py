""".env.example at the repository root lists every server setting with one line on what it does, so SDP IT and the
team never have to search the code for a name. These keep it complete and honest: every KEYNECTION_ setting the
code or the deployment files read is in the example, the example names nothing that is not read anywhere, and
each setting has a line saying what it does."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # prototype/
READ_BY = [ROOT / "backend" / "app", ROOT / "backend" / "scripts", ROOT / "Dockerfile", ROOT / "render.yaml",
           ROOT / "railway.json", ROOT / "start-demo.bat", ROOT / "start-demo.sh", ROOT / "start-dev.bat"]
EXAMPLE = ROOT / ".env.example"


def _names_in_code() -> set[str]:
    names: set[str] = set()
    for place in READ_BY:
        files = [p for p in place.rglob("*.py")] if place.is_dir() else [place]
        for f in files:
            text = f.read_text(encoding="utf-8", errors="ignore")
            names |= set(re.findall(r"\bKEYNECTION_[A-Z][A-Z0-9_]*", text))
            names |= {f"KEYNECTION_{n}" for n in re.findall(r'setting\(\s*"([A-Z][A-Z0-9_]*)"', text)}
    return names


def _example_lines() -> list[str]:
    return EXAMPLE.read_text(encoding="utf-8").splitlines()


def _names_in_example() -> set[str]:
    return {m.group(1) for line in _example_lines() if (m := re.match(r"#?\s*(KEYNECTION_[A-Z0-9_]+)=", line))}


def test_env_example_exists_at_the_repository_root():
    assert EXAMPLE.is_file()


def test_every_setting_the_code_reads_is_in_env_example():
    missing = _names_in_code() - _names_in_example()
    assert not missing, f"add to .env.example: {sorted(missing)}"


def test_env_example_names_nothing_the_code_does_not_read():
    extra = _names_in_example() - _names_in_code()
    assert not extra, f"named in .env.example but read nowhere: {sorted(extra)}"


def test_every_setting_in_env_example_has_a_line_saying_what_it_does():
    lines = _example_lines()
    bare = []
    for i, line in enumerate(lines):
        if re.match(r"#?\s*KEYNECTION_[A-Z0-9_]+=", line):
            above = lines[i - 1].strip() if i else ""
            if not (above.startswith("#") and not re.match(r"#?\s*KEYNECTION_[A-Z0-9_]+=", above)):
                bare.append(line.split("=")[0].lstrip("# "))
    assert not bare, f"no explanation above: {bare}"
