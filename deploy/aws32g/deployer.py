#!/usr/bin/env python3
"""keynection-deployer: deploys DuoCode2/SDP-Hackathon-Township-of-Tomorrow-Keynection on this host.

GitHub's Deploy workflow (on every green main, or "Run workflow" by anyone with write access) creates a GitHub
Deployment for the environment in the config. This service polls for it, and for the newest pending one:
fetches that commit, builds the image on Depot (`depot build --load`, nothing pushed anywhere), swaps the app
container (docker compose project `keynection`), checks /api/health locally and through the public URL, and
reports in_progress / success / failure back to the deployment, which the workflow is waiting on. An unhealthy
release is rolled back to the previous image. Older pending deployments are marked inactive (superseded).

Secrets come from systemd credentials only (LoadCredentialEncrypted=github-token, depot-token); the GitHub
token reaches git through GIT_CONFIG_* environment variables, never through argv. Python standard library only.
Notes: /usr/local/lib/keynection-deployer/README.md
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CONFIG = json.loads(Path("/etc/keynection/deployer.json").read_text())
REPO = CONFIG["repo"]
ENV_NAME = CONFIG["environment"]
PUBLIC_URL = CONFIG["public_url"].rstrip("/")
PROJECT = CONFIG["depot_project"]
PORT = int(CONFIG["port"])
KEEP = int(CONFIG.get("keep_images", 3))
ROOT = Path("/opt/keynection")
LOGS = Path("/var/log/keynection-deployer")
CREDS = Path(os.environ["CREDENTIALS_DIRECTORY"])
GH_TOKEN = (CREDS / "github-token").read_text().strip()
DEPOT_TOKEN = (CREDS / "depot-token").read_text().strip()
NTFY = Path("/etc/ghrunner/ntfy_url")
POLL = 15
SHA = re.compile(r"^[0-9a-f]{40}$")


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def gh(method: str, path: str, body: dict | None = None, etag: str | None = None):
    headers = {"Authorization": f"Bearer {GH_TOKEN}", "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "keynection-deployer"}
    if etag:
        headers["If-None-Match"] = etag
    data = json.dumps(body).encode() if body is not None else None
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request("https://api.github.com" + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r), r.headers.get("ETag")
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return 304, None, etag
        raise


def status(dep_id: int, state: str, description: str, url: str | None = None) -> None:
    body = {"state": state, "description": description[:140], "auto_inactive": state == "success"}
    if url:
        body["environment_url"] = url
    gh("POST", f"/repos/{REPO}/deployments/{dep_id}/statuses", body)
    log(f"deployment {dep_id}: {state} · {description[:140]}")


def notify(title: str, text: str) -> None:
    try:
        url = NTFY.read_text().strip()
        urllib.request.urlopen(urllib.request.Request(url, data=text.encode(), headers={"Title": title, "Tags": "rotating_light"}), timeout=10)
    except Exception as e:  # an alert that cannot be sent must not stop a deploy
        log(f"ntfy failed: {type(e).__name__}")


def run(cmd: list[str], logfile, env: dict | None = None, timeout: int = 1800, stdin=None) -> None:
    logfile.write(f"$ {' '.join(cmd)}\n")
    logfile.flush()
    subprocess.run(cmd, stdout=logfile, stderr=subprocess.STDOUT, env={**os.environ, **(env or {})}, timeout=timeout,
                   check=True, stdin=stdin)


def healthy(url: str, seconds: int) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        try:
            # A user agent of our own: Cloudflare turns Python's default one away (error 1010).
            req = urllib.request.Request(url, headers={"User-Agent": "keynection-deployer/1"})
            with urllib.request.urlopen(req, timeout=10) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(3)
    return False


def compose(image: str, logfile) -> None:
    (ROOT / "current.env").write_text(f"IMAGE={image}\n")
    run(["docker", "compose", "-f", str(ROOT / "compose.yaml"), "--env-file", str(ROOT / "current.env"), "-p", "keynection",
         "up", "-d", "--remove-orphans"], logfile, timeout=300)


def current_image() -> str | None:
    p = ROOT / "current.env"
    if not p.exists():
        return None
    m = re.search(r"^IMAGE=(.+)$", p.read_text(), re.M)
    return m.group(1).strip() if m else None


def prune(keep: set[str], logfile) -> None:
    out = subprocess.run(["docker", "images", "keynection", "--format", "{{.Repository}}:{{.Tag}} {{.CreatedAt}}"],
                         capture_output=True, text=True).stdout.split("\n")
    tags = [line.split(" ", 1)[0] for line in out if line.strip()]  # newest first
    for tag in tags[KEEP:]:
        if tag not in keep:
            subprocess.run(["docker", "rmi", tag], stdout=logfile, stderr=subprocess.STDOUT)
    builds = sorted((ROOT / "builds").iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in builds[KEEP:]:
        shutil.rmtree(old, ignore_errors=True)


def deploy(dep: dict) -> None:
    dep_id, sha = dep["id"], dep["sha"]
    if not SHA.match(sha):
        return status(dep_id, "error", f"not a commit sha: {sha!r}")
    short, image = sha[:12], f"keynection:{sha[:12]}"
    LOGS.mkdir(parents=True, exist_ok=True)
    previous = current_image()
    with open(LOGS / f"{dep_id}-{short}.log", "w") as logfile:
        status(dep_id, "in_progress", f"Building {short} on Depot")
        try:
            src, build = ROOT / "src", ROOT / "builds" / short
            if not (src / ".git").exists():
                run(["git", "init", "-q", str(src)], logfile)
                run(["git", "-C", str(src), "remote", "add", "origin", f"https://github.com/{REPO}.git"], logfile)
            auth = base64.b64encode(f"x-access-token:{GH_TOKEN}".encode()).decode()
            git_env = {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                       "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {auth}", "GIT_TERMINAL_PROMPT": "0"}
            run(["git", "-C", str(src), "fetch", "-q", "--depth", "1", "origin", sha], logfile, env=git_env, timeout=300)
            shutil.rmtree(build, ignore_errors=True)
            build.mkdir(parents=True)
            archive = subprocess.run(["git", "-C", str(src), "archive", sha], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", str(build)], input=archive, check=True)
            run(["/usr/local/bin/depot", "build", "--project", PROJECT, "--platform", "linux/amd64", "--load",
                 "-t", image, "--label", f"org.opencontainers.image.revision={sha}", "--build-arg", f"GIT_COMMIT={sha}",
                 str(build)], logfile,
                env={"DEPOT_TOKEN": DEPOT_TOKEN}, timeout=1800)
            status(dep_id, "in_progress", f"Starting {short}")
            compose(image, logfile)
            if not healthy(f"http://127.0.0.1:{PORT}/api/health", 120):
                raise RuntimeError("the new release did not answer /api/health within 120 s")
            public_ok = healthy(f"{PUBLIC_URL}/api/health", 60)
            prune({image, previous or ""}, logfile)
            status(dep_id, "success", f"{short} live" + ("" if public_ok else " (public URL not answering yet)"), PUBLIC_URL)
            if not public_ok:
                notify("keynection: public URL not answering", f"{short} is healthy on aws32g but {PUBLIC_URL} did not answer")
        except Exception as e:
            reason = f"{type(e).__name__}: {e}"[:200]
            logfile.write(f"\nFAILED: {reason}\n")
            back = ""
            if previous and previous != image:
                try:
                    compose(previous, logfile)
                    back = f"; rolled back to {previous.split(':')[1]}" if healthy(f"http://127.0.0.1:{PORT}/api/health", 120) \
                        else f"; rollback to {previous.split(':')[1]} not healthy either"
                except Exception as e2:
                    back = f"; rollback failed ({type(e2).__name__})"
            status(dep_id, "failure", f"{short}: {reason}"[:120] + back)
            notify("keynection deploy failed", f"{short}: {reason}{back}. Log: aws32g {LOGS}/{dep_id}-{short}.log")


def pending() -> list[dict]:
    code, deps, _ = gh("GET", f"/repos/{REPO}/deployments?environment={ENV_NAME}&per_page=10")
    out = []
    for d in deps or []:
        _, sts, _ = gh("GET", f"/repos/{REPO}/deployments/{d['id']}/statuses?per_page=1")
        if not sts or sts[0]["state"] in ("queued", "pending"):
            out.append(d)
    return sorted(out, key=lambda d: d["id"], reverse=True)


def interrupted() -> None:
    """A deployment left in_progress by a restart of this service will never finish: say so, so the workflow
    waiting on it fails now instead of at its timeout."""
    _, deps, _ = gh("GET", f"/repos/{REPO}/deployments?environment={ENV_NAME}&per_page=10")
    for d in deps or []:
        _, sts, _ = gh("GET", f"/repos/{REPO}/deployments/{d['id']}/statuses?per_page=1")
        if sts and sts[0]["state"] == "in_progress":
            status(d["id"], "error", "interrupted: the deployer restarted; run the Deploy workflow again")


def main() -> None:
    log(f"watching {REPO} environment {ENV_NAME!r} → {PUBLIC_URL}")
    interrupted()
    etag = None
    while True:
        try:
            code, _, etag = gh("GET", f"/repos/{REPO}/deployments?environment={ENV_NAME}&per_page=1", etag=etag)
            if code != 304:
                todo = pending()
                for older in todo[1:]:
                    status(older["id"], "inactive", f"superseded by {todo[0]['sha'][:12]}")
                if todo:
                    deploy(todo[0])
                    etag = None  # look again at once: a newer one may have come in meanwhile
                    continue
        except Exception as e:
            log(f"poll error: {type(e).__name__}: {str(e)[:200]}")
        time.sleep(POLL)


if __name__ == "__main__":
    sys.exit(main())
