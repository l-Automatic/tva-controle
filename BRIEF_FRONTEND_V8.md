# Brief frontend v8 — polish premium

## 1. Popup de chargement au lancement d'un cycle
Au clic sur "Lancer le cycle" : un popup/modal apparaît, bloque
l'interaction avec le reste de l'écran, contient :
- Une barre de progression **indéterminée** (l'API ne renvoie aucune
  progression étape par étape aujourd'hui — pas de fausse barre à
  pourcentage qui ne correspondrait à rien de réel).
- Un texte court en dessous, style "Lancement du cycle...". Si un texte
  unique suffit c'est très bien ; s'il existe un moyen simple de varier le
  message selon ce qui se passe côté visuel uniquement (ex: alterner
  "Récupération des écritures...", "Analyse en cours..." toutes les
  quelques secondes, sans lien réel avec le backend, juste pour meubler
  l'attente), au choix de Claude Code — pas une exigence stricte.
- À la réception de la réponse (bloqué ou calculé) : la barre disparaît,
  un check qui se dessine (trait qui s'anime, pas une icône statique qui
  apparaît d'un coup) avec un court texte de confirmation, puis le popup se
  ferme après un court délai et le résultat s'affiche normalement dans la
  zone Cycle.

## 2. Animations et transitions "smooth" partout
Directive générale, pas une liste figée : chaque interaction (survol d'un
bouton, changement de couleur d'un badge, apparition d'un élément,
ouverture d'un onglet) doit utiliser une transition CSS douce (`ease` ou
`ease-in-out`, 150-250ms typiquement) plutôt qu'un changement instantané.
Objectif : que l'interface donne une impression "premium", pas "figée".

## 3. Typographie et boutons — passe de réglage
Pas de nouvelle maquette demandée, un ajustement de ce qui existe déjà :
- **Typographie** : revoir les graisses (`font-weight`) utilisées — Rami
  trouve qu'il y a quelque chose à affiner sans le formuler plus
  précisément. Au jugement de Claude Code : hiérarchie claire entre
  titres/sous-titres/corps de texte, éviter le tout-en-`bold` ou le
  tout-en-`regular`.
- **Boutons** : revoir la forme (coins arrondis, padding), le texte à
  l'intérieur (lisibilité, taille), et ajouter une animation au survol
  (légère élévation, changement de teinte, ou les deux — cohérent avec le
  point 2 ci-dessus, transition douce, pas de changement brutal).

## Vérification
Comme toujours : dev server, actions réelles — en particulier vérifier
que le popup de chargement fonctionne aussi bien pour un cycle qui bloque
(anomalie bloquante) que pour un cycle qui aboutit à un calcul, puisque
les deux cas doivent afficher le check de fin.
