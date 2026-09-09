# Brief frontend v70 — deux sujets

## 1. Badges des onglets figés pendant le travail, doivent se mettre à jour en temps réel

Distinct du correctif du v69 (qui ne redéclenche un rechargement
complet qu'une fois tout un lot de catégorisation terminé). Rami
signale que le badge affiché sur l'onglet lui-même (ex:
"Catégorisation (17)") reste figé sur son décompte **initial** pendant
que le travail avance dans l'onglet — même si la liste visible à
l'intérieur de l'onglet se réduit au fur et à mesure des
confirmations, le chiffre affiché à côté du nom de l'onglet ne suit
pas.

**Ce qu'il faut** : le badge de chaque onglet (catégorisation, comptes
TVA à confirmer, rapprochements, parc) doit refléter en temps réel
l'état local de cet onglet — pas seulement se mettre à jour lors d'un
rechargement complet de l'agrégateur. Si le badge est actuellement
sourcé depuis la réponse initiale de l'agrégateur plutôt que depuis
l'état local vivant de chaque composant d'onglet, c'est probablement
là qu'il faut regarder.

## 2. Renommer "Portes obligatoires avant le cycle"

Décision prise avec Rami : le nom sonne trop technique pour un public
comptable. Nouveau nom retenu : **"Vérifications préalables"**.

À changer partout où ce nom apparaît dans l'interface (titre du popup,
et tout autre endroit où "portes obligatoires" est utilisé comme texte
affiché à l'utilisateur — pas nécessairement les noms de fichiers ou
de variables internes, qui peuvent rester tels quels si les changer
n'apporte rien).

## Vérification
Comme toujours : dev server, actions réelles. Point 1 : confirmer
qu'en confirmant des comptes un par un dans l'onglet catégorisation
(sans attendre la fin du lot), le badge affiché diminue au fur et à
mesure. Point 2 : confirmer visuellement le nouveau titre.
