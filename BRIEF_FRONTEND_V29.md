# Brief frontend v29 — identité dossier, activation/désactivation, lisibilité

Plusieurs sujets distincts regroupés dans ce brief. Backend prêt pour les
deux premiers ; les deux derniers sont purement visuels.

## 1. Formulaire d'identité complète du dossier
Nouvel écran ou section (Configuration du dossier semble l'endroit
naturel), accessible aux deux rôles (`collaborateur` et `admin_cabinet`) :

- `GET /dossiers/:dossierId/complet` charge tous les champs :
  `{id, nom, nomCommercial, siren, siret, formeJuridique, fiscalite,
  comptabilite, dateDebutExercice, dateFinExercice, regimeTva,
  periodiciteDeclaration, tvaEncaissement, numeroTvaIntracom, adresse,
  ville, codePostal, codeNaf, emailContact, contactNom, contactTelephone,
  logicielSource, statut, motifDesactivation}`.
- Les champs déjà remplis par la synchronisation Pennylane (nom,
  nomCommercial, siren, adresse, ville, codePostal, codeNaf) : afficher en
  lecture seule ou clairement indiquer leur origine — ne pas laisser
  penser qu'ils viennent d'une saisie manuelle.
- Les champs à saisir manuellement, sous forme de formulaire :
  - SIRET (texte)
  - Forme juridique (texte libre ou select avec les formes courantes :
    EI, EURL, SARL, SAS, SASU, SA — au choix)
  - Fiscalité : select IS / IR
  - Comptabilité : select Engagement / Trésorerie
  - Date début exercice / Date fin exercice (deux champs date)
  - Numéro de TVA intracommunautaire (texte)
  - Email de contact, Nom du contact, Téléphone du contact
- Enregistrer envoie uniquement les champs modifiés à
  `PUT /dossiers/:dossierId/identite` (body : n'importe quel sous-ensemble
  des champs ci-dessus, seuls les champs envoyés sont modifiés côté
  backend).

## 2. Activation / désactivation d'un dossier, avec motif (admin_cabinet uniquement)
Nouvelle section dans Paramètres du cabinet : liste de tous les dossiers
du cabinet (`GET /dossiers`, sans filtre statut pour voir les trois états)
avec, pour chaque dossier, un bouton ou toggle actif/inactif.

Au moment de désactiver : demander un motif en texte libre (pas
obligatoire, mais fortement encouragé — placeholder du type "Pourquoi
désactiver ce dossier ?"). Appelle `POST /dossiers/:dossierId/statut` avec
`{statut: 'inactif', motifDesactivation: '...'}`.

Pour réactiver : même route avec `{statut: 'actif'}` (pas de motif
nécessaire, il est effacé automatiquement côté backend).

Afficher le motif quelque part visible pour un dossier déjà inactif
(info-bulle sur le badge de statut, ou ligne dépliée — au choix).

## 3. Menus déroulants pour les longues listes
Partout où une liste peut devenir longue (anomalies, tiers de confiance
dans Configuration du dossier, toute autre liste comparable) : passer à un
motif accordéon — un titre/en-tête cliquable qui déplie le contenu, plutôt
qu'une liste toujours entièrement affichée. Pas de comportement figé
imposé (replié par défaut ou déplié par défaut) — utilise ton jugement
selon ce qui semble le plus lisible à chaque endroit.

## 4. Corrige le centrage des onglets (régression)
Le correctif du bouton "Se connecter" (centré) a aussi centré, par erreur,
le texte des onglets du menu latéral (Cycle, Configuration du dossier,
Historique, Paramètres, Utilisateurs). Ces onglets doivent rester alignés
à gauche comme avant — seul le texte du bouton "Se connecter" doit rester
centré.

## Vérification
Comme toujours : dev server, actions réelles. Remplir et enregistrer
l'identité d'un dossier, vérifier la persistance après rechargement.
Désactiver un dossier avec un motif, vérifier qu'il n'apparaît plus dans
les listes filtrées sur `actif`, le réactiver. Vérifier qu'un compte
`collaborateur` a accès à l'identité dossier mais pas à
l'activation/désactivation. Vérifier visuellement l'alignement des
onglets et le comportement des nouveaux menus déroulants.
