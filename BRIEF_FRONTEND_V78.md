# Brief frontend v78 — boutons simplifiés pour les anomalies flotte mixte

## Demande de Rami
Pour les deux nouvelles anomalies informatives (`entretien_vehicule_flotte_mixte_a_verifier`,
`location_vehicule_flotte_mixte_a_verifier`) — capture d'écran jointe
par Rami montrant l'affichage actuel générique ("Résoudre" +
"Justifier" avec commentaire requis pour ce dernier) — il veut
seulement deux boutons simples : **"Ok"** et **"Ignorer"**, sans
exiger de commentaire dans les deux cas.

## Ce qui a été vérifié côté backend
La route `POST /anomalies/:id/resoudre` accepte déjà un commentaire
**optionnel** (`{ commentaire?: string }`, pas requis) — contrairement
à `POST /anomalies/:id/justifier` qui exige un commentaire
(`{ commentaire: string }`). "Ok" peut donc probablement réutiliser
`resoudre` tel quel, sans aucun changement backend, juste en masquant
le champ commentaire pour ces types précis.

Pour "Ignorer" : pas de mécanisme backend dédié qui corresponde
exactement à "dismiss sans justification". Deux options possibles,
au choix du meilleur compromis :
1. Réutiliser aussi `resoudre` pour ce bouton (les deux boutons
   auraient le même effet technique, seule la sémantique/le libellé
   change pour l'utilisateur — le plus simple, cohérent avec le
   caractère purement informatif de ces anomalies).
2. Utiliser `justifier` en envoyant un commentaire par défaut
   généré automatiquement (ex: "Ignoré") plutôt que d'en demander un à
   l'utilisateur — permet de garder la distinction résolu/justifié
   dans l'historique si elle a une utilité ailleurs dans l'app.

Choisir l'option la plus simple à intégrer proprement dans
l'architecture existante, sans over-engineering — ces anomalies sont
volontairement informatives et légères, la mécanique de résolution
doit rester à la même échelle.

## Ce qui est demandé
Pour ces deux types d'anomalies spécifiquement (pas les autres, qui
gardent leur comportement actuel) : afficher seulement deux boutons
"Ok" / "Ignorer", sans champ de commentaire visible, sans exiger de
saisie de l'utilisateur.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer que ces deux
types d'anomalies affichent bien "Ok"/"Ignorer" sans champ
commentaire, et que les deux boutons résolvent correctement
l'anomalie (elle disparaît de la liste des anomalies ouvertes).
Confirmer aussi que les autres types d'anomalies gardent leur
affichage actuel (Résoudre/Justifier), inchangé.
