# Brief frontend v17 (consolidé) — trois correctifs sur la section motif de numérotation

## 1. Texte de recommandation en double (bug du v15)
Le texte de recommandation ("Pour une première analyse, choisissez une
période large...") apparaît actuellement deux fois, encadrant les champs
de date/token. Ce n'était pas la demande initiale.

**Correction** : une seule occurrence, positionnée dans l'espace entre :
- la fin du bloc "Analyser le motif de numérotation des factures" (après
  le bouton et la carte de résultat quand elle existe),
- le début du panneau "Conventions génériques (N en attente)".

Retirer les deux occurrences actuelles qui encadrent les champs de
date/token.

## 2. Carte de résultat en double (v18)
La carte de résultat (badge "En attente", "Motif de numérotation
facture : ...", Confirmer/Rejeter) a été dupliquée en v18 — elle
apparaît maintenant à la fois juste après le formulaire d'analyse ET
dans la liste générale "Conventions génériques" plus bas.

**Correction** : la retirer de la liste générale, la garder **uniquement**
à son nouvel emplacement juste après le formulaire d'analyse. Un motif
`motif_numerotation_facture` en attente ne doit donc plus apparaître dans
la liste générale de Conventions génériques — seulement à l'endroit
dédié juste après les champs de date/token.

## 3. Marge insuffisante (v19)
Une fois les points 1 et 2 réglés, ajouter un espacement vertical clair
entre la carte de résultat et le panneau "Conventions génériques" juste
en dessous — assez pour que les deux zones se distinguent nettement au
premier coup d'œil, cohérent avec les autres espacements déjà utilisés
ailleurs dans Configuration du dossier.

## Vérification
Comme toujours : dev server, actions réelles. Lancer une vraie analyse et
vérifier, dans l'ordre : une seule occurrence du texte de recommandation
et bien positionnée ; la carte de résultat visible une seule fois, à son
nouvel emplacement, absente de la liste générale ; un espacement visuel
clair avant "Conventions génériques".
