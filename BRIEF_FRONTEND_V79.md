# Brief frontend v79 — refonte visuelle des cartes d'anomalies

## Portée
Uniquement esthétique et disposition — le contenu du champ "compte"
n'est volontairement pas touché ici (audit backend séparé, mis de
côté pour l'instant sur demande de Rami). Continue d'afficher tel
quel, dans un bloc comme les autres infos secondaires.

## 1. Les deux pastilles (statut "Ouverte" + gravité "Signalé"/"Bloquant")
Garder telles quelles dans leur principe, mais changer leur police
pour utiliser la même police que celle déjà utilisée ailleurs dans
l'app pour les indicateurs de confiance IA (haute/moyenne/basse) —
trouver ce style existant et le réutiliser ici, pour la cohérence.

## 2. Ombre pulsée pour les anomalies bloquantes
Sur les anomalies de gravité "bloquant" (rouge) : ajouter un effet
d'ombre qui pulse doucement autour de la carte — une animation CSS en
boucle qui fait varier l'intensité/la taille de l'ombre rouge de façon
continue (respiration douce, pas un clignotement agressif). Rami a un
exemple visuel qu'il n'a pas pu partager directement (vidéo) — utiliser
le meilleur jugement pour une animation `box-shadow` en boucle,
discrète mais perceptible, cohérente avec le reste de l'esthétique de
l'app.

## 3. Retirer la référence de pièce
Le texte "(pièce XXXXXXXX)" actuellement affiché ne sert à rien —
à retirer de l'affichage.

## 4. Garder tels quels
- La phrase d'explication (description de l'anomalie) — inchangée.
- Le libellé de l'écriture, quand il est affiché — inchangé.

## 5. Toutes les autres infos dans des blocs
Toute information affichée en dehors des deux pastilles, de la phrase
d'explication et du libellé (compte, montant, confiance IA,
justification, etc. — tout ce qui existe actuellement comme détail)
doit être présentée dans un bloc visuel dédié par info : un titre
court (le nom/type de l'info) en haut du bloc, son contenu juste
en-dessous. Un bloc par information, pas un mélange de plusieurs infos
dans un seul bloc.

## 6. Contour coloré à la place de la bande latérale
Remplacer la petite bande de couleur sur le côté gauche de la carte
d'anomalie par un contour (stroke) complet tout autour de la carte,
dans la couleur correspondant à la gravité (rouge pour bloquant, jaune
pour signalé, etc. — cohérent avec les couleurs déjà utilisées
ailleurs dans l'app pour ces gravités).

Pour une anomalie bloquante (rouge) : combiner ce contour avec
l'ombre pulsée du point 2, de la même couleur — un ensemble visuel
cohérent, pas deux effets qui se contredisent.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer visuellement
chaque point sur au moins une anomalie de chaque gravité (bloquant,
signalé) — police des pastilles, contour coloré, ombre pulsée sur le
bloquant uniquement, blocs bien séparés pour chaque info secondaire,
pièce disparue, explication et libellé inchangés.
