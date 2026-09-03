# Brief frontend v37 — avoir_a_verifier : qualification structurée + vérifier à nouveau

## Contexte
`avoir_a_verifier` couvre désormais aussi les achats (crédit sur un
compte déductible, pas seulement débit sur la collectée) — rien à changer
côté affichage pour ça, le type d'anomalie reste le même. Deux nouveaux
mécanismes à construire pour cette anomalie précise.

## 1. Qualification structurée — remplace Résoudre/Justifier pour ce type
Pour une anomalie `avoir_a_verifier` uniquement : au lieu des boutons
génériques Résoudre/Justifier avec commentaire libre, deux boutons
clairs — **"Avoir"** / **"OD de régularisation"**. Appelle
`POST /anomalies/:id/qualifier-avoir` avec `{utilisateurId, type: 'avoir'|'od'}`.
Ne touche jamais le calcul — juste une qualification, l'anomalie passe à
résolue une fois choisie.

## 2. Bouton "Vérifier à nouveau"
Sur cette même anomalie : un bouton distinct de la qualification
ci-dessus. Appelle `POST /dossiers/:dossierId/verifier-avoirs` avec
`{periodeDebut, periodeFin, utilisateurId}`. Réponse :
`{anomaliesOuvertes: number, corrections: number}`.

- Si l'anomalie a disparu (le débit/crédit litigieux a été corrigé côté
  Pennylane) : elle n'apparaît plus au chargement suivant, et le calcul
  brouillon existant a été ajusté automatiquement en conséquence —
  recharger le panneau de calcul pour voir le nouveau montant.
- Si elle est toujours là : rien ne change, `corrections` sera à 0 pour
  cette anomalie.

Ce bouton et la qualification (point 1) sont deux actions distinctes,
jamais à confondre : qualifier dit "c'est un avoir/une OD", vérifier à
nouveau dit "je pense l'avoir corrigé dans Pennylane, vérifie et corrige
le calcul si besoin".

## Vérification
Comme toujours : dev server, actions réelles. Qualifier une anomalie
avoir_a_verifier réelle en "Avoir", vérifier qu'elle passe à résolue.
Provoquer une seconde anomalie du même type, cliquer "Vérifier à
nouveau" sans rien avoir corrigé côté Pennylane, vérifier qu'elle reste
ouverte. Corriger réellement le débit/crédit dans Pennylane, cliquer à
nouveau, vérifier que l'anomalie disparaît et que le montant du panneau
de calcul a changé en conséquence.
