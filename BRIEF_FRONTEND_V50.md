# Brief frontend v50 — ligne 3 (base HT par taux)

## Contexte
La ligne 3 de la CA3 (base HT du chiffre d'affaires, total et par taux)
est maintenant disponible — `GET /calculs/:calculId/declaration` renvoie
désormais un nouveau champ `ligne03BaseHt`, et `disponible` n'a plus que
3 clés (`ligne05Export`, `ligne06IntracomExonere`,
`ligne10CreditAnterieur`) — retirer l'affichage "pas encore disponible"
pour la ligne 3 spécifiquement.

## Nouvelle forme de la réponse

```json
{
  "ligne01CollecteTotal": 1200,
  "ligne02ParTaux": { "taux20": 1000, "taux10": 200, "taux5_5": 0, "taux2_1": 0 },
  "ligne03BaseHt": {
    "total": 7000,
    "parTaux": { "taux20": 5000, "taux10": 2000, "taux5_5": 0, "taux2_1": 0 }
  },
  "ligne04DueIntracom": 50,
  "autresOperationsImposablesBtp": 30,
  "ligne08DeductibleAbs": 680,
  "ligne09DeductibleImmo": 100,
  "solde": { "sens": "a_decaisser", "montant": 500 },
  "disponible": {
    "ligne05Export": false,
    "ligne06IntracomExonere": false,
    "ligne10CreditAnterieur": false
  }
}
```

Afficher `ligne03BaseHt.total` et le détail par taux, même
présentation que la ligne 2 (par taux). Placer la ligne 3 juste après
la ligne 2 dans l'ordre d'affichage.

## Vérification
Comme toujours : dev server, actions réelles. Ouvrir l'onglet sur un
calcul réel ayant de la vente à plusieurs taux, vérifier que le total
de la ligne 3 correspond bien à la somme des bases HT que tu peux
recouper manuellement depuis Pennylane pour la même période.
