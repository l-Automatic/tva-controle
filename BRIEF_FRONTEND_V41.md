# Brief frontend v41 — immobilisation_potentielle_non_passee : qualification + vérifier à nouveau

Même schéma que `avoir_a_verifier` (v37) et `immobilisation_vehicule_
tourisme_a_verifier` (v40) — deux boutons de qualification, plus un
bouton "Vérifier à nouveau" qui ajuste le calcul brouillon si la
correction a eu lieu.

## Qualification structurée — remplace Résoudre/Justifier pour ce type
Deux boutons :
- **"C'est bien une immobilisation"** → `POST /anomalies/:id/qualifier-immobilisation`
  avec `{utilisateurId, type: 'confirme_immo'}`. Ne touche jamais le
  calcul directement — signale qu'une reclassification externe (dans
  Pennylane) est attendue.
- **"Ce n'est pas une immobilisation"** → même route avec
  `{type: 'ignore'}`. L'achat reste correctement en charge, rien à faire.

## Bouton "Vérifier à nouveau"
`POST /dossiers/:dossierId/verifier-immobilisation` avec
`{periodeDebut, periodeFin, utilisateurId}`. Réponse :
`{anomaliesOuvertes: number, corrections: number}`.

Particularité par rapport aux deux précédents mécanismes de ce genre :
ici, une correction ne change jamais le montant total de TVA déductible
— elle **transfère** un montant entre deux catégories de la déclaration
(TVA déductible sur charges → TVA déductible sur immobilisations). Le
panneau de calcul doit donc afficher les deux lignes séparément si ce
n'est pas déjà le cas, pour que ce transfert soit visible après un
"Vérifier à nouveau" réussi (sinon le collaborateur ne verrait qu'un
total inchangé, sans comprendre qu'une correction a bien eu lieu).

## Vérification
Comme toujours : dev server, actions réelles. Provoquer une vraie
anomalie (achat de petit équipement au-dessus du seuil), qualifier avec
les deux boutons séparément. Pour "confirme_immo" : cliquer "Vérifier à
nouveau" avant correction (reste ouverte), reclasser réellement
l'écriture côté Pennylane (44566→44562), cliquer à nouveau, vérifier que
les deux lignes du panneau de calcul (charges/immobilisations) bougent
en sens inverse du même montant, total inchangé.
