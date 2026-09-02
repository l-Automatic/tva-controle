# Brief frontend v33 — retirer `ligne_tiers_introuvable` du filtre d'anomalies

## Contexte
`ligne_tiers_introuvable` a été retiré du backend il y a plusieurs
sessions déjà — vérifié à l'instant, aucune trace nulle part dans le
dépôt backend. Rami le voit encore apparaître dans le menu déroulant de
filtrage des anomalies (onglet Historique) — un résidu purement frontend,
probablement une liste de types d'anomalies codée en dur quelque part,
jamais mise à jour au moment du retrait.

## Ce qu'il faut faire
Chercher où cette liste de types (utilisée pour peupler le menu déroulant
de filtrage) est définie côté frontend, et retirer `ligne_tiers_introuvable`
de cette liste.

Pendant que tu y es : vérifie s'il existe d'autres résidus du même genre
pour `nature_operation_indeterminee`, retirée dans ce même échange plus
tôt aujourd'hui — même cause probable, même correction si elle traîne
aussi dans cette liste.

## Vérification
Comme toujours : dev server. Ouvrir le menu déroulant de filtrage des
anomalies dans Historique, confirmer que ni `ligne_tiers_introuvable` ni
`nature_operation_indeterminee` n'y apparaissent plus.
