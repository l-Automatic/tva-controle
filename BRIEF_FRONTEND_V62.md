# Brief frontend v62 — deux sujets

## 1. La sous-catégorisation autoliquidation apparaît trop tard, sans indication de chargement

Le correctif du v61 (appel ciblé après confirmation d'un compte
`comptes_charge_service`) fonctionne, mais le délai réseau fait que
l'utilisateur voit d'abord "tous les comptes sont traités" avant que la
nouvelle suggestion n'apparaisse — rien ne l'incite à attendre, il
risque de fermer l'onglet en pensant avoir terminé.

**Ce qu'il faut** : afficher un état de chargement explicite pendant
cet appel ciblé (ex: "Vérification des sous-catégories..."), pas un
état "terminé" prématuré qui se corrige ensuite silencieusement.
L'utilisateur doit voir qu'une vérification est en cours, pas qu'elle
est déjà finie.

## 2. Paramètres dossier — catégories manquantes à l'affichage

L'écran des paramètres dossier n'affiche que 6 catégories de
convention, alors qu'il y en a bien plus aujourd'hui. Liste complète
attendue (celles qui passent par le popup de catégorisation) :

- `comptes_vente_service`
- `comptes_charge_service`
- `comptes_equipement`
- `comptes_carburant`
- `comptes_cadeaux`
- `comptes_immobilisation`
- `comptes_entretien_vehicule`
- `comptes_location_vehicule`
- `comptes_vente_export`

Merci de vérifier laquelle des 6 déjà affichées manque à cette liste,
et d'ajouter les catégories manquantes à l'écran existant — même
présentation que les 6 déjà là.

## Vérification
Comme toujours : dev server, actions réelles. Pour le point 1,
confirmer qu'un état de chargement visible apparaît bien pendant la
vérification ciblée. Pour le point 2, confirmer que les 9 catégories
listées ci-dessus apparaissent toutes dans l'écran des paramètres
dossier.
