# PageBrief backend (Flask)

Backend REST minimal pour une extension Chrome MV3 qui résume une page ouverte en un clic.

## Endpoints

- `GET /health`
- `POST /v1/pagebrief/summarize`

## Lancer en local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m flask --app app.main:app run --host 0.0.0.0 --port 8000
```

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
- Si Ollama est disponible, le backend améliore le rendu avec un JSON structuré.
