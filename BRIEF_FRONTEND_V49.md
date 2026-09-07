# Brief frontend v49 — onglet Déclaration (première version)

## 1. Correction nécessaire d'abord — `packages/frontend/src/types.ts`

La catégorie `autoliquidation_due` a été séparée en deux
(`autoliquidation_due_btp` / `autoliquidation_due_intracom`) côté
backend (10/08, chantier déclaration CA3). Ce fichier référence encore
l'ancien nom — à corriger avant toute chose, sinon tout endroit qui s'y
fie silencieusement perdra ces montants (ils ne seront plus jamais
produits sous l'ancien nom).

## 2. Nouvel onglet "Déclaration"

Un onglet séparé (pas intégré au panneau de calcul existant), dans
lequel viendra plus tard la possibilité de déclarer réellement — pour
l'instant, uniquement l'affichage des montants à reporter dans la CA3.

**Route** : `GET /calculs/:calculId/declaration`. Réponse :

```json
{
  "ligne01CollecteTotal": 1200,
  "ligne02ParTaux": { "taux20": 1000, "taux10": 200, "taux5_5": 0, "taux2_1": 0 },
  "ligne04DueIntracom": 50,
  "autresOperationsImposablesBtp": 30,
  "ligne08DeductibleAbs": 680,
  "ligne09DeductibleImmo": 100,
  "solde": { "sens": "a_decaisser", "montant": 500 },
  "disponible": {
    "ligne03BaseHt": false,
    "ligne05Export": false,
    "ligne06IntracomExonere": false,
    "ligne10CreditAnterieur": false
  }
}
```

**Affichage attendu** — une ligne par montant, avec le numéro de ligne
CA3 correspondant affiché clairement (ligne 1, ligne 2 par taux, ligne
4, ligne 8, ligne 9, solde). `autresOperationsImposablesBtp` n'a pas de
numéro de ligne officiel isolé — libellé-le simplement "Autres
opérations imposables (sous-traitance BTP)".

**Important** : pour chaque clé de `disponible` à `false`, afficher un
texte du type "Pas encore disponible" à la place d'un montant — jamais
un 0€, qui laisserait penser à tort que la ligne est vide plutôt que
non calculée. Prévoir la place pour ces lignes dans la mise en page dès
maintenant, même si elles restent vides pour l'instant — d'autres
lignes viendront progressivement dans de prochains briefs.

## Vérification
Comme toujours : dev server, actions réelles. Ouvrir l'onglet sur un
calcul réel ayant de la collecte à plusieurs taux et de
l'autoliquidation (BTP et/ou intracom), vérifier que chaque montant
affiché correspond bien à ce qu'on voit dans le panneau de calcul
existant. Vérifier que les lignes non disponibles affichent bien le
texte prévu, pas un montant.
