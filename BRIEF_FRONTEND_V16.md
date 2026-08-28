# Brief frontend v16 — nom et logo

## Contexte
Le nom du produit est confirmé : **TVA Contrôle**. Le backend a déjà été
renommé (message de démarrage). Il reste tout ce qui est visible côté
interface.

## 1. Retirer "Module 6" partout où ça apparaît
Chercher dans le frontend toute occurrence de "Module 6" (ou d'un nom
technique équivalent — "api-module6", etc.) visible par l'utilisateur :
titre de la page (onglet navigateur), en-tête de l'application, pied de
page, écran de connexion s'il y en a un. Remplacer par "TVA Contrôle"
partout.

## 2. Ajouter un logo simple
Pas de contrainte visuelle stricte de ma part — utilise ton jugement de
design avec la palette sombre premium déjà en place (les 9 dégradés
construits en v7). Quelque chose de simple et sobre : soit un monogramme
("TC" ou similaire), soit une icône évoquant le contrôle/la vérification
(coche, bouclier, document validé...), cohérent avec le reste de
l'identité visuelle déjà construite. Utilisable comme favicon et dans
l'en-tête de l'application.

## Vérification
Comme toujours : dev server, actions réelles. Vérifier qu'aucune
occurrence de "Module 6" ne subsiste dans ce qui est visible par
l'utilisateur (les noms de code internes comme les noms de dossiers ou de
packages n'ont pas besoin de changer, seulement ce qui s'affiche).
