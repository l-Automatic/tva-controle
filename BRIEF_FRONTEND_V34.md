# Brief frontend v34 — deux portes obligatoires avant un cycle

Chantier conséquent, deux sujets liés dans ce brief : la catégorisation
bien/service et le rapprochement des paiements achats sont désormais
**deux portes obligatoires** avant qu'un cycle puisse être lancé — jamais
rattrapées après coup, contrairement à d'autres résolutions vues
précédemment (encaissement non affecté).

## Contexte : ce qui a changé côté backend

`POST /dossiers/:dossierId/cycles` refuse désormais (409) dans deux
nouveaux cas, en plus des précédents :
- `{erreur: '...', comptesACategoriser: [...]}` — des comptes produit/
  charge restent à catégoriser.
- `{erreur: '...', facturesARapprocher: [...]}` — des factures de service
  achats restent à rapprocher de leurs paiements.

Les deux portes sont vérifiées dans cet ordre (catégorisation d'abord).
Un cycle ne peut réussir que si aucune des deux ne bloque.

## 1. Écran/onglet Catégorisation (probablement déjà en partie construit)
`GET /dossiers/:dossierId/comptes-a-categoriser?periodeDebut=...&periodeFin=...`
retourne la liste des comptes à catégoriser, sans passer par un cycle —
consultable à tout moment, pas seulement en réaction à un 409. Si un
écran de catégorisation existe déjà (construit plus tôt dans le projet,
déclenché après un cycle), vérifie qu'il fonctionne aussi appelé
directement via cette route, en dehors d'un cycle.

## 2. Nouvel écran/popup — Rapprochement des paiements achats
`GET /dossiers/:dossierId/rapprochements-paiement-achat?periodeDebut=...&periodeFin=...`
retourne, pour chaque facture de service non payée :
```
{
  ledgerEntryId, libelle, montantFactureTotal, date,
  candidats: [
    { ledgerEntryId, libelle, montant, date, precoche: bool, confiance: 'haute'|'moyenne'|'basse'|null }
  ]
}
```

Pour chaque facture : afficher la facture (libellé, montant, date), puis
la liste de ses paiements candidats avec une case à cocher chacun —
**précochée si `precoche: true`**, avec la confiance visible à côté (ex:
un badge "haute"/"moyenne"/"basse"). Si `confiance: null`, aucun
précochage — laisser toutes les cases vides sans message d'erreur
particulier (l'IA n'a pas pu se prononcer, ou n'est pas configurée).

Le collaborateur coche/décoche librement, puis valide — envoie
`POST /dossiers/:dossierId/rapprochements-paiement-achat` avec
`{periode, factureLedgerEntryId, montantFactureTotal, paiementsValides: [{ledgerEntryId, montant}], utilisateurId}`
(uniquement les paiements cochés, `paiementsValides` peut être un tableau
vide si le collaborateur estime qu'aucun candidat ne correspond).

Une fois une facture validée, passer à la suivante de la liste. Une fois
toutes validées, permettre de relancer le cycle.

## 3. Gestion du 409 au lancement d'un cycle
Quand `POST /dossiers/:dossierId/cycles` échoue avec l'un des deux 409
ci-dessus : rediriger vers l'écran correspondant (catégorisation ou
rapprochement) plutôt que d'afficher juste un message d'erreur brut —
idéalement en pré-remplissant directement avec les données déjà
renvoyées dans la réponse d'erreur (`comptesACategoriser` ou
`facturesARapprocher`), sans un second appel réseau immédiat.

## Vérification
Comme toujours : dev server, actions réelles. Provoquer les deux 409 (un
compte non catégorisé, une facture de service non rapprochée), vérifier
la redirection vers le bon écran. Résoudre les deux, relancer le cycle,
vérifier qu'il aboutit. Dans le popup de rapprochement, vérifier le
précochage visible avec sa confiance, cocher/décocher, valider, vérifier
que la facture disparaît de la liste au chargement suivant.
