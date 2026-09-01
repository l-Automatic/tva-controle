# Brief frontend v31 — le calcul se produit toujours + refonte du panneau

Changement de fond, deux sujets liés dans ce brief.

## Contexte : ce qui a changé côté backend
Jusqu'ici, une anomalie bloquante empêchait toute production de calcul —
rien ne s'affichait tant qu'elle n'était pas résolue. Ce n'est plus le
cas : **le calcul se produit désormais toujours**, dès le premier cycle,
même incomplet. Le blocage a été déplacé à la validation.

- `POST /dossiers/:dossierId/cycles` ne renvoie plus jamais
  `{statut: 'bloque', ...}` — uniquement `{statut: 'calcule', ...}`, avec
  un nouveau champ `anomaliesBloquantesOuvertes: <nombre>`. 0 = calcul
  complet et validable. > 0 = calcul produit mais incomplet sur au moins
  un point, tant que ces anomalies restent ouvertes.
- `GET /dossiers/:dossierId/calculs` (`listerCalculs`) inclut désormais ce
  même champ `anomaliesBloquantesOuvertes` sur chaque calcul — recalculé
  en direct à chaque appel, pas figé au moment du cycle qui a produit ce
  brouillon. Résoudre une anomalie fait donc baisser ce nombre au prochain
  chargement, sans avoir besoin de relancer un cycle.
- `POST /calculs/:id/valider` refuse désormais avec un 409 si
  `anomaliesBloquantesOuvertes > 0` — réponse
  `{erreur: '...', nombreAnomaliesBloquantes: <nombre>}`.

## 1. Retirer l'ancien écran "Cycle bloqué"
L'écran plein qui empêchait tout affichage ("Cycle bloqué — N
anomalie(s)...") n'a plus lieu d'être — le calcul est maintenant toujours
là. Le remplacer par l'affichage normal du calcul, avec les points 2 et 3
ci-dessous en plus.

## 2. Message clair sur un calcul incomplet
Quand `anomaliesBloquantesOuvertes > 0` sur un calcul affiché : un message
visible à côté du montant, du type "Ce calcul n'est pas définitif — N
anomalie(s) critique(s) à résoudre avant validation." Pas alarmiste au
point de cacher le chiffre, mais clairement visible.

## 3. Bouton "Valider" grisé tant que des anomalies bloquantes restent ouvertes
Désactivé (grisé, pas juste visuellement — vraiment non cliquable) tant
que `anomaliesBloquantesOuvertes > 0` pour ce calcul. Redevient actif dès
que ce nombre repasse à 0 (au prochain chargement de la liste des
calculs — pas besoin d'un mécanisme temps réel, juste refléter l'état à
jour à chaque affichage).

## 4. Refonte du panneau de calcul (demande de Rami, indépendante du changement ci-dessus)
- Positionner le panneau de calcul en colonne latérale, à droite du menu
  principal (`sticky`, reste visible pendant le défilement de la page),
  avec un espace clair entre le menu et ce panneau.
- Le montant final (TVA à payer, ou crédit de TVA) affiché en plus grand
  et en gras — c'est l'information la plus importante de l'écran, elle
  doit se voir immédiatement.
- Intérêt direct de le rendre sticky : voir la résolution d'une anomalie
  mettre à jour ce montant sans avoir à faire défiler la page pour le
  retrouver.

## Vérification
Comme toujours : dev server, actions réelles. Provoquer une vraie
anomalie bloquante, lancer un cycle, vérifier qu'un calcul s'affiche quand
même avec le message et le bouton grisé. Résoudre l'anomalie, recharger,
vérifier que le message disparaît et que "Valider" redevient cliquable.
Vérifier visuellement le nouveau positionnement sticky et la mise en
avant du montant final.
