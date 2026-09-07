# Brief frontend v48 — frais véhicule de tourisme (chantier complet)

Trois sujets liés, à traiter ensemble.

## 1. Deux nouvelles catégories dans le popup de catégorisation

`comptesEntretienVehicule` et `comptesLocationVehicule`, mêmes principes
exactement que `comptesCadeaux`/`comptesImmobilisation` déjà présentes.
Écriture via la route générique déjà existante
`POST /dossiers/:dossierId/conventions`, clés `comptes_entretien_vehicule`
et `comptes_location_vehicule`.

## 2. Deux nouveaux types d'anomalies

`entretien_vehicule_tourisme_deduit_a_tort` et
`location_vehicule_tourisme_deduite_a_tort` — à ajouter au menu déroulant
de filtrage (Cycle et Historique). Particularité : la gravité varie par
instance, pas par type — une même anomalie peut apparaître bloquante ou
signalée selon qu'un véhicule est identifié dans le libellé ou non.

**Qualification** — deux boutons ("Confirmer" / "Ignorer"), même
principe exactement que `tva_hotel_a_verifier` :
`POST /anomalies/:id/qualifier-frais-vehicule` avec
`{utilisateurId, typeAnomalie, type: 'confirme'|'ignore'}` — le champ
`typeAnomalie` doit valoir exactement le type de l'anomalie qualifiée
(`entretien_vehicule_tourisme_deduit_a_tort` ou
`location_vehicule_tourisme_deduite_a_tort`).

**"Vérifier à nouveau"** — un seul bouton, couvre les deux types en un
seul appel : `POST /dossiers/:dossierId/verifier-frais-vehicule` avec
`{periodeDebut, periodeFin, utilisateurId}`. Réponse :
`{anomaliesOuvertes: number, corrections: number}`.

## 3. Message dans l'onglet parc de véhicules

Un simple rappel statique, toujours affiché (pas de condition
dynamique à calculer) : *"Pensez à ajouter aussi les véhicules en
location/crédit-bail à ce parc, et à les retirer une fois le contrat
terminé."*

## Vérification
Comme toujours : dev server, actions réelles. Provoquer les deux
anomalies réellement (flotte 100% tourisme, compte entretien ou
location confirmé, TVA déduite) — une avec un libellé mentionnant un
véhicule (doit apparaître bloquante), une sans (doit apparaître
signalée). Qualifier chacune avec les deux boutons séparément, tester
"Vérifier à nouveau" avant et après correction réelle côté Pennylane.
Vérifier que le message apparaît bien dans l'onglet parc de véhicules.
