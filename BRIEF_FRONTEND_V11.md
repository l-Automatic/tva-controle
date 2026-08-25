# Brief frontend v11 — badge "plan comptable" distinct de la confiance IA

## Contexte
`suggestionIA` porte maintenant un champ `source: 'ia' | 'plan_comptable'`.
Une suggestion `source: 'plan_comptable'` vient d'une table de référence
déterministe (aucun appel réseau, jamais d'erreur possible sur ces cas) —
elle ne doit pas être présentée avec un badge de confiance
haute/moyenne/basse comme une suggestion IA, ce concept n'a pas de sens
pour une correspondance certaine.

## Changement demandé
Dans le popup de catégorisation, quand `suggestionIA.source ===
'plan_comptable'` :
- Remplacer le badge de confiance (haute/moyenne/basse) par un badge
  distinct — texte "Déterminé par le plan comptable" ou équivalent court,
  icône différente de celle utilisée pour l'IA (éviter tout ce qui évoque
  une estimation : pas d'ampoule/probabilité, plutôt une coche ou un livre).
- Le reste du comportement ne change pas : présélection dans le select,
  toujours un clic explicite sur "Ajouter" requis, jamais de validation
  automatique.
- Quand `source` est absent ou vaut `'ia'` : comportement actuel inchangé
  (badge de confiance haute/moyenne/basse).

## Vérification
Comme toujours : dev server, actions réelles. Un compte comme 601 ou 604
doit apparaître avec la présélection ET le nouveau badge, sans qu'aucun
appel réseau vers Mistral n'ait eu lieu pour ce compte précis (visible
dans les logs si besoin).
