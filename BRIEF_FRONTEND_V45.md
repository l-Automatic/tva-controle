# Brief frontend v45 — trous et doublons de numérotation

## Contexte
`trou_numerotation_facture` et `doublon_numerotation_facture` sont
désormais consolidées : au plus une anomalie de chaque type par cycle,
listant tous les numéros concernés dans `details` (`manquants: number[]`
pour les trous, `doublons: {numero, ledgerEntryIds}[]` pour les
doublons) — plus une anomalie éclatée par trou ou par numéro dupliqué.

## Ce qu'il faut faire

**"Ignorer"** : rien à construire — le bouton "Résoudre" générique déjà
existant suffit. Contrairement à `nouveau_tiers_a_verifier`, aucune
mémoire spécifique n'est nécessaire ici : chaque cycle redétecte tout
depuis zéro, donc un numéro toujours manquant ou toujours dupliqué le
mois suivant réapparaîtra naturellement dans une nouvelle anomalie, sans
rien à construire de spécial.

**"Vérifier à nouveau"** : nouveau bouton, pour les deux types.
`POST /dossiers/:dossierId/verifier-numerotation` avec
`{periodeDebut, periodeFin}`. Réponse : `{trouOuvert: boolean, doublonOuvert: boolean}`.
Rejoue la détection sur des données fraîches — si des numéros ont été
corrigés depuis, ils disparaissent de la liste (l'anomalie peut donc
rester ouverte avec moins de numéros qu'avant, ou disparaître
complètement si tout est réglé).

## Vérification
Comme toujours : dev server, actions réelles. Provoquer un vrai trou
(ou doublon) de numérotation, vérifier que tous les numéros concernés
apparaissent dans une seule anomalie. Cliquer "Vérifier à nouveau" sans
rien avoir corrigé (reste identique), puis après correction réelle d'un
des numéros côté Pennylane (mais pas tous), vérifier que la liste se met
à jour avec seulement les numéros encore manquants.
