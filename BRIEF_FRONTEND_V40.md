# Brief frontend v40 — véhicule de tourisme + parité filtre anomalies

Deux sujets sans rapport entre eux dans ce brief.

## 1. `immobilisation_vehicule_tourisme_a_verifier` — refonte complète

Le comportement a changé de fond en comble côté backend : ce n'est plus
un signalement systématique dès qu'un véhicule de tourisme existe dans
le parc, mais un jugement IA ciblé sur les vraies écritures d'achat de
véhicule (compte 2182) avec de la TVA effectivement déduite.

### Qualification structurée — remplace Résoudre/Justifier pour ce type
Deux boutons clairs, comme pour `avoir_a_verifier` :
- **"Confirmer véhicule de tourisme"** → `POST /anomalies/:id/qualifier-vehicule-tourisme`
  avec `{utilisateurId, type: 'confirme_tourisme'}`. Ne touche jamais le
  calcul directement — signale juste qu'une correction externe (dans
  Pennylane) est attendue.
- **"Ce n'est pas un véhicule de tourisme"** → même route avec
  `{type: 'pas_tourisme'}`. Le jugement IA était faux, l'anomalie est
  classée sans suite.

### Bouton "Vérifier à nouveau"
`POST /dossiers/:dossierId/verifier-vehicule-tourisme` avec
`{periodeDebut, periodeFin, utilisateurId}`. Réponse :
`{anomaliesOuvertes: number, corrections: number}`. Même comportement
que pour les avoirs : reste ouverte si la TVA est toujours déduite sur
cette ligne, disparaît et ajuste automatiquement le calcul brouillon si
la correction a été constatée côté Pennylane.

## 2. Le filtre/tri des anomalies manque dans l'onglet Cycle
Le menu déroulant de filtrage par type d'anomalie (et le tri associé)
existe aujourd'hui uniquement dans l'onglet Historique — pas dans
l'onglet Cycle, où les anomalies de la période sont pourtant aussi
affichées. Ajouter le même mécanisme de filtrage/tri à l'onglet Cycle,
en réutilisant le composant ou la logique déjà construite pour
Historique plutôt que d'en faire une nouvelle version.

## Vérification
Comme toujours : dev server, actions réelles. Pour le véhicule de
tourisme : provoquer une vraie anomalie (achat 2182 avec TVA déduite et
libellé de voiture de tourisme), qualifier avec les deux boutons
séparément (un test par bouton), puis tester "Vérifier à nouveau" avant
et après une correction réelle. Pour le filtre : vérifier qu'il est
maintenant présent et fonctionnel dans l'onglet Cycle, avec le même
comportement que dans Historique.
