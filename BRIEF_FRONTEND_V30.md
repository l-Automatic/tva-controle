# Brief frontend v30 — compte_tva_non_reconnu : lien + vérification légère

## Contexte
Backend prêt : `POST /dossiers/:dossierId/verifier-comptes-non-reconnus`
(body `{periodeDebut, periodeFin}`) recalcule uniquement cette anomalie
précise, sans repasser par un cycle complet — pas de lettrage, pas d'IA,
pas les 19 autres contrôles. Réponse : `{anomalies: <nombre>}`.

## 1. Clic sur l'anomalie → redirige vers Conventions génériques
Pour une anomalie de type `compte_tva_non_reconnu` : rendre la carte
cliquable (ou ajouter un bouton dédié), qui amène directement à l'onglet
Conventions génériques de Configuration du dossier — c'est là que le
compte en question sera à confirmer comme compte d'autoliquidation, le cas
le plus fréquent en pratique pour cette anomalie.

## 2. Bouton "Vérifier à nouveau"
Sur cette même anomalie (ou sur le panneau des anomalies bloquantes en
général, si plusieurs sont de ce type) : un bouton "Vérifier à nouveau",
distinct du cycle complet. Demande la période concernée (probablement déjà
connue du contexte), appelle la route ci-dessus. Si `anomalies: 0`,
l'anomalie doit disparaître de la liste au prochain chargement — pas
besoin de mécanisme spécial, la persistance côté backend s'en charge déjà
(elle est marquée obsolète en base).

## Vérification
Comme toujours : dev server, actions réelles. Provoquer une anomalie
`compte_tva_non_reconnu` réelle, cliquer dessus et vérifier la
redirection, confirmer la convention correspondante, cliquer "Vérifier à
nouveau" et vérifier que l'anomalie disparaît sans avoir besoin de
relancer un cycle complet.
