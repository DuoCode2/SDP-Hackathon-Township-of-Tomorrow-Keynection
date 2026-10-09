# Jiran5 online: one container serves the API and the built web app on one port, like start-demo.bat.
# Settings come from the host: PORT (set by the host), JIRAN_SITE_PASSWORD (required online: the prototype
# has no sign-in), and a volume mounted at /data so the demo database and photos survive restarts.

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
    JIRAN_DB_PATH=/data/app.db \
    JIRAN_DEMO_MODE=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY --from=web /web/dist frontend/dist
EXPOSE 8000
# One worker on purpose: the demo database is SQLite on a single volume.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
