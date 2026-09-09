# Brief frontend v61 — rapprochements incomplets au premier chargement, ré-actualisation complète à chaque validation

## Contexte
Distinct du bug corrigé au v60 (qui empêchait le démontage des onglets).
Ici, deux symptômes liés, décrits précisément par Rami :

1. **Chargement initial incomplet** — l'onglet "rapprochements paiement
   achat" n'affiche d'abord que l'hôtel. En revenant sur cet onglet après
   être passé sur les autres, un texte "actualisation..." apparaît en bas,
   puis les autres rapprochements finissent par s'afficher.

2. **Chaque validation relance tout** — après avoir validé un
   rapprochement, "actualisation..." réapparaît, tout se recharge, et les
   éléments qui avaient mis du temps à apparaître au point 1 disparaissent
   puis reviennent. Ça se reproduit à chaque validation.

## Hypothèse à vérifier
Ça ressemble à un appel qui re-déclenche **tout l'agrégateur**
(`GET /dossiers/:dossierId/portes-obligatoires`, potentiellement lent —
cf. chantier de performance en cours côté backend) après chaque action,
plutôt qu'une mise à jour ciblée de l'onglet concerné. Merci de vérifier
précisément :
- Quel appel réseau se déclenche après la validation d'un
  rapprochement (`POST .../rapprochements-paiement-achat` seul, ou
  l'agrégateur complet relancé derrière) ?
- Le "chargement initial incomplet" du point 1 vient-il du même
  mécanisme (un rechargement partiel/silencieux de l'agrégateur en
  arrière-plan après le premier affichage) ?

Si c'est bien l'agrégateur complet qui se relance à chaque fois, il faut
que la validation d'un rapprochement ne mette à jour **que** l'état de
cet onglet (retirer l'élément validé de la liste locale, sans re-fetch
global) — les 3 autres onglets ne doivent pas être concernés par cette
action.

## Vérification
Comme toujours : dev server, actions réelles. Reproduire le scénario
exact de Rami (categoriser, confirmer TVA, aller sur rapprochements,
constater l'affichage initial incomplet, revenir dessus, valider un
rapprochement) et confirmer qu'aucun rechargement global ne se déclenche
plus après une validation — seul l'élément validé doit disparaître de
la liste, le reste doit rester stable.
