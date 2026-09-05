# Brief frontend v44 — TVA hôtel + détail persistant du calcul (point important)

Deux sujets, dont un corrige un vrai trou trouvé par Claude Code en
vérifiant le brief v43.

## 1. TVA hôtel — deux anomalies, deux circuits différents

**`tva_hotel_a_tort`** (déterministe, bloquant) : **un seul bouton**
"Vérifier à nouveau" — pas de qualification préalable, jamais de "c'est
faux" (aucune ambiguïté possible, compte fournisseur dédié aux hôtels).
`POST /dossiers/:dossierId/verifier-tva-hotel` avec
`{periodeDebut, periodeFin, utilisateurId}`.

**`tva_hotel_a_verifier`** (jugement IA, signalé) : **deux boutons**
d'abord — `POST /anomalies/:id/qualifier-tva-hotel` avec
`{utilisateurId, type: 'confirme'|'ignore'}` — puis le même bouton
"Vérifier à nouveau" une fois confirmé (même route que ci-dessus, elle
gère les deux types en un seul appel).

Réponse de "Vérifier à nouveau" dans les deux cas :
`{anomaliesOuvertes: number, corrections: number}`.

## 2. Détail persistant par catégorie du calcul (point important)

Nouvelle route : `GET /calculs/:calculId/detail`. Retourne un tableau de
8 lignes (une par catégorie : `collectee_20`, `collectee_10`,
`collectee_5_5`, `collectee_2_1`, `deductible_abs`, `deductible_immo`,
`autoliquidation_due`, `autoliquidation_deductible`), chacune avec
`{categorie, montant, ajuste}` — `ajuste: true` signifie que ce montant
reflète un ajustement (avoir, véhicule tourisme, immobilisation, taux
collecte...), pas juste la somme brute du cycle.

**Pourquoi c'est important** : jusqu'ici, le panneau "Calcul de la
période" ne savait afficher que les deux totaux agrégés
(`collectee_totale`/`deductible_totale`) — les transferts entre deux
catégories précises (immobilisation v41, taux de collecte v43)
n'avaient donc **aucune trace visible** après qualification, en dehors
du tableau transitoire affiché juste après le lancement d'un cycle. Un
collaborateur qui qualifiait une de ces anomalies puis rechargeait la
page ne voyait plus jamais le résultat de sa correction.

Le panneau de calcul doit maintenant afficher ces 8 catégories de façon
persistante (via cette nouvelle route), avec une indication visuelle
claire pour les lignes `ajuste: true` — par exemple un badge ou une
couleur différente, pour que le collaborateur comprenne que ce chiffre a
été modifié manuellement plutôt que directement issu du cycle.

## Vérification
Comme toujours : dev server, actions réelles. Pour l'hôtel : provoquer
les deux anomalies réelles, qualifier `tva_hotel_a_verifier` avec les
deux boutons séparément, tester "Vérifier à nouveau" pour les deux types
avant et après correction réelle côté Pennylane. Pour le détail
persistant : qualifier une anomalie de transfert (immobilisation ou taux
de collecte), recharger complètement la page, vérifier que le nouveau
montant reste visible dans le panneau de calcul.
