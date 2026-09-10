# Brief frontend v71 — vérifier le gain de performance réel sur le cycle complet

## Contexte
Deux boucles séquentielles dans `pipeline.ts` (`executerCycleTva`)
faisaient un appel réseau par élément au lieu d'un appel groupé —
même classe de bug que celui déjà corrigé pour le popup portes
obligatoires (renommé "Vérifications préalables") :

1. Jugement IA "véhicule identifié dans le libellé" (frais véhicule
   entretien/location) : un appel Mistral par candidat, corrigé en un
   seul appel groupé.
2. Détail des groupes de lettrage pour le prorata de paiement partiel
   côté ventes : un appel Pennylane par candidat, corrigé en un seul
   appel groupé.

Commit `00d7e824`. Tests backend verts (567), pas de régression.

## Ce qui est demandé
Lancer un vrai cycle complet sur "Electricien Sandbox Reel" (données
réelles, jamais de simulation) sur une période où il y a effectivement
des candidats pour ces deux mécanismes (des frais d'entretien/location
véhicule catégorisés, et/ou des paiements partiels côté ventes avec un
groupe de lettrage à plus de 2 lignes) — sinon le gain ne serait pas
observable, ces deux boucles ne s'exécutant que si de tels candidats
existent.

Mesurer et rapporter le temps réel du lancement de cycle. Rami avait
mentionné empiriquement ~1 minute pour un cycle bloqué avant ces
correctifs (mesure informelle, pas un vrai avant/après contrôlé) — pas
besoin de reproduire un "avant" précis, juste rapporter le temps
observé maintenant, avec le nombre de candidats traités par chacun des
deux mécanismes si possible (pour context : combien de frais véhicule,
combien de paiements partiels vente), pour qu'on sache si le test a
vraiment sollicité les deux correctifs.

## Vérification
Cycle complet, données réelles, temps mesuré et rapporté avec le
contexte (nombre de candidats par mécanisme). Si aucun candidat
n'existe pour l'un des deux mécanismes sur ce dossier actuellement, le
dire explicitement plutôt que de conclure à un gain non observé.
