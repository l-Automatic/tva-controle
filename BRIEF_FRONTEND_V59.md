# Brief frontend v59 — quatre sujets groupés

## 1. Jauge de chargement pour le popup portes obligatoires

Remplacer le chargement actuel du popup "Vérifier les portes
obligatoires" par le **même composant/pattern de jauge** que celui déjà
utilisé pour le lancement d'un cycle — cohérence visuelle, pas de
nouveau mécanisme de suivi par étape (abandonné : trop d'ampleur pour
le bénéfice, cf. discussion). L'appel réseau reste celui existant
(`GET /dossiers/:dossierId/portes-obligatoires`), un seul appel, la
jauge n'a pas besoin de refléter une vraie progression interne.

## 2. Distinguer "vérification terminée" de "tout est bon"

Aujourd'hui, la coche verte de fin de chargement semble n'apparaître
que lorsqu'il n'y a rien à corriger. Il faut qu'elle apparaisse
**systématiquement** une fois le chargement terminé — qu'il y ait des
éléments à traiter dans les onglets ou non. "Terminé" et "tout est
bon" sont deux états différents, à afficher différemment (la coche
signale la fin du chargement, pas l'absence de travail à faire).
Même principe à vérifier côté lancement de cycle, si le même problème
existe là-bas.

## 3. Bouton pour rétrograder un compte TVA déjà confirmé

Actuellement, un compte TVA (`compte_tva_due_autoliquidee` et les
variantes BTP/intracom/immo intracom) une fois confirmé ne peut plus
être retiré depuis l'interface. Le mécanisme backend existe déjà et
fonctionne sans changement : `POST /conventions/:id/rejeter` (fait un
`UPDATE ... SET statut = 'rejected'` sans condition sur le statut
actuel — s'applique donc aussi bien à un candidat qu'à un compte déjà
confirmé). Il manque uniquement le bouton côté interface pour un
compte déjà confirmé — probablement caché aujourd'hui parce que le
bouton "rejeter" n'est affiché que pour les candidats. À exposer
spécifiquement dans l'onglet "Comptes TVA à confirmer".

## 4. À investiguer — régression possible sur la catégorisation IA

Rami a remarqué que la catégorisation via le popup portes obligatoires
n'affiche plus les suggestions IA avec indicateur de confiance,
contrairement à l'ancien écran de catégorisation autonome. Le backend
n'a pas changé (`verifierComptesACategoriser` est identique à avant
le brief v58) — si cette fonctionnalité a disparu, c'est très
probablement un oubli survenu lors du découpage en composants
"Contenu" réutilisables du v58. Merci de vérifier précisément ce qui
existait avant (quelle prop, quel appel, quel composant portait
l'affichage de la confiance IA) et de le restaurer dans le nouveau
`CategorisationPopup`/composant "Contenu" équivalent.

## Vérification
Comme toujours : dev server, actions réelles. Confirmer la jauge
visuellement cohérente avec celle du cycle. Confirmer que la coche
verte apparaît même sur un dossier ayant volontairement quelque chose
à corriger dans au moins un onglet. Confirmer qu'un compte TVA déjà
confirmé peut être rejeté depuis l'interface, et qu'il réapparaît
ensuite comme "à confirmer". Confirmer si la suggestion IA avec
confiance était bien présente avant le v58 et si elle a été
retrouvée/restaurée — signaler explicitement si ce n'était finalement
pas une régression mais un comportement inchangé.
