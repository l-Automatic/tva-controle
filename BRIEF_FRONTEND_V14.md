# Brief frontend v14 — anomalies manquantes au premier affichage

## Symptôme rapporté par Rami
Après un cycle, certaines anomalies n'apparaissent pas immédiatement dans
le résultat affiché — il faut cliquer sur le bouton de rafraîchissement
pour les voir apparaître. Constaté précisément avec les nouvelles
anomalies `trou_numerotation_facture` et `doublon_numerotation_facture`.

## Ce qui a été vérifié côté backend (pas la cause, à exclure)
- `POST /dossiers/:id/cycles` attend bien la fin complète du calcul
  (`await executerCycleTva`) avant d'envoyer sa réponse.
- La persistance des anomalies (`enregistrerAnomalies`) est awaited avant
  que la réponse ne parte.
- Le filtre anti-doublon (anomalies déjà traitées) clé sur `type:ledgerEntryId`
  ensemble, pas sur l'id seul — pas de collision évidente entre un nouveau
  type d'anomalie et une ancienne déjà résolue sur la même pièce.
- La réponse de `POST /dossiers/:id/cycles` contient bien la liste complète
  et finale dans son champ `anomalies` — rien n'est envoyé en deux temps
  côté backend.

## À investiguer côté frontend
Le symptôme (anomalies absentes au premier rendu, présentes après un
rafraîchissement manuel) pointe vers un problème d'affichage/état React,
pas vers une réponse API incomplète (déjà vérifié ci-dessus). Pistes à
vérifier en conditions réelles, avec un vrai cycle Playwright reproduisant
exactement ce scénario (lancer un cycle avec des trous/doublons de
numérotation présents, observer le premier rendu avant tout refresh) :
- Le bouton "rafraîchir" appelle-t-il une route différente de celle du
  cycle initial (ex: un `GET /historique` séparé) ? Si oui, comparer les
  deux réponses brutes pour voir si le cycle initial renvoie vraiment tout.
- Y a-t-il un état React qui ne se met à jour qu'au prochain fetch (ex: une
  liste mémorisée avant que toutes les anomalies du cycle en cours soient
  connues) ?
- Les nouveaux types d'anomalies (`trou_numerotation_facture`,
  `doublon_numerotation_facture`) ont-ils un traitement particulier
  quelque part qui pourrait les retarder ou les filtrer au premier rendu ?

## Vérification
Reproduire le symptôme exact avant de corriger — confirmer par un test
réel (pas supposé) que le premier rendu manque bien ces anomalies alors
que la réponse API les contient déjà, ou l'inverse (réponse API
elle-même incomplète au premier appel, ce qui contredirait ce qui est
noté ci-dessus et mériterait d'être signalé). Une fois la vraie cause
identifiée, corriger et vérifier que les anomalies apparaissent bien dès
le premier affichage, sans rafraîchissement nécessaire.
