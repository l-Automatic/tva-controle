# Brief frontend v43 — encaissement_client_taux_applique : bon taux / mauvais taux

## Contexte
Deux boutons, remplacent Résoudre/Justifier pour ce type précis —
`POST /anomalies/:id/qualifier-encaissement-client-taux`.

- **"C'est le bon taux"** → `{utilisateurId, type: 'bon_taux'}`. Résout
  l'anomalie, ne touche jamais le calcul (le taux appliqué automatiquement
  était déjà correct).
- **"Le taux est faux"** → nécessite un champ pour saisir le bon taux
  (20, 10, 5.5 ou 2.1) — `{utilisateurId, type: 'mauvais_taux', nouveauTaux}`.
  Transfère le montant entre les deux catégories de taux concernées dans
  le calcul brouillon.

Important à afficher clairement au collaborateur : cette correction ne
concerne QUE cette ligne précise — elle ne change jamais le taux habituel
retenu pour ce client dans les cycles futurs (contrairement à l'écran
dédié "taux historique par tiers", qui existe séparément). Si le même
client a un autre encaissement non lettré le mois prochain, l'anomalie se
représentera et devra être qualifiée à nouveau.

## Vérification
Comme toujours : dev server, actions réelles. Qualifier une anomalie
réelle en "bon taux", vérifier qu'elle se résout sans changement au
panneau de calcul. Qualifier une autre en "mauvais taux" avec une valeur
différente, vérifier que les deux catégories de taux concernées bougent
dans le panneau de calcul (l'une diminue, l'autre augmente).
