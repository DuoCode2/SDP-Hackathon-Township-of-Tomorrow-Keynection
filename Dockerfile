# Keynection online: one container serves the API and the built web app on one port, like start-demo.bat.
# Settings come from the host: PORT (set by the host), a volume mounted at /data so the database and photos survive
# restarts, and either KEYNECTION_SITE_PASSWORD (the demo: required online, the demo has no sign-in) or, for a pilot
# with real households, KEYNECTION_DEMO_MODE=0 and KEYNECTION_ORIGIN (everyone signs in with a digital key; no site
# password). Demo mode is the default. Servers set up with the old JIRAN_ names keep working.
# The first staff member of a pilot: set KEYNECTION_FIRST_STAFF="Name" (their sign-in link appears in the log), or run
# python backend/scripts/add_staff.py "Name" --role estate in the container. See docs/pilot-deployment.md.

# 1) Build the web app (same Node major version as the team's laptops)
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# 2) The API, serving the built app (same Python minor version as the team's laptops)
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KEYNECTION_DB_PATH=/data/app.db
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY backend/scripts backend/scripts
COPY --from=web /web/dist frontend/dist
EXPOSE 8000
# One worker on purpose: the demo database is SQLite on a single volume.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
