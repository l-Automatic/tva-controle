# Brief frontend v22 — option "Mixte" pour le taux assigné

## Contexte
Backend prêt (migration 011) : `taux_assigne_compte` accepte maintenant
`'mixte'` comme valeur, `taux_historique_tiers` (côté client) accepte
`'mixte'` en plus d'un nombre (transmis tel quel dans le body JSON, stocké
comme `NULL` côté serveur).

## 1. Comptes produit/charge (POST /dossiers/:id/taux-assignes)
Ajouter "Mixte" comme option dans le select des taux, aux côtés de
0/2,1/5,5/10/20/autoliquidé — envoie `taux: 'mixte'`.

## 2. Comptes clients (POST /dossiers/:id/taux-historique-tiers/assigner)
Même chose : ajouter "Mixte" comme option, envoie `tauxHabituel: 'mixte'`
(chaîne, pas un nombre, dans ce cas précis).

## 3. Affichage des taux déjà assignés
Pour le taux compte : afficher "Mixte" tel quel, c'est déjà une chaîne
stockée directement.

Pour le taux client : la valeur revient comme `tauxHabituel: undefined`
quand c'est "mixte" (le champ est absent de la réponse, pas `null`) —
distinct de "jamais assigné du tout" seulement par le fait qu'une ligne
existe avec le statut confirmé. Afficher "Mixte" dans ce cas plutôt que
de laisser un champ vide ou "undefined" visible.

## Vérification
Comme toujours : dev server, actions réelles. Assigner "Mixte" sur un
compte et sur un client, vérifier l'affichage après rechargement, vérifier
qu'un client assigné "Mixte" ne reçoit plus de taux par défaut fixe lors
d'un cycle (retombe sur 20% de prudence comme si rien n'était assigné).
