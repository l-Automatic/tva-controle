# Brief frontend v47 — cadeau_client_seuil_depasse

## Contexte
Nouveau type d'anomalie, bloquant. Se déclenche sur une transaction
individuelle (pas un cumul annuel) qui dépasse le seuil légal de 73€
TTC avec de la TVA réellement déduite dessus.

## Ce qu'il faut faire
1. Ajouter `cadeau_client_seuil_depasse` au menu déroulant de filtrage
   (Cycle et Historique), comme les précédents.
2. Bouton "Vérifier à nouveau" — un seul bouton, pas de qualification
   préalable (erreur certaine, montant réel dépassé + TVA réellement
   déduite). `POST /dossiers/:dossierId/verifier-cadeau-client` avec
   `{periodeDebut, periodeFin}`. Réponse : `{anomaliesOuvertes: number}`.
   Aucun ajustement du calcul.

## Vérification
Comme toujours : dev server, actions réelles. Provoquer une vraie
anomalie (achat classé "cadeaux clients", au-delà de 73€ TTC, avec TVA
déduite), vérifier qu'elle apparaît bien dans le filtre, tester le
bouton "Vérifier à nouveau" avant et après correction réelle côté
Pennylane.
