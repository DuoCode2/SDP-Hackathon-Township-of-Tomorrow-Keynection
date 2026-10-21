"""The aws32g deploy names its commit in /api/health: the deployer passes the commit it builds to the image build, and
the Dockerfile turns it into KEYNECTION_COMMIT in the image that runs. If either half goes, the health check silently
stops naming the version (the server tests still pass), so this reads both files."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_the_deployer_passes_the_commit_it_builds_to_the_image_build():
    deployer = (ROOT / "deploy" / "aws32g" / "deployer.py").read_text(encoding="utf-8")
    build = re.search(r'run\(\["/usr/local/bin/depot", "build",(.*?)\], logfile', deployer, re.S)
    assert build, "the depot build command moved: update this test"
    assert re.search(r'"--build-arg",\s*f"GIT_COMMIT=\{sha\}"', build.group(1)), build.group(1)


def test_the_image_that_runs_keeps_the_commit():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    final_stage = re.split(r"^FROM\s", dockerfile, flags=re.M)[-1]  # an ARG only reaches the stage that declares it
    assert re.search(r"^ARG GIT_COMMIT\b", final_stage, re.M), "ARG GIT_COMMIT must be declared in the final stage"
    assert re.search(r"^ENV KEYNECTION_COMMIT=\$\{?GIT_COMMIT\}?\s*$", final_stage, re.M)
