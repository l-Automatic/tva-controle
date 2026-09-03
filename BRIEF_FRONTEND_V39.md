# Brief frontend v39 — type de carburant sur le formulaire véhicule

## Contexte
Prépare le chantier correspondance carburant/véhicule (documenté dans
`REGLES_FISCALES_ET_TACHES.md`, pas encore construit) — commencer à
collecter la donnée dès maintenant plutôt que de devoir la rattraper sur
des véhicules déjà ajoutés sans elle.

`POST /dossiers/:dossierId/vehicules` accepte désormais un champ optionnel
`typeCarburant: 'diesel' | 'essence'` en plus des champs existants.
`GET /dossiers/:dossierId/vehicules` le restitue de la même façon
(`null` si non renseigné — c'est un état normal, pas une erreur).

## Ce qu'il faut faire
Sur `VehiculesPanel.tsx`, ajouter un menu déroulant "Carburant" (Diesel /
Essence, avec une option vide/non renseignée) sur le formulaire d'ajout
d'un véhicule. Optionnel — le formulaire doit rester utilisable sans le
remplir, exactement comme avant.

Si l'écran affiche déjà la liste des véhicules existants, afficher aussi
ce champ pour ceux qui l'ont renseigné (rien à afficher de spécial pour
ceux qui ne l'ont pas).

Rien d'autre à construire à ce stade — pas de logique de correspondance
avec les factures de carburant, juste la collecte du champ lui-même.

## Vérification
Comme toujours : dev server, actions réelles. Ajouter un véhicule avec un
carburant renseigné, vérifier qu'il apparaît bien dans la liste ensuite.
Ajouter un véhicule sans toucher au menu déroulant, vérifier que ça
fonctionne toujours normalement.
