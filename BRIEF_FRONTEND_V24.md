# Brief frontend v24 — champ "nouveau montant" vide, pas pré-rempli

## Contexte
Dans le formulaire d'ajustement (v23), le champ "nouveau montant" est
actuellement pré-rempli avec le montant calculé actuel. Ce n'était pas la
demande — Rami veut que le collaborateur saisisse le montant lui-même,
sans valeur de départ suggérée.

## Changement demandé
Le champ "nouveau montant" doit démarrer **vide**, sans valeur pré-remplie
et sans placeholder affichant l'ancien montant — pour la TVA collectée
comme pour la TVA déductible.

Le reste du formulaire ne change pas : `montantOriginal` envoyé au backend
reste bien le montant calculé d'origine (donnée interne, pas ce qui
s'affiche dans le champ), la justification reste obligatoire.

## Vérification
Comme toujours : dev server, actions réelles. Ouvrir le formulaire
d'ajustement sur les deux totaux, vérifier que le champ est bien vide au
départ.
