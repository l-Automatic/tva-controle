# Brief frontend v38 — parc de véhicules obligatoire avant un cycle

## Contexte
Troisième porte obligatoire avant qu'un cycle puisse être lancé, même
principe exactement que la catégorisation et le rapprochement des
paiements — `POST /dossiers/:dossierId/cycles` refuse désormais aussi
(409) si le parc de véhicules du dossier est vide alors qu'au moins une
écriture de la période touche un compte carburant :
```
{ erreur: 'Le parc de véhicules doit être renseigné avant de pouvoir lancer un cycle sur cette période (au moins une écriture touche un compte carburant).' }
```
Pas de payload structuré supplémentaire cette fois (contrairement aux
deux verrous précédents) — juste le message d'erreur.

Les routes de gestion du parc existent déjà et n'ont pas changé :
`GET/POST /dossiers/:dossierId/vehicules`, `POST /vehicules/:id/retirer`.

## Ce qu'il faut faire
Gérer ce nouveau 409 au lancement du cycle comme les deux précédents :
rediriger vers l'écran de gestion du parc (`VehiculesPanel.tsx`, déjà
construit) plutôt que d'afficher juste le message d'erreur brut.

Une fois le parc renseigné une première fois pour un dossier, ce verrou
ne se redéclenche plus pour les cycles suivants (tant qu'il reste au
moins un véhicule renseigné) — rien de spécial à gérer côté état, le
backend revérifie à chaque tentative de cycle.

## Vérification
Comme toujours : dev server, actions réelles. Provoquer le 409 sur un
dossier avec du carburant mais sans véhicule renseigné, vérifier la
redirection vers l'écran du parc. Ajouter un véhicule, relancer le cycle,
vérifier qu'il n'est plus bloqué par ce point.
