# Brief frontend v5 — références de pièce lisibles

## Contexte
Toutes les anomalies exposent maintenant un libellé de pièce dans leurs
`details` (`libelle`, ou `exemplesLibelle` pour celles qui regroupent
plusieurs écritures) — avant, seul l'ID technique Pennylane
(`referencePiece`, ex: `22495307243520`) était disponible, et il ne
correspond à rien de recherchable dans l'interface Pennylane elle-même.

## Changement demandé
Sur chaque carte d'anomalie, **le libellé devient la référence principale
affichée**, l'ID technique passe en information secondaire (petit texte,
ou visible seulement au survol/dépliage) :

- Avant : `Pièce : 22495307243520`
- Après : `AVOIR CLIENT AV0001` en évidence, `(pièce 22495307243520)` en
  plus petit à côté ou en dessous.

Pour les anomalies avec plusieurs libellés d'exemple
(`compte_tva_non_reconnu`, regroupe plusieurs écritures) : afficher les
libellés sous forme de liste courte plutôt qu'un seul.

Si `libelle` est `null` (pas toujours renseigné côté Pennylane), retomber
sur l'ID technique comme avant — pas de texte vide.

## Vérification supplémentaire (pas un nouveau développement)
Confirmer que la fusion de "Lancer un cycle" + résultat + anomalies dans
une seule zone "Cycle" (déjà faite dans un brief précédent) a bien
éliminé la redondance d'affichage qu'on avait notée entre l'ancien
CycleForm et AnomaliesPanel — probablement déjà réglé comme effet de
bord, à vérifier plutôt qu'à reconstruire.

## Vérification
Comme toujours : dev server, actions réelles, pas juste au build.
