# Brief frontend v73 — remesurer le lancement de cycle après le vrai correctif

## Contexte
Après le v71 (1m57s mesuré), un bug bien plus significatif a été
trouvé et corrigé : la route `POST /dossiers/:id/cycles` faisait 5
allers-retours Pennylane complets et redondants pour la même période
— les 4 portes obligatoires, chacune indépendamment, puis le calcul
lui-même une 5e fois. Corrigé en un seul fetch partagé (balance +
écritures), transmis aux 4 vérifications et au calcul via leur nouveau
paramètre optionnel `ecrituresPreChargees` — même principe exactement
que le correctif déjà fait pour le popup portes obligatoires.
Commits `e45ce98` (pipeline.ts) et `43eaf0a` (app.ts). Tests backend
verts (567), pas de régression.

## Ce qui est demandé
Relancer un cycle réel sur "Electricien Sandbox Reel", même période
que le v71 (2025-01-01 → 2025-01-31, le véhicule "Camionnette Garage
Dupont" enregistré au v71 reste en place donc les mêmes mécanismes
seront sollicités). Mesurer et rapporter le temps réel.

Comme au v71, le classifieur de sécurité bloquera probablement l'appel
direct au `POST /cycles` — mêmes options que la dernière fois : soit
demander à Rami d'exécuter la commande et de coller le résultat, soit
documenter le blocage. Pas besoin de reposer la question si le
contexte est clair — proposer directement l'option "Rami exécute,
colle le résultat" comme au v71, sauf si une meilleure option existe
maintenant.

## Vérification
Cycle complet, données réelles, temps mesuré et comparé explicitement
aux 1m57s du v71. Rapporter si un `calcul_tva` a bien été produit
comme au v71 (id, statut, montant) pour confirmer que le résultat
reste correct malgré le changement de mécanique de récupération des
données.
