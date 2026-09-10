# Brief frontend v72 — catégorie manquante côté interface : livraisons intracommunautaires exonérées

## Contexte
Le backend reconnaît depuis hier `comptes_vente_intracom_exoneree`
comme catégorie à part entière (alimente la ligne 7 de la CA3 et le
contrôle de cohérence TVA sur livraison intracom) — mais elle n'a
jamais été ajoutée comme option sélectionnable dans l'interface. Même
type d'oubli que les 3 catégories manquantes corrigées au v62
(entretien véhicule, location véhicule, vente export), sauf que
celle-ci n'existait pas encore côté backend à ce moment-là.

## Ce qu'il faut faire
Ajouter `comptes_vente_intracom_exoneree` comme option dans le popup
de catégorisation (à côté des catégories déjà présentes : vente
service, charge service, équipement, carburant, cadeaux,
immobilisation, entretien véhicule, location véhicule, vente export).
Libellé suggéré : "Livraison intracommunautaire exonérée" ou
équivalent clair pour un public comptable.

Si `CLES_CONVENTIONS_COMPTES` (ou la liste équivalente déjà utilisée
au v62) est bien la source partagée entre le popup de catégorisation
et l'écran "Paramètres dossier", l'ajouter là directement — le
changement se propagera automatiquement aux deux endroits, comme au
v62.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer que l'option
apparaît dans le popup de catégorisation ET dans "Paramètres dossier",
et qu'un compte confirmé sous cette catégorie n'est plus proposé comme
"à catégoriser" ensuite.
