# Brief frontend v72 — option manquante dans le popup de catégorisation

## Contexte
Le backend reconnaît depuis hier la catégorie
`comptes_vente_intracom_exoneree` (ligne 7 de la CA3, livraisons
intracommunautaires exonérées) — un compte confirmé dans cette
catégorie n'est plus redemandé indéfiniment. Mais l'option n'a jamais
été ajoutée au popup de catégorisation lui-même : impossible de
choisir cette catégorie à l'écran actuellement.

## Ce qu'il faut faire
Ajouter "Ventes intracom exonérées" (ou libellé équivalent, cohérent
avec le style des 9 catégories déjà affichées) comme option
sélectionnable dans le popup de catégorisation, sur le même modèle
exact que "Ventes export" — même emplacement dans la liste, même
comportement une fois confirmée.

Vérifier aussi si le même écran des paramètres dossier (celui corrigé
au v62 pour lister les 9 catégories) doit être mis à jour pour en
lister 10 désormais.

Point de conception confirmé avec Rami, pour information : un compte
export ou intracom exonéré n'a jamais besoin d'être aussi confirmé
"vente service" — ces ventes n'ont par nature aucune TVA collectée,
donc la question exigibilité (service vs bien) ne se pose jamais pour
elles. L'exclusivité actuelle entre catégories reste donc correcte,
rien à changer sur ce point.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer qu'un compte
peut être catégorisé "Ventes intracom exonérées" depuis le popup, et
qu'il n'est plus proposé à nouveau ensuite.
