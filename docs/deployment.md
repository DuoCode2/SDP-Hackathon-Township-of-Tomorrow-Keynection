# How main gets deployed

> **中文**：每次 main 有改动、测试通过，就自动部署到 https://keynection.agenticcs.net，谁推的都一样，不靠任何人的电脑。GitHub 上的 Deploy 工作流只建一条 GitHub Deployment 并等结果；团队在 AWS 上的机器（aws32g）上有个部署服务看到它，就在 Depot 上编这个提交的镜像、换掉容器、检查健康、把结果回报给 GitHub（失败自动退回上一版）。想重新部署或退回旧版本：Actions → Deploy → Run workflow，填分支、tag 或提交。GitHub 里不放任何密钥。

```
push to main ──► Tests (GitHub Actions) ──green──► Deploy (GitHub Actions): creates a GitHub Deployment, waits
                                                        │
              aws32g (Lightsail Singapore) ◄────────────┘ keynection-deployer sees it within 15 s
              ├─ git fetch that commit
              ├─ depot build --load  (Depot project "keynection", us-east-1; cached)
              ├─ docker compose up   (container keynection-app, locked down)
              ├─ /api/health locally, then through the public URL
              └─ reports in_progress → success / failure (failure: previous image put back)
                                                        │
              Cloudflare tunnel ◄── keynection-tunnel ◄─┘ the site's only way in (no open ports)
```

- **Who can deploy:** anyone whose push lands on main (after Tests pass), or anyone with write access through
  Actions → **Deploy** → **Run workflow** (any branch, tag or commit: a redeploy, or a rollback).
- **What it costs:** Depot build minutes (a cold build about 2 minutes, a cached one seconds; the Depot account caps
  container builds at 150 minutes a month) and a few GitHub Actions minutes while the Deploy job waits. The site
  itself runs on the team's existing machine.
- **Where the result shows:** the Deploy run goes green or red with the deploy; the repo's Environments panel shows
  `production` and its URL; a failure also alerts the team's ntfy channel.
- **Secrets:** none in GitHub. On the machine they are systemd credentials and root-only files
  (see `/usr/local/lib/keynection-deployer/README.md` there).
- **The app's container:** non-root, read-only root filesystem, no Linux capabilities, its own network, memory and
  process limits, port on 127.0.0.1 only; the machine also runs other services.

## When something goes wrong

| | |
|---|---|
| Deploy run says "No answer" | the deployer on aws32g is not running: `sudo systemctl status keynection-deployer` |
| Deploy failed | the run shows why; the full log is on aws32g in `/var/log/keynection-deployer/`; the previous release stayed up |
| Stop all deploys | `sudo systemctl stop keynection-deployer` on aws32g (the site keeps running) |
| Roll back | Run workflow with the older commit, or on aws32g set `IMAGE=keynection:<sha12>` in `/opt/keynection/current.env` and run `docker compose -f /opt/keynection/compose.yaml --env-file /opt/keynection/current.env -p keynection up -d` |

**Which version is live:** https://keynection.agenticcs.net/api/health answers `{"status":"ok","version":"<commit>"}`
(the deployer builds the image with `--build-arg GIT_COMMIT=<sha>`; the Dockerfile keeps it as `KEYNECTION_COMMIT`).

https://keynection.agenticcs.net is the only site. The address the judges were given, https://keynection.onrender.com
(Render, free tier), now sends every visit to the same page there (`KEYNECTION_MOVED_TO`; the password is the same),
so links already shared keep working. "Keep the demo awake" keeps that forwarder awake on the judging days; after
14 Nov the Render service is suspended and that workflow deleted.
