# Brief frontend v55 — trois tâches groupées

## 1. Retirer tous les tirets cadratins (—)

Partout dans le texte affiché par l'application (labels, descriptions,
messages, textes d'aide...) — remplacer par une formulation sans tiret
cadratin (virgule, point, reformulation), pas juste un tiret simple à
la place. Vérifier l'ensemble des composants, pas seulement les plus
visibles.

## 2. Choix de la couleur — réservé à l'admin, cabinet-wide

Regarder d'abord l'implémentation actuelle du choix de couleur pour
comprendre où elle vit aujourd'hui (probablement liée au thème visuel
de l'app) : est-ce actuellement une préférence par dossier, par
utilisateur, ou déjà globale ? Adapter en fonction de ce qui existe
réellement plutôt que de repartir de zéro.

Objectif final :
- Seul un `admin_cabinet` doit pouvoir modifier ce choix (masquer le
  contrôle, ou a minima le désactiver, pour un rôle `collaborateur`)
- Le choix retenu s'applique à **tous les dossiers du cabinet**, pas
  un choix par dossier

Si ça nécessite un nouveau paramètre cabinet côté backend (persistant,
pas juste local au navigateur), le mécanisme générique de paramètres
cabinet existe déjà (`PUT /parametres-cabinet`, réservé aux
admin_cabinet — déjà vérifié côté backend) — pas besoin de me
redemander une nouvelle route pour ça.

## 3. Réorganiser l'onglet Paramètres

Actuellement un seul onglet mélangeant tout. Le scinder a minima en
deux sous-onglets : "Paramètres cabinet" et "Paramètres dossier" — même
principe de structure que l'onglet "Configuration dossier" existant
(à reprendre comme modèle de présentation).

## Vérification
Comme toujours : dev server, actions réelles. Confirmer qu'aucun tiret
cadratin ne subsiste dans l'app (recherche large sur les fichiers
frontend). Confirmer avec un compte collaborateur que le contrôle de
couleur est bien masqué/désactivé, et avec un compte admin qu'il
fonctionne et s'applique à plusieurs dossiers du même cabinet. Confirmer
que l'onglet Paramètres est bien scindé et navigable.
