# Brief frontend v28 — configuration des dossiers nouvellement découverts

## Contexte
Backend prêt (Phase 2 du chantier API Cabinet) : un dossier synchronisé
depuis Pennylane arrive avec un régime fiscal par défaut ("réel normal",
une hypothèse, jamais une vérité) et reste `statut: 'onboarding'` tant
qu'un humain n'a pas confirmé sa vraie configuration. Ce brief construit
cet écran de confirmation rapide.

## 1. Liste des dossiers en attente de configuration
`GET /dossiers?statut=onboarding` retourne les dossiers du cabinet dans cet
état. Afficher cette liste quelque part visible — probablement à côté du
bouton "Synchroniser les dossiers" (v27), dans le même esprit que le
panneau "À traiter" déjà existant côté dossier. Un dossier configuré
disparaît naturellement de cette liste au prochain appel (son statut passe
à `actif`).

## 2. Formulaire de configuration rapide, par dossier
Pour chaque dossier de la liste, un petit formulaire (inline ou modal, au
choix) avec trois champs :
- **Régime de TVA** : select — Réel normal / Réel simplifié / Franchise en
  base.
- **Périodicité de déclaration** : select — Mensuelle / Trimestrielle.
- **TVA sur encaissement** : case à cocher — coché si le dossier est
  prestataire de services (TVA due à l'encaissement plutôt qu'à la
  facturation).

Au clic sur "Confirmer" (ou équivalent) : appelle
`POST /dossiers/:dossierId/configurer-onboarding` avec
`{regimeTva, periodiciteDeclaration, tvaEncaissement}`. Succès → le
dossier disparaît de la liste des dossiers à configurer, devient
utilisable normalement (visible dans le sélecteur de dossier avec les
autres, cycles possibles).

## 3. Accessible aux deux rôles
Contrairement aux paramètres cabinet et à la synchronisation
(réservés à `admin_cabinet`), cette configuration est **dossier**, pas
**cabinet** — accessible à `collaborateur` comme à `admin_cabinet`, cohérent
avec la distinction déjà établie ailleurs dans l'application.

## Vérification
Comme toujours : dev server, actions réelles. Créer (ou trouver) un
dossier en statut `onboarding`, le configurer via le formulaire, vérifier
qu'il disparaît de la liste et devient normalement sélectionnable/utilisable
ensuite. Vérifier qu'un compte `collaborateur` a bien accès à cet écran.
