# PageBrief Frontend V4

Refonte du frontend de l'extension PageBrief pour le side panel Chrome.

## Ce qui change

- Interface refondue en **vues** séparées :
  - `Résumé`
  - `Analyser`
  - `Historique`
  - `Réglages`
- Menu latéral repliable (`☰`) pour naviguer entre les vues.
- Vue Résumé plus propre avec **accordéons**.
- Historique de session conservé via `chrome.storage.session`.
- Résultat toujours **attaché à l'onglet actif** (si une analyse existe pour cet onglet).

## Structure

- `panel.html` : shell du panneau
- `panel.css` : style global
- `panel.js` : orchestration
- `src/`
  - `constants.js`
  - `dom.js`
  - `helpers.js`
  - `state.js`
  - `storage.js`
  - `tabState.js`
  - `api.js`
  - `views/`
    - `renderView.js`
    - `analyzeView.js`
    - `historyView.js`
    - `settingsView.js`

## Installation

1. Ouvre `chrome://extensions`
2. Active le **Mode développeur**
3. Clique sur **Charger l'extension non empaquetée**
4. Sélectionne ce dossier
5. Clique sur l'icône de l'extension pour ouvrir le side panel

## Note

Le navigateur Chrome garde la main sur la largeur réelle du side panel.
Tu peux l'élargir manuellement en faisant glisser sa bordure.
