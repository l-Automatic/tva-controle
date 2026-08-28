# Brief frontend v18 — déplace la bulle de résultat du motif proposé

## Contexte
Confusion du brief précédent (v17) : il portait sur le texte de
recommandation statique ("Pour une première analyse, choisissez..."). Ce
brief-ci porte sur un élément différent : **la carte de résultat** qui
apparaît après avoir cliqué "Analyser le motif de numérotation" — celle
avec le badge "En attente", le texte "Motif de numérotation facture :
Préfixe (...), N chiffres, ..." et les deux boutons "Confirmer" /
"Rejeter".

Aujourd'hui, cette carte n'apparaît que noyée dans la liste générale du
panneau "Conventions génériques (N en attente)" plus bas, au milieu des
autres conventions en attente.

## Ce qu'il faut faire
Faire apparaître **cette carte de résultat précise** (motif proposé +
Confirmer/Rejeter) juste en dessous des champs de date/token et du bouton
"Analyser le motif de numérotation" — avant le panneau général
"Conventions génériques". Dès qu'un motif `motif_numerotation_facture` a
le statut `candidate`, afficher sa carte à cet endroit (en plus de son
apparition naturelle dans la liste générale plus bas, ou à la place —
au choix, tant qu'elle est bien visible juste après les champs, pas
seulement noyée dans la liste).

Les actions Confirmer/Rejeter de cette carte utilisent la même route
existante que dans le panneau général — pas de nouveau mécanisme
backend, uniquement un changement d'emplacement d'affichage.

## Vérification
Comme toujours : dev server, actions réelles. Lancer une vraie analyse,
vérifier que la carte de résultat apparaît bien juste après les champs de
date/token, cliquer Confirmer depuis cet emplacement et vérifier que ça
fonctionne comme depuis le panneau général.
