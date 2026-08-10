# TVA Contrôle – Statut du projet

> Document de référence pour reprendre le projet dans une nouvelle conversation
> (Claude ou Claude Code). Ce fichier vit dans le dépôt GitHub – c'est la
> source de vérité, pas un zip ni une conversation passée.

## ⚠️ À lire en premier – règle absolue pour toute nouvelle conversation

**Le dépôt GitHub (`https://github.com/l-Automatic/tva-controle`, privé) est
la seule source de vérité. Jamais un zip, jamais une conversation passée.**

Un incident réel s'est produit : une conversation a travaillé plusieurs
heures sur Module 10 à partir d'un zip qui datait d'avant deux correctifs
critiques. Résultat : du code à fusionner à la main, du temps perdu.

**Pour toute nouvelle conversation (Claude ou Claude Code) : cloner ou lire
le dépôt GitHub directement au tout début, avant d'écrire une ligne de code.**
Vérifier aussi que le token GitHub utilisé a bien les droits d'écriture
(Contents: Read and write) avant de commencer à coder — sinon les push
échouent silencieusement en apparence de succès partiel.

## Objectif du projet

Système de contrôle et calcul automatique de la TVA pour cabinets d'expertise
comptable, connecté à Pennylane, pensé pour être vendu à plusieurs cabinets
(multi-tenant). Porté par Rami, consultant en automatisation/IA pour cabinets
comptables (marque L'Automatic).

**Scope volontairement exclu pour l'instant** : génération de la déclaration
CA3 (Module 8), TVA intracom (détectée et bloquée, pas traitée).

## Architecture – les 10 modules

| # | Module | Statut | Package |
|---|---|---|---|
| 1 | Connecteurs API (Pennylane) | 🟢 | `connector-pennylane` |
| 2 | Mémoire de Dossier (Postgres) | 🟢 | `00X_*.sql` (racine, jusqu'à 008) |
| 3 | Onboarding (découverte déterministe) | 🟢 | `onboarding-module3` |
| 4 | Pré-contrôles Déterministes | 🟢 | `controles-module4` |
| 5 | Résolution par Jugement (LLM) | 🔴 | **aucun appel LLM réel nulle part** — voir section dédiée |
| 6 | Validation Humaine (backend + frontend) | 🟢 | `api-module6` + `packages/frontend` |
| 7 | Calcul TVA | 🟢 | `calcul-module7` |
| 8 | Génération Déclaration (CA3) | ⬜ | explicitement reporté |
| 9 | Orchestrateur global | 🟢 | `orchestrateur-module9` |
| 10 | Audit & Traçabilité | 🟢 | intégré dans `orchestrateur-module9`/`api-module6`/`frontend` |

**Tests backend** : lancer `npm test` à la racine pour le chiffre exact —
plusieurs allers-retours de construction/retrait (correction par solde
fournisseur, testée puis abandonnée) rendent un total figé ici peu fiable.
Tester package par package si besoin de diagnostiquer :
`controles-module4`, `calcul-module7`, `orchestrateur-module9`,
`connector-pennylane`, `api-module6`, `onboarding-module3`, `core`.

Frontend vérifié manuellement en conditions réelles (navigateur, actions
réelles) par Claude Code — pas de suite automatisée dessus.

Testé en conditions réelles sur le dossier sandbox Pennylane (électricien
fictif) à plusieurs reprises — cycle complet exécuté avec succès après
correction de plusieurs bugs de calcul réels (voir plus bas).

## ⚠️ Mistral / LLM : le champ existe, l'usage n'existe pas

Le panneau Paramètres permet de saisir une clé API Mistral, stockée dans
`parametres_cabinet`, masquée à l'affichage. **C'est tout.** Aucun code,
nulle part dans le projet, n'appelle l'API Mistral. Le champ ne "active"
rien de fonctionnel — c'est un formulaire de configuration sans
consommateur pour l'instant. Avant que le module 5 (numérotation facture,
véhicules, fournisseur à risque) ou le prorata de paiement partiel (voir
plus bas) puissent fonctionner, il faudra construire ce premier vrai appel
LLM : prompt, parsing de la réponse, gestion d'erreur, et — comme partout
ailleurs dans ce projet — jamais d'application automatique d'un jugement
IA sur un chiffre fiscal sans confirmation humaine explicite.

## Structure du monorepo

```
tva-controle/
├── 001_schema_initial.sql          – schéma Postgres (tables, RLS, immuabilité)
├── 002_roles_and_privileges.sql    – rôles applicatifs, GRANT/REVOKE précis
├── 003_taux_historique_statut.sql  – workflow candidate/confirmed sur taux_historique
├── 004_anomalies_compte.sql        – colonne compte sur anomalies (Module 10)
├── 005_anomalies_statut_obsolete.sql – statut obsolete (dédup anomalies)
├── 006_calcul_rejete.sql           – statut rejete sur calculs_tva
├── 007_anomalies_resolution.sql    – colonne resolution structurée (471)
├── 008_parametrage.sql             – parametres_cabinet / parametres_dossier
├── seed_dossier_reel.sql           – crée un dossier persistant pour tester en réel
├── package.json                    – racine npm workspaces
└── packages/
    ├── core/                    – types pivot partagés (EcritureTvaComplete, Anomalie, ContexteDossier...)
    ├── connector-pennylane/     – Module 1 : appels API Pennylane (Company API v2)
    ├── controles-module4/       – Module 4 : contrôles déterministes
    ├── calcul-module7/          – Module 7 : calcul TVA (fonction pure)
    ├── onboarding-module3/      – Module 3 : découverte autoliquidation/taux
    ├── orchestrateur-module9/   – Module 9 : pipeline + TOUT l'accès Postgres (lecture/écriture/audit)
    ├── api-module6/             – Module 6 backend : API Fastify
    └── frontend/                – Module 6 frontend : React/Vite, construit et maintenu par Claude Code
```

## Décisions structurantes à connaître

- **LLM utilisé le moins possible, et jamais pour trancher seul un chiffre
  fiscal** : détection déterministe + jugement LLM (à construire) +
  confirmation humaine obligatoire avant tout impact sur le calcul.
- **`candidate`/`confirmed`/`rejected`** : toute proposition automatique
  reste `candidate` tant qu'un humain ne l'a pas validée.
- **Anomalies `bloquant` uniquement si le calcul deviendrait faux.**
- **Prudence fiscale par défaut** : donnée indéterminée exclue du calcul par défaut.
- **RLS stricte + `FORCE ROW LEVEL SECURITY` sur TOUTE table sensible** —
  y compris les tables ajoutées après coup (oubli réel une fois sur la
  migration 008, corrigé, cf. bugs plus bas). Seule exception délibérée :
  `cabinets` (fonction SECURITY DEFINER de provisioning).
- **Immuabilité du calcul validé** – trigger Postgres, aucune modification
  possible après passage en `valide`. Un calcul `rejete` (erreur de saisie)
  redevient `brouillon` si le cycle est relancé sur la même période.
- **Aucun DELETE nulle part** sauf `calculs_tva_lignes` tant que le calcul
  est en `brouillon` — remplacer par un `UPDATE` de statut (`obsolete`,
  `rejete`) ou un `UPSERT`, jamais un `DELETE` applicatif.
- **`orchestrateur-module9` est l'unique propriétaire de l'accès Postgres.**
- **Chaque action humaine et chaque événement système sont tracés dans
  `audit_log`**, dans la même transaction que l'action — sauf les secrets
  eux-mêmes : une clé API modifiée est tracée par son nom, jamais sa valeur.
- **`conventions_dossier` (comptes vente/charge/équipement/carburant,
  comptes d'autoliquidation) n'est PAS une donnée de cycle** — ne jamais
  l'inclure dans une purge de test entre deux essais. Contrairement à
  `anomalies`/`calculs_tva`/`tiers_reference`, c'est une configuration
  durable du dossier ; la vider casse le calcul au lieu de le nettoyer
  (vécu : deux fois de suite dans la même session).

## Bugs réels trouvés en testant (pas en relisant le code)

Liste chronologique, la plus longue section de ce document — presque tous
trouvés en conditions réelles sur le dossier sandbox, pas en review de code :

- `SET LOCAL ... = $1` invalide en Postgres (paramètre bindé) – `set_config()`
- `resolveLedgerAccounts`/`resolveLedgerAccountsByIds` sans pagination –
  comptes clients tombant silencieusement hors de la première page.
- Distinction à trois voies nécessaire dans les écritures composées
  (`ligneTva` / `lignesTiers` / `autresLignes`), pas juste deux.
- **`DELETE` interdit par le rôle applicatif** – première tentative de fix
  de dédup des anomalies utilisait `DELETE`, cassé en conditions réelles
  (`permission denied`). Corrigé sans DELETE (statut `obsolete`/`UPDATE`).
- **`FORCE ROW LEVEL SECURITY` manquant sur la migration 008** –
  `parametres_cabinet`/`parametres_dossier` créées sans cette protection,
  alors que c'est la politique systématique du projet. Corrigé avant
  qu'un secret (clé Mistral) n'y transite en conditions réelles.
- **`ajouterConventionManuelle` écrasait au lieu de compléter** – ajouter
  un second lot de comptes séparément (ex: 706 puis 611) à une clé de type
  liste écrasait silencieusement le premier lot, parce que
  `confirmerConvention` rejette la ligne `confirmed` précédente à chaque
  nouvelle confirmation (comportement voulu pour les clés scalaires,
  cassant pour les listes). Corrigé : fusion avec la liste déjà confirmée
  avant insertion d'une nouvelle candidate.
- **Autoliquidation : mauvais montant pris en compte.** Le code utilisait
  le montant brut porté sur les comptes 4454/445664 comme s'il s'agissait
  déjà de la TVA, alors que c'est un TTC-équivalent (facture du fournisseur
  étranger). Corrigé : `TVA = montant - montant/(1+taux/100)`, soit
  `montant/6` à 20% (confirmé avec Rami), pas `montant/5`.
- **Avoirs comptés en plus au lieu d'en moins.** `Math.abs(credit - debit)`
  détruisait le signe : un avoir (débit sur un compte de TVA collectée, ou
  crédit sur un compte de TVA déductible) s'additionnait au lieu de se
  soustraire. Corrigé : deux nets signés distincts selon le sens normal du
  compte (crédit pour collecte/autoliquidation due, débit pour
  déductible/autoliquidation déductible), plus de valeur absolue en amont.
- **`qualifierEncaissementNonAffecte` sans garde-fou de statut** (trouvé
  par Claude Code) – une anomalie 471 déjà qualifiée pouvait être
  re-qualifiée silencieusement, écrasant la première décision. Corrigé
  (`AnomalieNonQualifiableError`), testé par une vraie course concurrente.
- **Faux positif "compte non reconnu" / "tout classé Bien" — deux fois** :
  cause racine identique les deux fois, une commande de purge de test
  (`TRUNCATE ... conventions_dossier ...`) donnée par erreur, qui a effacé
  les conventions déjà confirmées (autoliquidation, puis vente/charge
  service). Voir décision structurante ci-dessus — ne plus jamais inclure
  `conventions_dossier` dans une remise à zéro entre deux tests.
- **Désynchronisation entre conversations** (celle-ci) – voir avertissement
  en tête de document.

## Chantier en cours — prorata de TVA déductible sur paiement partiel

Contexte fiscal confirmé par Rami après recherche : un service payé
partiellement ouvre droit à déduction de la TVA **au prorata du montant
payé** (ex : facture 1200€ TTC/1000€ HT/200€ TVA, payée à 600€ → 100€ de
TVA déductible), contrairement à l'hypothèse initiale du projet qui
excluait tout ou rien selon le lettrage.

**Piège identifié à ne pas rater** : un paiement non lettré face à une
facture peut être (a) un vrai paiement partiel (rare, prorata légitime),
(b) un acompte sur une facture pas encore reçue (aucun droit à déduction),
ou (c) une facture simplement pas encore transmise par le client du
cabinet (statu quo, rien à trancher). Confondre (a) avec (b) ouvrirait un
droit à déduction indu. Distinction envisagée : le libellé du mouvement en
banque/tiers contient souvent une info exploitable par un LLM (Mistral) ;
un montant "rond" est un indice secondaire, jugé trop fragile seul.

**Fait aujourd'hui (groundwork uniquement)** :
- `fetchLignesGroupeLettrage` (`connector-pennylane`) : récupère le détail
  complet (montant, compte, libellé, date) de chaque ligne d'un groupe de
  lettrage. Avant ça, seuls les ids du groupe étaient connus
  (`Lettrage.groupeIds`), jamais leurs montants — impossible de calculer un
  prorata sans ça. Testé, isolé, **pas encore appelé nulle part**.

**Pas fait** :
1. Détection déterministe des candidats (paiement non lettré face à une
   facture plus ancienne/plus grosse sur le même compte).
2. Premier vrai appel Mistral du projet (jugement sur le libellé).
3. Confirmation humaine structurée (sur le modèle de la qualification 471 :
   anomalie → décision humaine → impact sur le calcul).
4. Calcul du prorata et intégration au résultat.

**Tentative abandonnée à ne pas reproduire** : une approche "correction en
bloc par solde fournisseur" (retirer la TVA correspondant au solde impayé
en fin de période, en une fois, plutôt que facture par facture) a été
entièrement construite puis **retirée** dans cette même session — le
mécanisme de lettrage ligne à ligne existant (`exigibilite.ts`) a été
restauré tel quel. Rami avait d'abord proposé le solde par souci de
simplicité, puis s'est renseigné et a confirmé que le droit fiscal exige
un prorata précis, pas une approximation par solde. Le code de cette
tentative n'existe plus (supprimé, pas juste désactivé) — consultable dans
l'historique Git si jamais utile (commits autour du 04/08, chercher
"solde fournisseur").

