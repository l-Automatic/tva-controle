# Brief frontend v4

## 1. Retirer "(sous-traitance)" du libellé
Partout où "Comptes de charge de service (sous-traitance)" apparaît,
retirer la parenthèse — garder "Comptes de charge de service". Ce champ
concerne toute prestation de service achetée (autoliquidée ou non), pas
spécifiquement la sous-traitance — le laisser tel quel créait une confusion
avec l'autoliquidation (déjà traitée par l'info-bulle du brief précédent,
qui reste valable).

## 2. Clarifier le libellé "Taux historique" (comptes)
Le tableau "Taux historique" côté compte ne porte QUE sur les sous-comptes
de TVA collectée (445711 à 445714) — jamais sur un compte produit/charge
(706, 607...) au sens comptable classique, malgré le nom de la colonne
technique `compteProduitOuCharge`. Renommer l'intitulé affiché de cette
section en quelque chose comme **"Comptes de TVA collectée"** plutôt que
"Comptes produit/charge" — évite la confusion vécue par Rami entre cette
section et l'onglet Taux assigné (qui, lui, porte vraiment sur des comptes
produit/charge). Le sous-onglet "Client" à côté reste nommé tel quel, la
distinction devient claire une fois le premier correctement nommé.

## 3. Formulaire "Ajouter" manquant dans Conventions génériques
Contrairement à Conventions de comptes, cet onglet n'a pas de formulaire
pour ajouter une nouvelle clé/valeur — impossible d'y re-créer une
convention après une perte de données (vécu concrètement : Rami bloqué
avec une anomalie sur l'autoliquidation, aucun moyen de la résoudre lui-même
dans l'interface). Ajouter un formulaire clé/valeur libre, `POST
/dossiers/:id/conventions` (route existante, `ajouterConventionManuelle`),
suivi d'une confirmation (`POST /conventions/:id/confirmer`, existante) —
même mécanique que Conventions de comptes, juste avec un champ clé texte
libre au lieu d'un menu déroulant des 4 catégories fixes.

## 4. Suggestions de comptes dans l'onglet "Taux assigné"
Demande de Rami (09/08) : au lieu de saisie libre uniquement, proposer un
candidat par compte mouvementé pas encore assigné — comme le popup de
catégorisation, mais pour le taux plutôt que la convention.

Le résultat d'un cycle (`POST /dossiers/:id/cycles`) contient maintenant :
- `comptesSansTauxAssigne: {compte, exemplesLibelle}[]` — comptes
  produit/charge (classes 6/7) mouvementés sans taux assigné.
- `comptesClientSansTaux: {numeroCompteTiers, nomTiers}[]` — comptes
  clients mouvementés sans taux historique ni assignation manuelle.

Pour chaque compte listé, proposer un select pour choisir/confirmer le
taux, plutôt que de forcer une saisie du numéro de compte à la main :
- Côté produit/charge : `POST /dossiers/:id/taux-assignes`, body
  `{compte, taux, utilisateurId}`.
- Côté client : `POST /dossiers/:id/taux-historique-tiers/assigner`, body
  `{numeroCompteTiers, tauxHabituel, utilisateurId}` (ici `tauxHabituel`
  est un nombre — 20, 10, 5.5, 2.1 — pas une des valeurs enum du taux
  assigné produit/charge, les deux mécanismes ont des formats différents).

## 5. Libellés clairs pour les valeurs de taux assigné
Les valeurs techniques (`autoliquide_20`, `'0'`, etc.) doivent s'afficher
avec un libellé lisible, jamais la valeur brute :
- `'0'` → "Exonéré (0%)"
- `'2.1'` → "2,1%"
- `'5.5'` → "5,5%"
- `'10'` → "10%"
- `'20'` → "20%"
- `'autoliquide_intracom'` → "Intracommunautaire (taux non précisé)"
- `'autoliquide_20'` → "Intracommunautaire - 20%"
- `'autoliquide_10'` → "Intracommunautaire - 10%"
- `'autoliquide_5.5'` → "Intracommunautaire - 5,5%"

(Tiret simple, pas de tiret cadratin.)

## Contexte : correctif backend important, rien à faire côté frontend
Un bug significatif vient d'être corrigé : la plupart des types d'anomalies
(8 sur 12) réapparaissaient à chaque relance de cycle même après avoir été
résolues ou justifiées — seuls le 471 et "nouveau tiers" étaient protégés
jusqu'ici. Un filtre générique protège maintenant tous les types. Aucune
action frontend requise, juste une information pour comprendre pourquoi la
liste d'anomalies sera probablement plus courte lors des prochains tests.

## Vérification
Comme toujours : dev server, actions réelles, pas juste au build. En
particulier, vérifier que confirmer un taux suggéré dans le nouvel écran
fait bien disparaître le compte de la liste de suggestions au cycle
suivant.
