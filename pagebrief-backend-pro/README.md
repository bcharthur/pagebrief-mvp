# PageBrief Backend Pro

Backend professionnel pour **PageBrief** :
- API REST **FastAPI**
- jobs asynchrones via **Celery + Redis**
- base de données **PostgreSQL**
- auth JWT
- quotas Free / Premium
- historique serveur
- support PDF public + upload PDF local
- Docker multi-services prêt pour VPS
- CI/CD GitHub Actions

## Architecture

- `app/` : code applicatif
- `docker/` : Dockerfiles par techno / service
- `.github/workflows/` : CI/CD
- `scripts/deploy.sh` : déploiement VPS
- `docker-compose.vps.yml` : stack production simple

## Démarrage local

```bash
cp .env.example .env
docker compose -f docker-compose.vps.yml up --build
```

Ensuite :
- API : `http://localhost:8000`
- Health : `http://localhost:8000/healthz`
- Docs : `http://localhost:8000/docs`

## Première utilisation

1. `POST /v1/auth/register`
2. `POST /v1/auth/login`
3. Utiliser le `access_token` dans `Authorization: Bearer <token>`
4. Créer un job :
   - `POST /v1/jobs`
5. Suivre le job :
   - `GET /v1/jobs/{job_id}`
   - `GET /v1/jobs/{job_id}/events`
6. Historique :
   - `GET /v1/history`

## Déploiement VPS

1. Créer un serveur Linux avec Docker + Docker Compose plugin
2. Configurer les secrets GitHub (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_APP_DIR`)
3. Pousser sur `main` ou lancer le workflow `deploy`

Le workflow :
- archive le projet
- copie les fichiers sur le VPS
- exécute `scripts/deploy.sh`
- relance `docker compose -f docker-compose.vps.yml up -d --build`

## Ce qui est prêt

- multi-utilisateur isolé par `user_id`
- historique persistant
- quotas par plan
- jobs découplés de la requête HTTP
- progression de job
- upload de PDF local
- endpoints dédiés pour extension Chrome

## Ce que tu peux brancher ensuite facilement

- Stripe
- MinIO / S3
- Nginx TLS + domaine
- monitoring Prometheus / Grafana
- Sentry


## Windows PowerShell quick start

```powershell
Copy-Item .env.example .env
# Puis édite .env si nécessaire
docker compose -f docker-compose.vps.yml up --build
```

