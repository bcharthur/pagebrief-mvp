#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo ".env manquant. Copie .env.example vers .env et configure tes secrets."
  exit 1
fi

docker compose -f docker-compose.vps.yml up -d --build
docker image prune -f
