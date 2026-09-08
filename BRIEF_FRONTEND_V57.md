# Brief frontend v57 — tri alphabétique des tiers

## Contexte
Dans l'onglet "Confiance des tiers" (sous-onglets Clients/Fournisseurs,
v56), les comptes sont actuellement dans l'ordre renvoyé par l'API
(nombre de contrôles sans anomalie, décroissant). Rami veut un tri
alphabétique à la place, pour les deux sous-onglets.

## Ce qu'il faut faire
Trier la liste **côté frontend**, par ordre alphabétique du nom du
tiers (`nomTiers`) — pas besoin de toucher au backend, la liste
complète est déjà renvoyée en un seul appel par
`GET /dossiers/:dossierId/tiers`. Pour un tiers sans `nomTiers` renseigné
(peut être `null`), utiliser `numeroCompteTiers` comme repli pour le tri.

## Vérification
Comme toujours : dev server, actions réelles. Vérifier l'ordre
alphabétique dans les deux sous-onglets sur un dossier ayant plusieurs
tiers.
