# Migration notes

Cette variante ajoute un vrai lot backend + frontend pour PageBrief :

- rendu orienté **intro / points clés / conclusion / blocs annexes** ;
- mode de **ciblage d'un passage** pour les pages HTML ;
- analyse ciblée côté backend avec `scope=selection` ;
- calcul du temps de lecture sur le texte complet ;
- meilleur nettoyage des PDF publics.

## Remplacement rapide

1. Remplace le dossier `pagebrief-backend-flask`
2. Remplace le dossier `pagebrief-extension-mv3`
3. Recharge l'extension dans Chrome
4. Redémarre le backend Flask
