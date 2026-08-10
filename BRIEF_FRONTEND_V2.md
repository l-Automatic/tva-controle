# Brief frontend v2 — navigation, design, popup de catégorisation

## 1. Navigation en volet latéral (style Pennylane)
Remplacer la navigation par onglets horizontaux par un volet latéral fixe
à gauche, même charte graphique que le reste de l'interface sauf sa couleur
de fond (voir point 2). Contient : sélection/recherche de dossier, les 4
zones existantes (Cycle, Configuration du dossier, Historique, Paramètres),
et la bannière "à traiter" doit rester visible en priorité (en haut du
contenu principal, pas dans le volet).

## 2. Dégradés — couleur de fond du volet + couleur secondaire
Le volet latéral utilise un dégradé, choisi par l'utilisateur dans
**Paramètres dossier** (pas cabinet — précision explicite de Rami). Palette
fournie, à intégrer telle quelle comme options :
- `linear-gradient(135deg, #FF6CAB, #7366FF)`
- `linear-gradient(135deg, #B65EBA, #2E8DE1)`
- `linear-gradient(135deg, #64E8DE, #8A64EB)`
- `linear-gradient(135deg, #7BF2E9, #B65EBA)`
- `linear-gradient(135deg, #FF9482, #7D77FF)`
- `linear-gradient(135deg, #FFCF1B, #FF881B)`
- `linear-gradient(135deg, #FFA62E, #EA4D2C)`
- `linear-gradient(135deg, #00FFED, #00B8BA)`
- `linear-gradient(135deg, #6EE2F5, #6454F0)`
- `linear-gradient(135deg, #3499FF, #3A3985)`
- `linear-gradient(135deg, #FF9897, #F650A0)`
- `linear-gradient(135deg, #FFCDA5, #EE4D5F)`
- `linear-gradient(135deg, #FF5B94, #8441A4)`
- `linear-gradient(135deg, #F869D5, #5650DE)`
- `linear-gradient(135deg, #F00B51, #7366FF)`

Le dégradé choisi sert aussi de couleur secondaire pour les boutons
principaux, badges actifs, etc. — le fond général du site reste blanc/gris
très clair, le noir/gris pour le texte. Tester la lisibilité du texte sur
le volet (blanc probablement, à vérifier selon le dégradé choisi).

## 3. Police
Remplacer la police actuelle par une police à connotation "fintech
premium" (ex : Inter, Söhne, ou équivalent disponible facilement — au
jugement de Claude Code, l'essentiel est de sortir d'une police système
par défaut).

## 4. Icônes
Ajouter des icônes partout où c'est pertinent : navigation latérale,
boutons d'action (Valider/Rejeter/Résoudre/Justifier/Qualifier), types
d'anomalies (une icône distincte par type aiderait à les repérer d'un coup
d'œil), statuts (confirmé/candidate/rejeté).

## 5. Popup de catégorisation des comptes (nouveau, backend prêt)
- `GET /dossiers/:id/taux-assignes` — pas utilisé pour ce popup précis (v6
  ci-dessous), mentionné pour mémoire.
- Le résultat d'un cycle (`POST /dossiers/:id/cycles`) contient maintenant
  un champ `comptesACategoriser: {compte, exemplesLibelle}[]` — tous les
  comptes produit/charge mouvementés sur la période mais absents des 4
  conventions.
- Si ce tableau n'est pas vide après un cycle, proposer le popup :
  pour chaque compte, afficher son numéro + ses libellés d'exemple, et
  demander de choisir une catégorie parmi : Prestation de service
  (`comptes_vente_service` si côté vente / `comptes_charge_service` si
  côté charge — à déduire du contexte, ou demander explicitement),
  Compte d'équipement (`comptes_equipement`), Sous-traitance/carburant
  (`comptes_carburant`), ou "Aucune de celles-là" (ignorer, ne rien
  ajouter).
- Chaque choix "catégorie" déclenche `POST /dossiers/:id/conventions`
  (route existante, `ajouterConventionManuelle`) avec la bonne `cle` et le
  compte ajouté à la liste, puis confirmation (`POST /conventions/:id/confirmer`,
  route existante).
- **Pas de présélection IA pour l'instant** — dépend d'un chantier séparé
  (premier appel Mistral réel, pas construit). Le popup présente les
  comptes nus, sans suggestion, jusqu'à ce que ce chantier soit fait.
- Permettre de fermer le popup sans tout traiter (les comptes non traités
  réapparaîtront au prochain cycle).

## 6. Écran "Paramètres dossier" — vue et correction de toutes les décisions validées
Nouvelle section dans Paramètres dossier, distincte de ce qui existe déjà :
- **Confiance des tiers** : liste de tous les tiers (`GET /dossiers/:id/tiers`,
  route déjà existante), avec un badge de couleur par niveau
  (`niveau_confiance` : nouveau/à surveiller/confiance) — actuellement
  invisible dans l'interface malgré la jauge agrégée qui existe. Chaque
  ligne permet de corriger manuellement le niveau
  (`POST /dossiers/:id/tiers/corriger`, nouvelle route).
- **Conventions de comptes** : pour chaque compte confirmé dans une des 4
  listes, un bouton de suppression individuelle
  (`POST /conventions/retirer-compte`, nouvelle route, body
  `{dossierId, cle, compte, utilisateurId}`) — retire ce compte précis
  sans toucher au reste de la liste.
- **Taux historique / taux assigné** : possibilité de rejeter un taux déjà
  confirmé (`POST /taux-historique/:id/rejeter` et l'équivalent tiers,
  routes déjà existantes, jamais restreintes aux candidates — juste
  jamais exposées pour une ligne confirmée côté interface jusqu'ici).
- **Taux assigné par compte** (nouveau concept, distinct du taux
  historique) : `GET /dossiers/:id/taux-assignes` /
  `POST /dossiers/:id/taux-assignes` (body `{compte, taux, utilisateurId}`).
  `taux` est une valeur parmi : `'0'`, `'2.1'`, `'5.5'`, `'10'`, `'20'`,
  `'autoliquide_intracom'`, `'autoliquide_20'`, `'autoliquide_10'`,
  `'autoliquide_5.5'`. Assignation directe, un select par compte, pas de
  candidate/confirmed. Prévu pour un futur contrôle de cohérence de fin
  d'exercice (pas encore construit, juste la donnée à ce stade — ne pas
  construire l'écran de contrôle lui-même, seulement la saisie).

## Vérification
Comme toujours : dev server, actions réelles dans le navigateur, pas juste
au build.
