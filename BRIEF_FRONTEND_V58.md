# Brief frontend v58 — popup unique pour les portes obligatoires

## Contexte
Aujourd'hui, les 4 vérifications qui doivent être réglées avant de
lancer un cycle (catégorisation, comptes TVA à confirmer,
rapprochements paiement achat, parc de véhicules) ont chacune leur
propre écran/bouton/redirection. Rami veut un seul bouton qui ouvre un
popup à onglets — même structure que Paramètres cabinet/dossier — avec
un onglet par porte, pour tout régler à un seul endroit.

## Étape 1 — obligatoire avant de construire quoi que ce soit

**Fais d'abord l'inventaire précis de l'existant** : quels boutons,
quels écrans, quelles redirections gèrent aujourd'hui chacune des 4
portes (catégorisation, comptes TVA à confirmer, rapprochements
paiement achat, parc de véhicules). Liste ce que tu trouves avant de
commencer à construire le popup — objectif : ne rien perdre en
fonctionnalité au passage, et réutiliser les composants d'écran déjà
faits pour chaque porte plutôt que de les refaire de zéro à l'intérieur
du popup.

## Étape 2 — le popup lui-même

Un bouton unique, qui ouvre un popup à 4 sous-onglets (un par porte).
Chaque onglet réutilise le contenu/composant déjà existant pour cette
porte précise.

**Nouvel endpoint pour peupler le popup en un seul appel** :
`GET /dossiers/:dossierId/portes-obligatoires?periodeDebut=...&periodeFin=...`

Réponse :
```json
{
  "categorisation": { "comptesACategoriser": [...], "comptesServiceSansSousCategorieAutoliquidation": [...] },
  "comptesTvaAConfirmer": [ /* Anomalie[] */ ],
  "rapprochementsPaiementAchat": [ /* FactureARapprocher[] */ ],
  "parcVehiculesNonRenseigne": true | false
}
```

Chaque clé a exactement la même forme que ce que renvoyaient déjà les
routes séparées (`comptes-a-categoriser`, `comptes-tva-a-confirmer`,
`rapprochements-paiement-achat`) — seul `parcVehiculesNonRenseigne`
est nouveau : avant ce chantier, il n'existait aucun moyen de connaître
l'état du parc sans tenter un cycle et se faire bloquer. Un booléen
`true` = le parc doit être renseigné (compte carburant touché sur la
période, aucun véhicule enregistré) ; l'écran de gestion du parc reste
le même qu'aujourd'hui, juste maintenant accessible depuis un onglet du
popup plutôt qu'un lien séparé.

## Étape 3 — le bouton unique

Un seul bouton (à la place des multiples boutons/liens actuels)
ouvrant ce popup. Peut afficher un badge indiquant combien de portes
ont encore quelque chose à régler, si ça te semble pertinent pour l'UX
— pas une exigence stricte, à ton appréciation.

## Vérification
Comme toujours : dev server, actions réelles. Sur un dossier ayant
volontairement quelque chose à régler sur chacune des 4 portes (compte
non catégorisé, compte TVA non confirmé, paiement partiel achat en
attente, parc vide avec du carburant sur la période) — confirmer que
le popup affiche bien les 4 onglets avec le contenu correct, et
qu'agir depuis un onglet (confirmer une catégorie, valider un
rapprochement, etc.) fonctionne exactement comme avant ce chantier.
