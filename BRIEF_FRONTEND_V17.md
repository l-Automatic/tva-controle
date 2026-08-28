# Brief frontend v17 — corrige la position de la recommandation (v15 mal interprété)

## Contexte
Le brief v15 a mal interprété la demande — le texte de recommandation
("Pour une première analyse, choisissez une période large...") a été mis
en double, encadrant les champs de date/token. Ce n'était pas la demande.

## Ce qu'il faut réellement
**Une seule occurrence** de ce texte, positionnée dans l'espace entre :
1. La fin du bloc "Analyser le motif de numérotation des factures" (après
   le bouton "Analyser le motif de numérotation" et la ligne "Motif
   proposé : ..." quand elle existe).
2. Le début du panneau "Conventions génériques (N en attente)".

Retirer les deux occurrences actuelles (au-dessus et en dessous des
champs de date/token) — aucune ne doit rester à cet endroit.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer qu'il n'y a plus
qu'une seule occurrence du texte, bien positionnée entre les deux blocs
décrits ci-dessus — pas avant le bouton, pas encadrant les champs de date.
