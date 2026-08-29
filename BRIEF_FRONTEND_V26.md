# Brief frontend v26 — désactiver un utilisateur

## Contexte
Backend prêt : `POST /utilisateurs/:id/desactiver` (admin_cabinet
uniquement). Désactive plutôt que supprime — l'utilisateur ne peut plus se
connecter, mais reste visible dans l'historique. Refuse avec un 409 et un
message clair si c'est le dernier `admin_cabinet` actif du cabinet.

## Changement demandé
Sur l'écran Utilisateurs, à côté de chaque ligne (en plus du bouton
"Réinitialiser le mot de passe" déjà présent) : un bouton "Désactiver".

Au clic, une confirmation ("Désactiver ce compte ? Il ne pourra plus se
connecter.") puis l'appel à la route. Si la réponse est un 409 (dernier
admin), afficher le message renvoyé par le backend tel quel plutôt qu'un
message générique — il explique déjà clairement la raison.

Une fois désactivé, la ligne reste visible dans la liste (ne pas la faire
disparaître) mais visuellement marquée comme inactive — grisée, avec la
mention "Inactif" par exemple. Le bouton "Désactiver" disparaît pour cette
ligne (déjà fait), le bouton "Réinitialiser le mot de passe" peut rester
(réactiverait implicitement le compte si un jour on ajoute une
réactivation — pas la peine d'y penser maintenant, juste ne pas casser ce
bouton existant).

## Vérification
Comme toujours : dev server, actions réelles. Désactiver un collaborateur,
vérifier qu'il ne peut plus se connecter et que la ligne est bien marquée
inactive. Tenter de désactiver le seul admin_cabinet du dossier de test et
vérifier que le message d'erreur du backend s'affiche correctement.
