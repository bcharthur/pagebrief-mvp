# PageBrief backend (Flask)

Backend REST minimal pour une extension Chrome MV3 qui résume une page ouverte en un clic.

## Endpoints

- `GET /`
- `GET /health`
- `POST /v1/pagebrief/summarize`

## Lancer en local (Windows PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m flask --app app.main:app run --host 0.0.0.0 --port 8000
```

## Vérifier rapidement

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/health`

Tu dois voir un JSON avec `status: ok`.

## Exemple de payload

```json
{
  "url": "https://example.com/doc",
  "title": "Titre de la page",
  "page_text": "Texte extrait par l'extension...",
  "mode": "dev"
}
```

## Modes

- `general`
- `dev`
- `sales`
- `buyer`
- `legal`

## Notes produit

- Si `page_text` est vide et que l'URL pointe vers un PDF public, le backend tente de télécharger le PDF et d'en extraire le texte.
- Le résumé local fonctionne sans LLM.
- Si Ollama est disponible en local, le backend améliore le rendu avec un JSON structuré.
- Le `.env.example` est configuré pour un Ollama local sur `http://localhost:11434`.
