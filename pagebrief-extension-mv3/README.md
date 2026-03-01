# PageBrief extension (Chrome MV3)

Extension MVP volontairement simple pour réutiliser la structure de ton ancien projet :

- `manifest.json`
- `popup.html`
- `popup.css`
- `popup.js`

## Installation locale

1. Ouvre `chrome://extensions`
2. Active **Mode développeur**
3. Clique **Charger l'extension non empaquetée**
4. Sélectionne ce dossier

## Ce que fait ce MVP

- Extrait le texte de l'onglet courant (priorité au texte sélectionné si assez long)
- Envoie le contenu au backend
- Affiche :
  - résumé en 5 points
  - temps de lecture estimé
  - actions à retenir
  - risques / points flous
  - TL;DR

## Limites connues

- Sur une page PDF, l'extension n'extrait pas le texte du viewer Chrome. Elle envoie l'URL : le backend tente alors de télécharger le PDF si l'URL est publique.
- Pour une version plus premium/stylée, la prochaine étape recommandée est `WXT` ou `Plasmo` + `React` + `Tailwind` + `shadcn/ui`.
