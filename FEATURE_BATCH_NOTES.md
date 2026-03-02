# Batch PageBrief V2

Ce zip regroupe le backend et le frontend avec les fonctionnalités demandées :

- nouvelle structure de rendu : **intro / liste de points / conclusion / blocs annexes** ;
- bouton de ciblage pour sélectionner un passage dans une page HTML ;
- analyse ciblée via `scope=selection` ;
- backend plus robuste sur les PDF publics et le parsing LLM ;
- temps de lecture calculé sur le texte complet.

## Conseils

- Recharge l'extension après avoir remplacé les fichiers.
- Redémarre Flask après avoir copié le backend.
- Pour les PDF, garde l'analyse du document entier ; le ciblage au clic vise surtout les pages HTML.
