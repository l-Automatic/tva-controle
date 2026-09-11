# Brief frontend v80 — corrige l'animation pulsée, intensifie les couleurs d'alerte

## 1. L'animation pulsée donne une impression de "rembobinage"

Retour de Rami sur le v79 : l'effet actuel se voit comme "il se fait
puis rembobine comme si ça se faisait en marche arrière", au lieu
d'une vraie respiration continue. C'est un symptôme classique d'une
animation `box-shadow` en aller-retour (`alternate`) avec un timing
asymétrique entre les deux phases.

**À corriger** : reprendre l'animation avec une seule boucle continue
et symétrique — une courbe de timing fluide (ex: `ease-in-out` sur un
`@keyframes` à 3 points 0%/50%/100% qui revient exactement à son état
de départ), pas un aller-retour en `alternate` qui peut créer cette
impression de "retour arrière". L'effet doit se lire comme une
respiration continue, jamais un mouvement qui semble se dérouler à
l'envers.

**Intensité** : augmenter nettement — flou et étendue de l'ombre plus
marqués, opacité plus haute au pic de l'animation. L'anomalie
bloquante doit vraiment se ressentir comme une alerte, pas un effet
discret.

## 2. Couleurs rouge et jaune/orange trop ternes

Rami n'aime pas le orange/jaune actuel depuis le début du projet — il
le décrit comme "orange marron", pas assez vif. Remplacer par des
teintes nettement plus saturées et vives pour le rouge (bloquant) et
le jaune/orange (signalé) — partout où ces couleurs sont utilisées
pour signaler une anomalie ou un avertissement (pastilles, contour des
cartes, ombre pulsée, tout bloc `.avertissement`). L'objectif : qu'on
sente immédiatement, visuellement, qu'il y a une anomalie — pas une
teinte discrète qui se fond dans le reste.

Ne pas toucher aux autres couleurs de l'app (vert, bleu, etc.) — ce
correctif est ciblé sur les couleurs d'alerte uniquement, pas une
refonte générale (celle-ci viendra dans un brief séparé, avec une
référence visuelle de Rami).

## Vérification
Comme toujours : dev server, actions réelles. Confirmer visuellement
que l'animation pulsée se lit comme une respiration continue, jamais
un rembobinage. Confirmer que le rouge et le jaune/orange sont
nettement plus vifs et intenses qu'avant, partout où ils sont utilisés
pour une alerte.
