# Brief frontend v20 — "Aucune de celles-là" doit persister le choix

## Contexte
Bug réel confirmé et corrigé côté backend : choisir "Aucune de celles-là"
dans le popup de catégorisation ne mémorisait rien nulle part — le compte
était donc redétecté à l'identique à chaque cycle suivant, indéfiniment.

## Ce qu'il faut faire côté frontend
Quand l'utilisateur choisit "Aucune de celles-là" pour un compte, appeler
la même route existante que pour les 6 autres catégories
(`POST /dossiers/:id/conventions`), avec `cle: 'comptes_sans_categorie'`
et le numéro de compte concerné — exactement le même geste que pour les 6
vraies catégories, juste une clé différente.

Vérifier aussi le côté "Conventions génériques" ou "Conventions de
comptes" : cette nouvelle clé technique ne doit **pas** apparaître comme
une 7ᵉ catégorie visible au même titre que les 6 autres (ce n'est pas une
vraie catégorie fiscale, juste un registre "déjà vu, rien à faire ici")
— si elle s'affiche quelque part, la présenter différemment (ex: dans
Conventions génériques comme les autres clés techniques) plutôt que dans
la grille des 6 catégories du popup.

## Vérification
Comme toujours : dev server, actions réelles. Choisir "Aucune de
celles-là" pour un compte, relancer un cycle, vérifier que ce compte ne
réapparaît plus dans le popup de catégorisation.
