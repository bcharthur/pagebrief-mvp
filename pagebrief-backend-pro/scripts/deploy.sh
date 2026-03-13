#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/srv/pagebrief/pagebrief-backend-pro"

cd "$APP_DIR"

docker compose -f docker-compose.vps.yml up -d --build --remove-orphans
docker compose -f docker-compose.vps.yml exec -T api alembic upgrade head
curl -f http://127.0.0.1/healthz || exit 1
docker image prune -f
docker compose -f docker-compose.vps.yml ps