# Brief frontend v66 — rapprochement toujours cassé, mais après un changement de timing backend majeur

## Contexte important
Le v65 avait confirmé, avec de vraies données sur "Electricien Sandbox
Reel", que le bug ne se reproduisait pas — backend et frontend
affichaient bien les 7 rapprochements. Depuis, un correctif backend de
performance majeur a été déployé (partage d'un seul fetch Pennylane
entre les 4 portes au lieu de 4 fetchs redondants) : le popup
`portes-obligatoires` répond maintenant en **~35 secondes au lieu
d'environ 100**. Rami vient de retester sur ce même dossier réel et le
symptôme est revenu à l'identique — seul le rapprochement hôtel
s'affiche, puis plus rien d'autre.

J'ai vérifié côté backend le risque de mutation en place partagée du
tableau d'écritures maintenant partagé entre les 4 fonctions (une
vraie inquiétude vu ce changement) — rien trouvé dans
`identifierComptesACategoriser` ni `identifierFacturesCandidatesAcompte`,
aucune des deux ne modifie le tableau reçu.

## Hypothèse à vérifier en priorité
Le changement le plus évident entre "ça marchait" (v65) et "ça ne
marche plus" (maintenant), c'est la vitesse de réponse elle-même. Le
correctif du v63 contre le doublon React StrictMode utilisait un
`setTimeout(0)` pour différer l'appel réel d'un tick, en comptant sur
le fait que le montage jeté par StrictMode annule ce minuteur avant
qu'il ne s'exécute. Si la réponse de l'agrégateur arrive maintenant
beaucoup plus vite, il est possible qu'un timing qui fonctionnait avec
l'ancienne lenteur (100s) se comporte différemment avec la nouvelle
vitesse (35s) — par exemple si un autre endroit du code dépend
implicitement d'un délai minimal avant de considérer une réponse comme
stable.

Merci de vérifier, avec la même rigueur qu'au v65 (données réelles sur
"Electricien Sandbox Reel", instrumentation réseau réelle, jamais de
simulation) :
1. Le symptôme se reproduit-il de façon fiable maintenant ?
2. Si oui, le backend renvoie-t-il toujours les 7 rapprochements
   complets (vérifiable par appel direct à la route), ou est-ce que le
   nouveau timing a introduit une vraie différence côté backend cette
   fois (peu probable vu ma vérification, mais à confirmer) ?
3. Si le backend renvoie tout mais l'affichage reste incomplet,
   chercher spécifiquement un mécanisme qui dépendrait du temps
   écoulé plutôt que d'un signal explicite (une réponse reçue, un
   état "chargé") — c'est le candidat le plus probable vu que le seul
   changement connu est la vitesse.

## Vérification
Reproduire sur "Electricien Sandbox Reel" avec de vraies données,
confirmer si le symptôme est présent ou non, et si présent, identifier
la cause précise avant de proposer un correctif — pas une nouvelle
tentative sans preuve.
