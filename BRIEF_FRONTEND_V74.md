# Brief frontend v74 — écran de gestion des exercices comptables

## Contexte
Migration backend terminée (commit sur `028_exercices_comptables.sql`
et suivants) : les deux anciens champs uniques
`dateDebutExercice`/`dateFinExercice` (un seul exercice par dossier)
sont retirés de l'API — remplacés par une vraie liste d'exercices,
via deux nouvelles routes :

- `GET /dossiers/:dossierId/exercices-comptables` → `{ exercices: [{ id, dateDebut, dateFin, statut }] }`, triés par date de début croissante.
- `POST /dossiers/:dossierId/exercices-comptables` avec `{ dateDebut, dateFin }` → `201 { id }`. Erreurs possibles : `400` si dates manquantes ou incohérentes (fin ≤ début), `409` si l'exercice chevauche un exercice déjà existant pour ce dossier.

## Ce qu'il faut faire

### 1. Retirer les deux anciens champs
Dans `types.ts` et partout où `dateDebutExercice`/`dateFinExercice`
apparaissent encore (identité du dossier, formulaire de paramètres) :
retirer ces champs, ils n'existent plus côté API.

### 2. Nouvel écran "Exercices comptables"
À ajouter dans les paramètres du dossier, à l'endroit qui accueillait
avant les deux champs retirés. Périmètre volontairement réduit par
rapport à une gestion complète (pas de clôture, pas de verrouillage
pour l'instant — juste la possibilité d'ajouter) :

- Liste des exercices existants (date début → date fin, avec le
  statut affiché si utile, mais aucune action de clôture à construire
  pour l'instant).
- Un bouton "Ajouter un exercice comptable" ouvrant un petit
  formulaire avec deux sélecteurs de date (début, fin).
- Affichage clair de l'erreur si l'API renvoie 400 (dates
  incohérentes) ou 409 (chevauchement avec un exercice existant) —
  pas besoin de validation client sophistiquée, l'API fait déjà le
  contrôle, juste bien remonter le message d'erreur.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer qu'un exercice
peut être ajouté, qu'il apparaît dans la liste, et qu'un chevauchement
avec un exercice existant est bien rejeté avec un message clair.
