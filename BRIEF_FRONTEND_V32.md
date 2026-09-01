# Brief frontend v32 — le panneau Calcul ne se rafraîchit pas à la résolution d'une anomalie

## Symptôme rapporté par Rami
Après avoir résolu une anomalie (bouton "Résoudre" ou "Justifier", ou la
qualification "vente"/"autre" pour `encaissement_non_affecte`), le montant
affiché dans le panneau sticky "Calcul de la période" (v31) ne se met pas
à jour. Il faut un **rechargement complet de la page** (F5) pour voir le
bon montant — un simple "Rafraîchir" dans l'app ne suffit pas.

Le backend est confirmé correct (le montant est bien à jour en base
immédiatement après résolution, cf. `listerCalculs` qui recalcule le
compte d'anomalies bloquantes en direct à chaque appel, et l'ajustement
automatique déjà vérifié par les tests backend) — c'est bien un problème
d'affichage, pas de données.

## Cause probable
Le panneau "Calcul de la période" (v31, sticky) est vraisemblablement un
composant séparé de la liste des anomalies, qui ne partage pas le même
déclencheur de rafraîchissement — même famille de problème que celui
corrigé en v14 et v21 (`refreshKey` partagé). À vérifier et corriger de
la même façon : toute action de résolution/justification d'anomalie
(bouton "Résoudre", "Justifier", et la qualification
`encaissement_non_affecte`) doit aussi déclencher un nouveau chargement
des données du panneau Calcul, pas seulement de la liste des anomalies
elle-même.

## Vérification
Comme toujours : dev server, actions réelles, sans recharger la page.
Résoudre une anomalie qui affecte le calcul (ex: qualifier un
`encaissement_non_affecte` comme "vente"), vérifier que le montant du
panneau Calcul se met à jour immédiatement, sans aucun rechargement
manuel de la page.
