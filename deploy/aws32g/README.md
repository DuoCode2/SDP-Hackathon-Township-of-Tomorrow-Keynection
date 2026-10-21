# keynection-deployer (aws32g, 2026-10-21)

Every push to `main` of DuoCode2/SDP-Hackathon-Township-of-Tomorrow-Keynection whose Tests pass makes the repo's
Deploy workflow create a GitHub Deployment (environment `production`); anyone with write access can also start one
with "Run workflow". This service picks the newest pending one, builds it on Depot (project `keynection`
b3gw1528tz, `depot build --load`, no registry; `--build-arg GIT_COMMIT=<sha>` so /api/health names the version),
swaps the `keynection-app` container, checks /api/health on 127.0.0.1:8095 and on the public URL, and reports the
result to the deployment the workflow waits on. Unhealthy: the previous image goes back. Public URL and settings:
/etc/keynection/deployer.json (public URL https://keynection.agenticcs.net since 22 Oct).

- Files: /opt/keynection/{compose.yaml, app.env (600), tunnel.env (600), current.env, data/, src/, builds/};
  logs per deployment /var/log/keynection-deployer/<id>-<sha>.log; journal `journalctl -u keynection-deployer`.
- Secrets: /etc/keynection/{github-token,depot-token}.cred (systemd-creds, host key). github-token is the same
  SunflowersLwtech PAT as ghrunner-ctl; depot-token is the keynection project token (vk DuoCode/Depot …
  DEPOT_PROJECT_TOKEN_KEYNECTION). app.env: site password, ANTHROPIC_API_KEY, KEYNECTION_VOICE_KEY.
- Stop deploying: `systemctl stop keynection-deployer` (the site keeps running). Stop the site:
  `docker compose -p keynection -f /opt/keynection/compose.yaml down`.
- Roll back by hand: put `IMAGE=keynection:<older sha12>` in /opt/keynection/current.env, then
  `docker compose -f /opt/keynection/compose.yaml --env-file /opt/keynection/current.env -p keynection up -d`;
  or "Run workflow" on Deploy with that commit.
- Failures alert on ntfy (/etc/ghrunner/ntfy_url).
