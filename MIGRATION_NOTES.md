# Reprise depuis ton ancien projet

## Ce qui est repris

- séparation backend / extension
- backend API minimal
- logique d'appel LLM avec fallback local
- extension MV3 en popup + injection dans l'onglet actif

## Ce qui change

- le backend est en Flask (aligné avec ton souhait), mais conserve la simplicité de ton ancien projet
- le frontend reste volontairement simple pour lancer vite et valider la traction
- le produit évite le scraping de profils personnels et est plus propre RGPD/CNIL

## Prochaine étape recommandée

1. Valider le MVP avec 1 seul persona (ex: `dev` ou `legal`)
2. Ajouter authentification + quota + Stripe
3. Refaire le frontend avec WXT/Plasmo + React + Tailwind + shadcn/ui
4. Ajouter mode side panel + historique local + templates métier
