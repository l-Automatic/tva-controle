# Brief frontend v23 — ajustement manuel des montants de TVA

## Contexte
Backend prêt : trois routes, restreintes aux calculs encore `brouillon`.
- `GET /calculs/:id/ajustements` — liste les ajustements actifs
  (`[{typeMontant, montantOriginal, montantAjuste, justification, createdAt}]`).
- `POST /calculs/:id/ajustements` — crée ou remplace un ajustement, body
  `{typeMontant: 'collectee_totale'|'deductible_totale', montantOriginal, montantAjuste, justification, utilisateurId}`.
  Répond 409 avec un message si le calcul n'est plus en brouillon.
- `POST /calculs/:id/ajustements/:typeMontant/retirer` — retire un
  ajustement, body `{utilisateurId}`. Même erreur 409 possible.

## 1. Bouton "Ajuster" à côté des deux totaux
Sur un calcul encore en brouillon (jamais sur un calcul validé — masquer
le bouton dans ce cas), à côté du total TVA collectée et à côté du total
TVA déductible : un petit bouton "Ajuster".

Au clic, un formulaire minimal s'ouvre (modal ou inline, au choix) :
- Nouveau montant, pré-rempli avec le montant actuellement affiché
  (calculé ou déjà ajusté s'il y en a un).
- Justification (texte libre, obligatoire — bouton "Enregistrer" désactivé
  tant que vide).
- Enregistrer / Annuler.

Au clic sur "Enregistrer" : appelle `POST /calculs/:id/ajustements` avec
`montantOriginal` = le montant calculé d'origine par le moteur (pas la
valeur d'un ajustement précédent, même si un ajustement existait déjà —
le backend le préserve automatiquement à travers plusieurs modifications).

## 2. Affichage une fois ajusté
Quand un ajustement existe pour un total : afficher clairement les deux
valeurs — le montant original (barré ou grisé) et le montant ajusté (mis
en évidence), avec la justification visible (au survol, ou dépliée sous
le montant). Un bouton "Retirer l'ajustement" à côté, qui appelle
`POST /calculs/:id/ajustements/:typeMontant/retirer`.

## 3. Recalcul de la TVA nette
Le montant final (TVA nette à payer / crédit) doit se recalculer
automatiquement à partir des montants ajustés quand ils existent, plutôt
que garder l'ancien calcul basé sur les totaux d'origine — pur calcul
d'affichage côté frontend (le backend ne stocke jamais de TVA nette
ajustée, uniquement les deux totaux ajustés).

## Vérification
Comme toujours : dev server, actions réelles. Ajuster un montant, vérifier
que la TVA nette affichée se met à jour, retirer l'ajustement et vérifier
le retour au montant d'origine, tenter d'ajuster un calcul déjà validé et
vérifier que le bouton est bien absent (ou que l'erreur 409 est gérée
proprement si testé directement).
