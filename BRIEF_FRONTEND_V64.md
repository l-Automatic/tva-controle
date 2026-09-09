# Brief frontend v64 — suggestions IA de catégorisation + regroupement complet sous-traitance

## 1. Affichage des suggestions IA

`GET /dossiers/:dossierId/comptes-a-categoriser` (et l'agrégateur
portes-obligatoires, sous `categorisation`) renvoie désormais une clé
supplémentaire `suggestions` :

```json
{
  "comptesACategoriser": [...],
  "comptesServiceSansSousCategorieAutoliquidation": [...],
  "suggestions": [
    {
      "compte": "606100",
      "categorieSuggeree": "comptes_carburant",
      "confiance": "haute",
      "justification": "Libellés mentionnant des stations essence"
    }
  ]
}
```

`categorieSuggeree` peut valoir `null` (l'IA n'a pas assez d'indice —
ne rien afficher dans ce cas, pas de suggestion à montrer). `confiance`
vaut `haute`, `moyenne` ou `basse`.

**Affichage attendu** : pour chaque compte à catégoriser ayant une
suggestion (par correspondance sur le numéro de compte), afficher la
catégorie suggérée avec un indicateur visuel de confiance à côté du
choix à faire — jamais pré-coché/appliqué automatiquement, juste une
aide visuelle avant que le collaborateur ne fasse son choix lui-même.
`suggestions` peut être un tableau vide (aucune clé Mistral configurée,
ou échec de l'appel) — dans ce cas, afficher l'écran exactement comme
avant, sans rien de cassé.

## 2. Sous-traitance — vraiment tout regrouper, pas de vagues

Rappel de la demande précise de Rami, le debounce du v63 n'a pas
suffi : le chargement des candidats sous-traitance doit démarrer
**seulement** une fois que TOUS les comptes de la catégorisation en
cours sont traités (pas après chaque confirmation individuelle, même
débounced), et leur affichage ne doit se faire **qu'une fois** que
cette vérification complète est terminée pour l'ensemble des comptes —
jamais un affichage partiel suivi d'un complément qui arrive après.

Si le debounce actuel ne suffit pas à garantir ça (ex: l'utilisateur
valide avec des pauses plus longues que la fenêtre de 600ms entre deux
clics), il faut probablement changer d'approche : déclencher la
vérification ciblée sur un signal explicite de fin de catégorisation
(ex: quand `comptesACategoriser` devient vide après une confirmation),
plutôt que sur un minuteur depuis la dernière action.

## Vérification
Comme toujours : dev server, actions réelles. Point 1 : avec une clé
Mistral configurée, confirmer qu'au moins une suggestion avec
confiance s'affiche sur un compte réel non catégorisé. Point 2 :
catégoriser plusieurs comptes de sous-traitance avec des pauses
volontairement longues entre chaque validation (plus de 600ms),
confirmer que tous les candidats apparaissent d'un coup, jamais par
vagues.
