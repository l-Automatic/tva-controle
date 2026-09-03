# Brief frontend v35 — corrections du popup + retire paiement_partiel_calcule des anomalies

Plusieurs corrections liées au popup de rapprochement des paiements
achats, plus un changement de fond sur où afficher le prorata calculé.

## 1. Nouveaux champs sur chaque facture du popup
`GET /dossiers/:dossierId/rapprochements-paiement-achat` retourne
désormais aussi `compteFournisseur` (le numéro de compte) et
`libelleCompteFournisseur` (son nom). À afficher **en premier**, avant le
reste — dans l'ordre : compte fournisseur, libellé du compte, date de la
facture, libellé de l'écriture, montant TTC. Objectif : identifier
immédiatement de quoi il s'agit sans avoir à déduire l'information.

## 2. Le panneau est déjà trié
La réponse arrive maintenant triée par compte fournisseur (alphabétique)
puis par date (chronologique) au sein d'un même compte — rien à faire
côté tri, juste ne pas re-trier autrement à l'affichage.

## 3. Les factures sans aucun candidat ont disparu du panneau
Elles sont désormais résolues automatiquement côté backend (rien à
confirmer, on sait déjà que ce n'est pas déductible) — la liste renvoyée
ne les contient plus du tout. Rien à construire ici, juste vérifier que
l'écran gère bien une liste qui peut être plus courte qu'avant.

## 4. Un paiement choisi disparaît des autres factures au rechargement
Le backend exclut désormais automatiquement, pour toute facture, les
paiements déjà validés pour une autre facture. Concrètement : après
validation d'une facture, recharger la liste (nouvel appel GET) avant
d'afficher la facture suivante, pour que ses candidats reflètent bien
l'exclusion. Si l'écran ne recharge pas déjà systématiquement entre deux
factures, c'est le point à corriger ici.

## 5. Retire complètement `paiement_partiel_calcule` des anomalies
Décision de fond : cette anomalie n'est plus générée du tout côté
backend. Le résultat d'un cycle (`POST /dossiers/:dossierId/cycles`)
inclut désormais un nouveau champ `prorataAppliques`, séparé des
anomalies :
```
prorataAppliques: [
  { ledgerEntryId, compte, compteTiers, prorata, sens: 'collecte'|'deductible' }
]
```

- **`sens: 'collecte'`** (ventes) : c'est ici qu'il faut afficher
  l'information — dans le panneau "Calcul de la période" (le panneau
  sticky), une ligne de détail claire par entrée (le prorata, le montant
  de TVA exigible, le montant exclu — à calculer côté frontend à partir
  du prorata et du montant de la ligne concernée). Jamais dans le panneau
  Anomalies.
- **`sens: 'deductible'`** (achats) : cette même info est présente ici
  par cohérence, mais **déjà visible** dans le popup de rapprochement
  (facture validée avec ses paiements, cf. sections précédentes) — pas la
  peine de la dupliquer ailleurs pour ce sens-là, le popup suffit.

`paiement_partiel_a_verifier` est également retiré — cette anomalie
n'existe plus du tout côté backend depuis un précédent brief. Si des
traces subsistent encore quelque part (menu de filtrage, libellés), les
retirer aussi.

## Vérification
Comme toujours : dev server, actions réelles. Provoquer un paiement
partiel achats réel, vérifier l'affichage complet (compte, libellé, date,
montant) et le tri. Valider une facture, vérifier que ses paiements
n'apparaissent plus pour une autre facture du même compte. Vérifier
qu'aucune anomalie `paiement_partiel_calcule` ni `paiement_partiel_a_verifier`
n'apparaît plus nulle part, et que le champ `prorataAppliques` (sens
`collecte`) s'affiche bien dans le panneau de calcul quand un cycle en
contient.
