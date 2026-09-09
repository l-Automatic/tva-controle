# Brief frontend v69 — cause racine identifiée : aucun rafraîchissement global après confirmation

## Ce qui a été établi avec certitude, cette fois par élimination et par l'observation de Rami

Le popup calcule les 4 portes **une seule fois**, à l'ouverture, via
l'agrégateur. Scénario reproduit par Rami : dossier remis à zéro,
popup ouvert (à ce moment, 0 compte catégorisé → 0 rapprochement
candidat, correctement calculé et affiché comme "tout est fait" par le
backend), puis catégorisation faite **dans le même popup**. Résultat :
- Le badge "Catégorisation" reste bloqué sur son décompte initial (17)
  au lieu de refléter le travail fait.
- Le badge "Comptes TVA à confirmer" reste bloqué sur 2.
- L'onglet rapprochements affiche toujours "Toutes les factures ont
  été rapprochées" — la réponse **initiale**, jamais recalculée.

Confirmé que ce n'est PAS une résolution automatique en base
(`rapprochements_paiement_achat` reste à 0 ligne dans les deux
tentatives) — c'est bien que rien ne redéclenche jamais un nouveau
chargement de l'agrégateur complet après les actions faites dans le
popup. Les 3 investigations précédentes (v65, v66, v68) n'avaient
jamais trouvé de bug parce qu'elles testaient toutes sur un état
**déjà stable** (catégorisation déjà terminée avant l'ouverture du
popup, ou avant le test) — jamais le scénario réel de Rami, qui
catégorise **pendant** que le popup est ouvert.

## Ce qui est demandé

Après une action qui pourrait affecter l'état des autres onglets — en
particulier la fin de la catégorisation (le signal déjà utilisé au
v64, quand `comptesACategoriser` devient vide) — redéclencher un
rechargement complet de l'agrégateur (`GET
/dossiers/:dossierId/portes-obligatoires`), en remplaçant l'état des 4
onglets ET des badges par la nouvelle réponse. Pas seulement l'onglet
courant : les 4 en même temps, pour que rapprochements/comptes
TVA/parc reflètent la vraie catégorisation à jour.

Point d'attention performance : ce rechargement complet prend environ
35 secondes sur un vrai dossier (déjà optimisé, cf. chantiers
précédents) — à ne déclencher qu'une fois, à la fin d'un lot de
confirmations (même logique de signal de fin de lot que le v64), pas
après chaque confirmation individuelle. Un indicateur de chargement
visible pendant ce rechargement est nécessaire (même style que les
autres messages de ce type dans l'app).

## Vérification
Reproduire exactement le scénario de Rami : dossier remis à zéro,
ouvrir portes obligatoires, catégoriser tous les comptes dans la
foulée (y compris sous-traitance), puis vérifier que les badges
catégorisation et comptes TVA reflètent bien 0, et que l'onglet
rapprochements affiche les vrais candidats — sans fermer/rouvrir le
popup entre les deux.
