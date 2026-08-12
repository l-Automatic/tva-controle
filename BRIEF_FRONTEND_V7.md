# Brief frontend v7

## 1. Relancer BRIEF_FRONTEND_V5.md
Jamais fait (confirmé par Rami, contrairement à v4). Contenu : sur chaque
carte d'anomalie, le libellé de la pièce (`libelle` ou `exemplesLibelle`
dans `details`) devient la référence principale affichée, l'ID technique
Pennylane (`referencePiece`) passe en information secondaire (petit texte,
ou visible au survol). Si `libelle` est `null`, retomber sur l'ID
technique — jamais de texte vide.

## 2. Nouvelle palette de dégradés — remplace les 15 existants
Direction demandée (09/08) : couleurs foncées et premium façon Inqom
(violet-rouge profond) ou Pennylane (vert profond), pas les dégradés
vifs actuels. Dégradés **très légers** : chaque couleur en dégradé avec
une variante légèrement plus claire d'elle-même (même teinte, pas un
mélange de deux couleurs différentes), diagonal 135deg, cohérent avec le
style déjà utilisé pour les dégradés existants.

9 couleurs de base fournies par Rami, avec ma variante plus claire
calculée pour chacune (approximation manuelle, à ajuster visuellement) :

| Base | Variante claire (~20%) | Dégradé proposé |
|---|---|---|
| `#2A0F2E` (violet très foncé) | `#553F58` | `linear-gradient(135deg, #2A0F2E, #553F58)` |
| `#0F5757` (sarcelle foncé) | `#3F7979` | `linear-gradient(135deg, #0F5757, #3F7979)` |
| `#003D3D` (vert-bleu très foncé) | `#336464` | `linear-gradient(135deg, #003D3D, #336464)` |
| `#191919` (quasi noir) | `#474747` | `linear-gradient(135deg, #191919, #474747)` |
| `#3A2D28` (brun foncé) | `#615753` | `linear-gradient(135deg, #3A2D28, #615753)` |
| `#80685C` (taupe/mocha) | `#99867D` | `linear-gradient(135deg, #80685C, #99867D)` |
| `#49111C` (bordeaux très foncé) | `#6D4149` | `linear-gradient(135deg, #49111C, #6D4149)` |
| `#142174` (bleu roi profond) | `#434D90` | `linear-gradient(135deg, #142174, #434D90)` |
| `#61053B` (magenta/lie-de-vin foncé) | `#813762` | `linear-gradient(135deg, #61053B, #813762)` |

Si le rendu visuel d'une variante calculée à la main ne convient pas
(contraste, lisibilité du texte blanc dessus...), ajuster librement — la
consigne est l'esprit ("dégradé très léger, même teinte, sombre et
premium"), pas les valeurs exactes au pixel près.

Remplace intégralement la liste de 15 dégradés actuelle dans Paramètres
dossier (Apparence) — ne pas les ajouter en plus, les remplacer.

## Vérification
Comme toujours : dev server, actions réelles. Vérifier en particulier la
lisibilité du texte sur le volet latéral avec chacune des 9 nouvelles
couleurs — certaines (le taupe `#80685C` notamment) sont plus claires que
les autres, le texte blanc pourrait ne plus assez contraster dessus.
