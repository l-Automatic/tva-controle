# Brief frontend v52 — arrondi à l'euro (onglet Déclaration)

## Contexte
Tous les montants renvoyés par `GET /calculs/:calculId/declaration`
sont désormais des **entiers** (arrondis à l'euro le plus proche) —
plus jamais de décimales sur cette route précisément. Chaque ligne est
arrondie individuellement, puis tout total ou solde est calculé comme
la somme des lignes déjà arrondies (jamais un arrondi séparé du
montant brut) — cohérence garantie entre le détail et le total affichés.

## Ce qu'il faut faire côté affichage
Adapter le formatage des montants dans l'onglet Déclaration pour ne
plus afficher de décimales (ex: "1 202 €" plutôt que "1 202,00 €") —
uniquement sur cet onglet, le reste du produit (panneau de calcul,
etc.) n'est pas concerné par ce changement.

## Vérification
Comme toujours : dev server, actions réelles. Ouvrir l'onglet sur un
calcul réel, vérifier qu'aucun montant n'affiche de décimales, et que
la ligne 1 correspond bien exactement à la somme de ce qui est affiché
en ligne 2 (même chose pour la ligne 3, et pour le solde par rapport
aux lignes qui le composent).
