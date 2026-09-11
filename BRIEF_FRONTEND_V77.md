# Brief frontend v77 — incohérence visuelle sur le champ "Téléphone du contact"

## Demande de Rami
Dans Configuration du dossier → Identité, le champ "Téléphone du
contact" n'a pas le même style que les autres champs du formulaire
(voir capture jointe par Rami — le champ apparaît avec une bordure
différente des autres, plus sombre/épaisse, alors que tous les autres
champs du même formulaire — SIRET, forme juridique, fiscalité,
comptabilité, numéro de TVA intracommunautaire, email, nom du
contact — ont un style cohérent entre eux).

## Ce qu'il faut faire
Trouver le champ concerné (probablement un `<input type="tel">` ou
équivalent) et corriger son style pour qu'il soit visuellement
identique aux autres champs du même formulaire (même bordure, même
couleur, même arrondi, même padding).

## Vérification
Comme toujours : dev server, actions réelles. Confirmer visuellement
que le champ téléphone est maintenant cohérent avec les autres champs
du formulaire d'identité.