## Chantier B — implémenté : collecte sur encaissements clients non lettrés

Distinct du chantier ci-dessus (celui-ci concerne la **collecte**, pas la
déductible). Principe confirmé par Rami : par prudence fiscale (droit de
l'État), un encaissement client non lettré doit générer de la TVA collectée
même sans facture en face.

**Fait** :
- `detecterEncaissementsClientAAffecter` (controles-module4) : détecte tout
  encaissement (crédit) non lettré sur un compte client (411xxx, découverte
  automatique par préfixe comme pour le 471), applique directement un taux
  — historique confirmé du client si connu et mono-taux, sinon 20% par
  prudence. Contrairement au 471, **pas de blocage** : le défaut s'applique
  tout de suite, une anomalie `signale` (non bloquante) trace la décision.
- `taux_historique_tiers` (migration 009) + `analyserTauxHistoriqueParTiers`
  (onboarding-module3) : construit le taux historique par compte client à
  partir des factures déjà lettrées (seuil : 3 occurrences). Fusionné dans
  `ContexteDossier.tauxHistorique` (même tableau que les taux par compte
  produit/charge — le champ `compteOuTiers` anticipait déjà ce cas).
- Branché dans `pipeline.ts` : tourne à chaque cycle, propose automatiquement
  les candidats de taux historique (compte produit/charge ET compte client)
  dans le panneau "Taux historique" déjà existant côté frontend — pas de
  nouvelle interface construite, réutilisation de l'écran existant.
- Garde-fou anti-doublon : une proposition de taux n'est faite qu'une seule
  fois par compte, jamais re-proposée à chaque relance de cycle.

**Pas fait** :
- Correction manuelle du taux appliqué par défaut (le collaborateur qui
  veut imposer un autre taux sur un encaissement précis) — seule la
  traçabilité existe, pas encore l'endpoint de correction.
- Taux historique par compte **fournisseur** (401) — pas scopé, n'aurait de
  sens que pour un cas différent (acompte payé à un fournisseur sans
  facture), jamais discuté.
- **Précision utile pour la suite** : `analyserTauxHistorique` (compte
  produit/charge, existait déjà avant ce chantier) ne regroupe PAS par
  compte de charge/produit (706, 607, 611...) malgré son nom — elle
  regroupe par **sous-compte de TVA** (445711, 44566...), c'est un outil de
  cohérence de taux par sous-compte TVA, pas un suivi par compte produit.
  Ne pas confondre les deux quand on regarde le panneau "Taux historique".

## Ce qui reste en suspens, par urgence

**Technique, connu et documenté :**
- Pas d'authentification – header `x-cabinet-id` en clair, stand-in temporaire.
- Le token Pennylane et la clé Mistral sont stockés/transmis en clair —
  accepté en sandbox, à revoir avant tout usage multi-cabinets réel
  (chiffrement au repos ou secrets manager — pas un simple ALTER TABLE,
  question de gestion de la clé de chiffrement elle-même).
- Proxy Vite en dev uniquement – pas déployable tel quel en production (CORS).
- Le cas 409 (relance sur calcul déjà validé) et le cycle de succès du
  panneau Calculs n'ont été vérifiés côté frontend que par interception
  réseau (Playwright), pas avec un vrai token Pennylane.

**Fonctionnel, des trous identifiés mais pas comblés :**
- **Aucun contrôle ne lit `parametres_dossier`** — la table et l'API
  existent (migration 008) mais rien ne consomme les paramètres pour
  désactiver un contrôle par dossier. Plomberie posée, jamais branchée.
- **Aucune catégorisation forcée des comptes avant le premier calcul** —
  un compte de charge/produit mouvementé mais absent des conventions
  (`comptes_vente_service`/`comptes_charge_service`/...) retombe
  silencieusement en "bien" (exigible immédiatement), sans anomalie pour
  le signaler. Vécu concrètement : le compte 604 (sous-traitance) est
  passé entre les mailles deux fois de suite parce que seul 611 était
  configuré. Idée de Rami, pas construite : forcer la catégorisation de
  chaque compte mouvementé (bien / service / sous-traitance autoliquidée /
  carburant) lors du premier onboarding d'un dossier, avant d'autoriser
  un cycle.
- **`tiers_reference` n'est jamais pré-peuplée à l'onboarding** — un
  dossier avec des années d'historique verra TOUS ses fournisseurs/clients
  connus signalés comme "nouveau tiers" dès le premier cycle, noyant le
  collaborateur sous des anomalies non pertinentes. Pas de mécanisme de
  pré-remplissage en masse depuis l'historique Pennylane.
- **Pièces affichées par ID Pennylane brut**, pas par un libellé/numéro
  lisible — un `Pièce : 22495307243520` ne correspond à rien de visible
  dans l'interface Pennylane pour un collaborateur qui voudrait vérifier.
- Aucun affichage frontend de la progression de confiance d'un tiers
  (nouveau → à surveiller → confiance) — consultable en base uniquement.
- `CycleForm` et `AnomaliesPanel` affichent chacun les anomalies d'un
  cycle qui vient de tourner, redondant (deux chemins pour la même info) —
  cosmétique, pas bloquant.

**Mis de côté consciemment (arbitrage à faire avant de coder) :**
- **Véhicules tourisme/utilitaire** : détection auto par LLM + validation,
  ou saisie manuelle par le collaborateur — pas tranché.
- **Déductibilité carburant 80%/100%** : le contrôle signale juste "parc
  non renseigné", pas de paramètre pour choisir le taux quand le dossier
  mixe tourisme et utilitaire.
- **Motif de numérotation des factures** (Module 5) — pas commencé du tout.
- Module 8 (génération CA3) – cases officielles déjà vérifiées si repris
  un jour (08–20%, 9B–10%, 09–5,5%, T6–2,1%, 19–immo, 20–abs).
- Intracom – détecté (`compte_tva_non_reconnu`, bloquant) mais pas traité.
- Encaissements clients (411) sans facture — voir Chantier B ci-dessus.

## Comment tester sur le vrai dossier sandbox

1. `seed_dossier_reel.sql` crée un cabinet + dossier persistant. **Ne pas
   confondre avec une remise à zéro entre deux tests** — pour ça, purger
   uniquement `anomalies`, `calculs_tva`, `calculs_tva_lignes`,
   `tiers_reference`, `audit_log` (jamais `conventions_dossier` ni
   `taux_historique`, qui sont de la configuration durable, pas du cycle).
2. API : `DATABASE_URL="postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test" npm run dev` dans `packages/api-module6`
   — ajouter `DEBUG_CYCLE=1` devant pour un diagnostic détaillé en cas de
   chiffre suspect (dump des statuts d'exigibilité, anomalies, lignes de
   calcul dans le terminal de l'API).
3. Frontend : `npm run dev` dans `packages/frontend`, terminal séparé.
4. `POST /dossiers/:id/cycles` avec header `x-cabinet-id`, body
   `{periodeDebut, periodeFin, pennylaneToken}` – token Pennylane à
   régénérer avant chaque usage.
5. Interface : `http://localhost:5173/` (VPS distant — vérifier le port
   forwarding VS Code, onglet "Ports", `5173` doit être "Forwarded").

## Comment travailler avec Rami – manières de faire

- **Communication en français, directe, sans complaisance.** Rami corrige
  activement quand une hypothèse ne colle pas à son expérience terrain ou
  à ce qu'il a vérifié fiscalement — c'est pris en compte, jamais juste
  acquiescé. Il retourne parfois sur une décision après s'être renseigné
  (ex : solde fournisseur abandonné après vérification du droit fiscal) —
  normal, pas une hésitation à corriger.
- **Rigueur non négociable** : jamais deviner un comportement fiscal ou un
  endpoint API — vérifier contre de vraies données (`DEBUG_CYCLE=1`) à
  chaque chiffre qui semble faux, avant de conclure à un bug ou de coder
  un correctif.
- **Répartition du travail** : conception + code backend testable – ici
  (Claude, sans interface). Frontend + vérification visuelle – Claude Code
  (VS Code, Remote-SSH). Ne pas faire de frontend à l'aveugle ici.
- **Rami découvre le terminal** – commandes complètes, copiables-collables
  en un seul bloc, jamais de `\` de continuation multi-lignes. Toujours
  préciser explicitement lequel des deux terminaux (API / frontend) — il
  ne devine pas tout seul lequel relancer.
- **Économie de tokens explicitement demandée** : planifier avant
  d'exécuter, éviter les aller-retours évitables.
- **Sécurité** : Rami colle parfois des tokens API en clair dans le chat
  par réflexe – le signaler et lui demander de régénérer systématiquement.
- **Avant toute purge/TRUNCATE de test, vérifier explicitement quelles
  tables contiennent de la configuration durable** (conventions, taux
  historique) vs des données de cycle — l'erreur a coûté cher deux fois.
- **VPS** : `92.113.31.90`, connexion `root@`. Base de test :
  `tva_orchestrateur_test`. Rami utilise VS Code + Remote-SSH + extension
  Claude Code.
