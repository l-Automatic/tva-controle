# Brief frontend v53 — ligne 10 (crédit de TVA antérieur)

## Contexte
La dernière ligne de la CA3 (crédit de TVA antérieur, solde débiteur du
44567 depuis le début de l'exercice) est maintenant disponible.
Nécessite un nouveau paramètre dossier, `date_debut_exercice` — à
saisir quelque part dans les paramètres du dossier (écran à créer ou
existant, selon ce qui est le plus adapté côté frontend). Écriture via
la route générique déjà existante pour les paramètres dossier.

## Nouvelle forme de la réponse

`disponible` a été **entièrement retiré** de la réponse — plus aucune
ligne "en attente" à gérer désormais. À la place, `ligne10CreditAnterieur`
peut valoir soit un nombre, soit `null` :

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
  "ligne10CreditAnterieur": 150,
  "solde": { "sens": "a_decaisser", "montant": 500 }
}
```

**Important, à bien distinguer** :
- `ligne10CreditAnterieur: null` → paramètre `date_debut_exercice` pas
  encore défini pour ce dossier → afficher "Pas encore disponible"
- `ligne10CreditAnterieur: 0` → paramètre défini, mais aucun crédit
  réel à reporter → afficher "0 €", pas "pas encore disponible"

Ne jamais traiter ces deux cas de la même façon — c'est précisément ce
qu'on a corrigé côté backend avant même de pousser le code.

## Vérification
Comme toujours : dev server, actions réelles. D'abord sans le
paramètre défini (vérifier "Pas encore disponible"), puis avec le
paramètre défini sur un dossier ayant un vrai solde débiteur du 44567
à l'ouverture (vérifier le montant réel et son intégration correcte
dans le solde final).
