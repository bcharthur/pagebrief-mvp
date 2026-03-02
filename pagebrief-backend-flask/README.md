# PageBrief backend Flask V3

API REST pour l'extension PageBrief en panneau latéral.

## Formats pris en charge

- `express`
- `analytic`
- `decision`
- `study`

## Lancer en local (PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m flask --app app.main:app run --host 0.0.0.0 --port 8000
```

## Notes V3

- gros PDF : en portée `document`, PageBrief passe en **vue d'ensemble** dès que le document devient trop volumineux
- le temps de lecture reste calculé sur le document complet extrait
- la sortie varie selon le format sélectionné dans l'extension
