# Brief frontend v63 — trois sujets, le troisième prioritaire

## 1. Texte de chargement sous-catégorisation — pas assez visible

Le texte "Vérification des sous-catégories..." ajouté au v62 existe
mais ne ressort pas assez. Même traitement que le rappel
location/crédit-bail (v54) : réutiliser la classe `.avertissement`
déjà établie dans l'app pour ce type de message (fond ambré), plus le
texte en gras.

## 2. Sous-traitance : re-vérification saccadée en cas de validation groupée

Diagnostic de Rami, confirmé plausible : il catégorise généralement
**tous** les comptes d'abord, puis les valide **en masse** — pas un par
un. Si chaque confirmation individuelle déclenche sa propre
re-vérification ciblée, une validation groupée produit plusieurs
réponses qui arrivent l'une après l'autre, donnant l'impression que
les candidats sous-traitance apparaissent par vagues plutôt que d'un
coup.

**Ce qu'il faut** : regrouper les re-vérifications déclenchées par une
validation en masse — soit ne relancer `fetchComptesACategoriser`
**qu'une seule fois** après que toutes les confirmations de la
validation groupée sont terminées (pas une fois par compte confirmé),
soit debouncer l'appel (attendre un court instant après la dernière
confirmation avant de vérifier). Objectif : tous les candidats
sous-traitance doivent apparaître d'un coup, jamais en plusieurs
vagues successives.

## 3. Rapprochement paiement achat — persiste après DEUX tentatives de correctif, investigation sérieuse nécessaire

C'est la **troisième fois** que Rami rapporte exactement le même
symptôme : seul le rapprochement hôtel apparaît, puis plus rien
d'autre, même après un "actualisation" qui se déclenche seul. Un
correctif backend substantiel (regroupement de N appels Pennylane en
1 seul, cf. commit `9e215e9`) n'a **pas** résolu le symptôme visible —
ce qui indique que la cause est bien côté frontend, probablement dans
la gestion d'état ou le traitement de la réponse de cet onglet
précisément.

**Merci de traiter ce point avec la même rigueur que le bug de
duplication du v60** (celui où une instrumentation réseau réelle avait
permis de trouver la vraie cause, un `AbortController` et un
`StrictMode` qui doublait les appels) — pas une nouvelle tentative de
correctif sans preuve. Instrumente réellement les appels réseau de cet
onglet précis, trace ce qui se passe entre le premier affichage
(hôtel seul) et l'actualisation automatique qui suit, et identifie la
vraie cause avant de corriger quoi que ce soit.

## Vérification
Comme toujours : dev server, actions réelles. Point 1 : confirmer
visuellement l'emphase du texte. Point 2 : catégoriser plusieurs
comptes sous-traitance, les valider en masse, confirmer qu'ils
apparaissent tous en une fois. Point 3 : reproduire le scénario exact
(catégoriser, confirmer TVA, ouvrir rapprochements) et confirmer que
**tous** les rapprochements candidats s'affichent dès le premier
chargement, sans actualisation automatique qui en fait disparaître ou
en manque.
