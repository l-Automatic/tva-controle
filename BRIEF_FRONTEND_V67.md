# Brief frontend v67 — message de chargement visible sur l'onglet rapprochements

## Contexte
Mystère résolu (v65/v66) : l'onglet rapprochements paiement achat
n'affichait qu'une partie des candidats parce que la catégorisation
des comptes de charge concernés n'était pas encore terminée au moment
du test — pas un bug. Une fois tous les comptes de charge catégorisés,
tous les rapprochements apparaissent correctement. Même mise en
évidence demandée que pour la sous-catégorisation autoliquidation
(v63) : pendant que cet onglet charge, le collaborateur doit
comprendre que le nombre de candidats affichés dépend de l'état actuel
de la catégorisation.

## Ce qu'il faut faire
Même traitement visuel que les autres messages de ce type dans l'app
(classe `.avertissement`, fond ambré, texte en gras) pendant le
chargement de cet onglet — un texte du type "Chargement des
rapprochements en cours..." qui reste visible jusqu'à la fin réelle du
chargement, pas un état "terminé" qui s'affiche avant que tout soit
vraiment chargé.

## Changement backend à prendre en compte
L'exception hôtel spéciale a été retirée du backend
(`identifierFacturesCandidatesAcompte`, signature changée — un
paramètre en moins). Un hôtel payé en plusieurs fois n'apparaît plus
automatiquement dans ce popup : il faut désormais que son compte de
charge soit normalement confirmé dans `comptes_charge_service`, comme
n'importe quel autre fournisseur. Si le frontend avait un traitement
spécial pour "l'hôtel" quelque part (affichage différent, libellé
particulier), vérifier qu'il n'y a plus besoin de le distinguer des
autres candidats.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer visuellement
le message de chargement sur cet onglet. Confirmer qu'un hôtel payé en
deux fois n'apparaît comme candidat qu'une fois son compte de charge
catégorisé normalement, sans traitement spécial.
