# Brief frontend v51 — lignes 6/7 (export, intracom exonéré)

## 1. Nouvelle catégorie optionnelle dans le popup de catégorisation

`comptesVenteExport` — même principe que `comptesCadeaux`, mais
**jamais bloquante** (contrairement aux catégories obligatoires comme
entretien/location véhicule) : n'affecte que l'affichage déclaratif,
jamais le calcul de TVA. Peut rester non confirmée indéfiniment sans
bloquer aucun cycle. Écriture via la route générique déjà existante
`POST /dossiers/:dossierId/conventions`, clé `comptes_vente_export`.

## 2. Correction de nommage — `ligne05Export` devient `ligne06Export`

Erreur de ma part dans le brief v49 : l'export est bien la ligne 6 de
la CA3, pas la ligne 5. Si un affichage a déjà été fait sur cette base,
corriger le nom du champ.

## 3. Nouvelle forme de la réponse

`GET /calculs/:calculId/declaration` — `disponible` n'a plus qu'une
seule clé désormais (`ligne10CreditAnterieur`) :

```json
{
  "ligne01CollecteTotal": 1200,
  "ligne02ParTaux": { "taux20": 1000, "taux10": 200, "taux5_5": 0, "taux2_1": 0 },
  "ligne03BaseHt": { "total": 7000, "parTaux": { "taux20": 5000, "taux10": 2000, "taux5_5": 0, "taux2_1": 0 } },
  "ligne04DueIntracom": 50,
  "autresOperationsImposablesBtp": 30,
  "ligne06Export": 800,
  "ligne07IntracomExoneree": 400,
  "ligne08DeductibleAbs": 680,
  "ligne09DeductibleImmo": 100,
  "solde": { "sens": "a_decaisser", "montant": 500 },
  "disponible": { "ligne10CreditAnterieur": false }
}
```

Afficher les lignes 6 et 7 après la ligne 4, avant la ligne 8 — même
présentation simple qu'un montant unique (pas de détail par taux pour
celles-ci, ce sont des opérations non imposables).

## Vérification
Comme toujours : dev server, actions réelles. Confirmer un compte
export et un compte intracom exonéré sur un dossier de test, provoquer
une vraie vente sur chacun, vérifier que les lignes 6 et 7 remontent
avec le bon montant HT dans l'onglet Déclaration. Vérifier qu'il ne
reste plus qu'une seule ligne "Pas encore disponible" (la 10).
