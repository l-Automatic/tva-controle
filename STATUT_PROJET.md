# TVA Contrôle – Statut du projet

> Document de référence pour reprendre le projet dans une nouvelle conversation
> (Claude ou Claude Code). Ce fichier vit dans le dépôt GitHub – c'est la
> source de vérité, pas un zip ni une conversation passée.

## ⚠️ À lire en premier – règle absolue pour toute nouvelle conversation

**Le dépôt GitHub (`https://github.com/l-Automatic/tva-controle`, privé) est
la seule source de vérité. Jamais un zip, jamais une conversation passée.**

Un incident réel s'est produit : une conversation a travaillé plusieurs
heures sur Module 10 à partir d'un zip qui datait d'avant deux correctifs
critiques (route `/cycles`, découverte des comptes via balance). Résultat :
du code à fusionner à la main, du temps perdu, un risque réel de régression
silencieuse. La cause : le zip donné en pièce jointe n'était plus à jour par
rapport au VPS/GitHub au moment où la conversation a commencé à travailler.

**Pour toute nouvelle conversation (Claude ou Claude Code) : cloner ou lire
le dépôt GitHub directement au tout début, avant d'écrire une ligne de code.**
Ne jamais supposer qu'un zip fourni en pièce jointe est à jour – vérifier
contre GitHub systématiquement.

## Objectif du projet

Système de contrôle et calcul automatique de la TVA pour cabinets d'expertise
comptable, connecté à Pennylane, pensé pour être vendu à plusieurs cabinets
(multi-tenant). Porté par Rami, consultant en automatisation/IA pour cabinets
comptables (marque L'Automatic).

**Scope volontairement exclu pour l'instant** : génération de la déclaration
CA3 (Module 8, jugé "anecdotique avec les bonnes infos"), TVA intracom
(complexité DEB/DES/VIES hors scope, mais détectée et bloquée plutôt
qu'ignorée), numérotation de facture par IA (formats trop variables pour du
déterministe, nécessiterait Module 5).

## Architecture – les 10 modules

| # | Module | Statut | Package |
|---|---|---|---|
| 1 | Connecteurs API (Pennylane) | 🟢 | `connector-pennylane` |
| 2 | Mémoire de Dossier (Postgres) | 🟢 | `00X_*.sql` (racine) |
| 3 | Onboarding (découverte déterministe) | 🟢 | `onboarding-module3` |
| 4 | Pré-contrôles Déterministes | 🟢 | `controles-module4` |
| 5 | Résolution par Jugement (LLM) | 🟡 | pas commencé — mais partie déterministe de la tâche 3 (nouveaux tiers) faite dans `controles-module4`/`orchestrateur-module9` |
| 6 | Validation Humaine (backend + frontend) | 🟢 | `api-module6` + `packages/frontend` |
| 7 | Calcul TVA | 🟢 | `calcul-module7` |
| 8 | Génération Déclaration (CA3) | ⬜ | explicitement reporté |
| 9 | Orchestrateur global | 🟢 | `orchestrateur-module9` |
| 10 | Audit & Traçabilité | 🟢 | intégré dans `orchestrateur-module9`/`api-module6`/`frontend` |

**Tests backend** (7 packages testables), `npm test` à la racine — comptes
confirmés individuellement aujourd'hui : `controles-module4` 51,
`calcul-module7` 15, `orchestrateur-module9` 39. Total agrégé pas revérifié
depuis (`api-module6` et `onboarding-module3` non retouchés dans cette
session) — lancer `npm test` à la racine pour le chiffre exact plutôt que de
se fier à un total périmé ici.
Frontend vérifié manuellement en conditions réelles (navigateur, actions
réelles, captures d'écran) par Claude Code – pas de suite automatisée dessus.

Testé en conditions réelles sur le dossier sandbox Pennylane (électricien
fictif) – cycle complet exécuté avec succès : anomalies détectées, calcul
produit (exemple réel obtenu : 3957,05€ de crédit de TVA sur janvier 2025).

## Structure du monorepo

```
tva-controle/
├── 001_schema_initial.sql          – schéma Postgres (tables, RLS, immuabilité)
├── 002_roles_and_privileges.sql    – rôles applicatifs, GRANT/REVOKE précis
├── 003_taux_historique_statut.sql  – workflow candidate/confirmed sur taux_historique
├── 004_anomalies_compte.sql        – colonne compte sur anomalies (Module 10)
├── seed_dossier_reel.sql           – crée un dossier persistant pour tester en réel
├── package.json                    – racine npm workspaces
└── packages/
    ├── core/                    – types pivot partagés (EcritureTvaComplete, Anomalie, ContexteDossier...)
    ├── connector-pennylane/     – Module 1 : appels API Pennylane (Company API v2)
    ├── controles-module4/       – Module 4 : 7 contrôles déterministes
    ├── calcul-module7/          – Module 7 : calcul TVA (fonction pure)
    ├── onboarding-module3/      – Module 3 : découverte autoliquidation/taux
    ├── orchestrateur-module9/   – Module 9 : pipeline + TOUT l'accès Postgres (lecture/écriture/audit)
    ├── api-module6/             – Module 6 backend : API Fastify (anomalies, conventions, taux, calculs, audit, cycles)
    └── frontend/                – Module 6 frontend : React/Vite, construit et maintenu par Claude Code
```

## Décisions structurantes à connaître

- **LLM utilisé le moins possible** : système presque entièrement
  déterministe et testé. Aucune donnée fiscale calculée par un LLM.
- **`candidate`/`confirmed`/`rejected`** : toute proposition automatique
  reste `candidate` tant qu'un humain ne l'a pas validée – jamais de
  confirmation automatique, quel que soit le nombre d'occurrences détectées.
- **Anomalies `bloquant` uniquement si le calcul deviendrait faux** : ex.
  `compte_tva_non_reconnu` (intracom ou autre compte TVA non géré) est
  bloquant – mieux vaut arrêter que produire un chiffre silencieusement faux.
- **Prudence fiscale par défaut** : donnée indéterminée (carburant, nature
  d'opération) – exclue du calcul par défaut, configurable.
- **RLS stricte + rôles Postgres séparés** – jamais de superuser en usage
  applicatif (`pennylane_tva_app`, `_provisioning`, `_readonly`, `_owner`).
- **Immuabilité du calcul validé** – trigger Postgres, aucune modification
  possible après passage en `valide`.
- **Découverte des comptes TVA via la balance (`trial_balance`)**, pas la
  liste brute des comptes existants – Pennylane active par défaut des
  dizaines de sous-comptes TVA par pays jamais utilisés.
- **`orchestrateur-module9` est l'unique propriétaire de l'accès Postgres**
  (lecture ET écriture, y compris l'audit) – `api-module6` est une pure
  couche HTTP par-dessus, jamais de SQL direct dedans.
- **Chaque action humaine et chaque événement système sont tracés dans
  `audit_log`**, dans la même transaction que l'action elle-même (rollback
  conjoint si l'un des deux échoue).

## Bugs réels trouvés en testant (pas en relisant le code)

- `SET LOCAL ... = $1` invalide en Postgres (paramètre bindé) – `set_config()`
- `resolveLedgerAccounts`/`resolveLedgerAccountsByIds` sans pagination – sur
  un vrai dossier, des comptes clients tombaient silencieusement hors de la
  première page, corrompant la base HT du calcul (taux implicites à 100% sur
  des écritures pourtant correctes). Reproduit et corrigé, testé en cassant
  volontairement le fix pour prouver que le test le détecte.
- Distinction à trois voies nécessaire dans les écritures composées
  (`ligneTva` / `lignesTiers` / `autresLignes`), pas juste deux.
- **Aucun DELETE possible sur `anomalies`/`calculs_tva` par le rôle
  applicatif** (choix délibéré, 002 – traçabilité fiscale) : la première
  tentative de fix pour la déduplication des anomalies utilisait `DELETE`,
  a cassé toute la suite de tests en environnement réel avec `permission
  denied`. Corrigé sans DELETE : statut `obsolete` (anomalies) et `UPDATE`
  en place (calcul brouillon). Toujours tester contre la vraie base avec le
  vrai rôle applicatif, pas juste en local avec un rôle superuser.
- **Désynchronisation entre conversations** (celle-ci) – voir avertissement
  en tête de document.

## Ce qui reste en suspens, par urgence

**Fonctionnel, pas juste cosmétique :**
- Le cas 409 (relance sur calcul déjà validé) et le cycle de succès n'ont été
  vérifiés côté frontend que par interception réseau (Playwright, pas de
  vrai token Pennylane disponible pour Claude Code) – à revalider en
  conditions réelles sur le VPS avec un vrai token

**Technique, connu et documenté :**
- Pas d'authentification – header `x-cabinet-id` en clair, stand-in temporaire
- Le token Pennylane est passé en clair dans le corps de la requête HTTP
  (accepté pour l'instant : test en mode sandbox Pennylane `company`, pas
  encore `firm` — à revoir avant tout usage multi-cabinets réel)
- Proxy Vite en dev uniquement – pas déployable tel quel en production (CORS)

**Mis de côté consciemment :**
- Module 5 (LLM) — 2 des 3 tâches restantes : numérotation facture,
  classification véhicule tourisme/utilitaire. La 3ᵉ (nouveau fournisseur à
  risque) a sa partie déterministe faite (détection + `tiers_reference`
  alimentée) ; seul le jugement de risque par LLM reste à faire.
- Paramétrage : la clé Mistral se configure déjà (panneau Paramètres,
  `parametres_cabinet`), mais aucun appel LLM réel n'est câblé dessus —
  aucune des tâches Module 5 ne consomme encore cette clé.
- Module 8 (génération CA3) – cases officielles déjà vérifiées si repris un
  jour (08–20%, 9B–10%, 09–5,5%, T6–2,1%, 19–immo, 20–abs)
- Intracom – détecté (`compte_tva_non_reconnu`, bloquant) mais pas traité

## Comment tester sur le vrai dossier sandbox

1. `seed_dossier_reel.sql` crée un cabinet + dossier persistant avec les
   conventions confirmées (comptes déjà identifiés sur ce dossier précis :
   autoliquidation 4454/445664, vente service 706, charge service 611,
   équipement 6063, carburant 6061)
2. API : `DATABASE_URL="postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test" npm run dev` dans `packages/api-module6`
3. `POST /dossiers/:id/cycles` avec header `x-cabinet-id`, body
   `{periodeDebut, periodeFin, pennylaneToken}` – token Pennylane à
   régénérer avant usage (jamais réutiliser un token déjà collé quelque part)
4. Interface : `http://localhost:5173/`

## Comment travailler avec Rami – manières de faire

- **Communication en français, directe, sans complaisance.** Rami corrige
  activement quand une hypothèse ne colle pas à son expérience terrain –
  c'est pris en compte, pas juste acquiescé.
- **Rigueur non négociable** : jamais deviner un endpoint API ou un
  comportement – vérifier contre de vraies données à chaque fois. Chaque
  correctif doit être prouvé en cassant volontairement le fix pour confirmer
  que le test le détecte réellement, pas seulement qu'il passe.
- **Répartition du travail** : conception + code backend testable – ici
  (Claude, sans interface). Frontend + vérification visuelle – Claude Code
  (VS Code, connecté en Remote-SSH au VPS). Ne pas essayer de faire du
  frontend à l'aveugle ici.
- **Rami découvre le terminal** – donner des commandes complètes,
  copiables-collables en un seul bloc, jamais de `\` de continuation de
  ligne multi-lignes (le terminal VS Code/SSH coupe parfois mal le collé).
  Toujours donner le remplacement exact d'un `<PID>` ou d'un placeholder,
  jamais supposer que "évident" pour nous l'est pour lui à ce stade.
- **Économie de tokens explicitement demandée** : planifier avant d'exécuter,
  éviter les aller-retours évitables, livrer en zip delta (uniquement les
  packages modifiés) plutôt que le monorepo complet à chaque fois.
- **Sécurité** : Rami colle parfois des tokens API en clair dans le chat par
  réflexe – le signaler et lui demander de régénérer systématiquement,
  sans exception, sans jugement.
- **VPS** : `92.113.31.90`, connexion `root@`. Base de test :
  `tva_orchestrateur_test`. Rami utilise VS Code + Remote-SSH + extension
  Claude Code (pas le terminal SSH nu, sauf quand nécessaire).

## Backlog — Module 5 et extensions (pas commencé, pour plus tard)

### Module 5 — nécessite un LLM (déterministe insuffisant), 2 tâches restantes
1. **Motif de numérotation des factures** par dossier — trop de formats
   différents selon les cabinets pour une règle déterministe fiable.
2. **Classification véhicule tourisme/utilitaire** à partir des libellés
   d'immobilisation.

~~3. Nouveau fournisseur à risque~~ — partie déterministe faite (voir
"Nouveaux tiers" ci-dessous). Reste : jugement de risque par LLM sur le nom
du tiers (pattern de fraude, fournisseur fictif...), pas encore câblé.

### Nouveaux tiers — implémenté (partie déterministe)
Fait : `verifierNouveauxTiers` (controles-module4) détecte tout compte
client/fournisseur jamais vu pour ce dossier, anomalie `signale` (pas
bloquante). `synchroniserTiersReference` (orchestrateur-module9) alimente
enfin `tiers_reference` (existait depuis le schéma initial, jamais utilisée) :
progression `nouveau` → `a_surveiller` (3 cycles) → `confiance` (6 cycles),
seuils arbitraires en dur, documentés comme tels — bons candidats pour
devenir un paramètre dossier/cabinet si le besoin se confirme à l'usage.

Pas fait : rien côté frontend pour visualiser la progression de confiance
d'un tiers dans le temps (consultable en base uniquement pour l'instant).
Le jugement de risque par LLM (voir ci-dessus) reste la partie manquante
de la tâche originale.

### Compte 471 (attente) — implémenté
Fait : détection (tout encaissement non lettré sur compte(s) préfixe 471,
paramétrable par dossier via convention `comptes_attente`), anomalie
bloquante, qualification manuelle (`POST /anomalies/:id/qualifier` :
vente+taux ou hors-vente+motif), intégration au calcul de la période une
fois qualifié vente (`integrerRegularisations`, calcul-module7). UI dans
`AnomaliesPanel.tsx`. Distinction automatique vente/hors-vente reste un
jugement humain à chaque fois — le LLM qui pourrait juger sur le libellé
(Module 5) n'est pas construit.

Volontairement pas fait : les encaissements clients (411) sans facture en
face (acomptes, factures non transmises) suivent la même logique métier
mais n'ont pas le même marqueur déterministe qu'un compte d'attente (une
ligne créditrice non lettrée en 471 EST par nature non identifiée ; une
ligne 411 non lettrée peut simplement être une facture impayée normale,
pas un encaissement à qualifier). Pas encore traité — nécessite de
distinguer les deux cas avant de dupliquer le mécanisme.

### Paramétrage par dossier et par cabinet — socle implémenté
Fait : tables `parametres_cabinet`/`parametres_dossier` (migration 008,
clé-valeur, pas de workflow candidate/confirmed — décision directe, pas une
proposition à valider), API GET/PUT, panneau frontend. Sert aujourd'hui à
la clé Mistral (`mistral_api_key`, présence = LLM activé pour ce cabinet,
masquée à l'affichage, jamais tracée en clair dans l'audit — mais stockée
en clair en base, même compromis que le token Pennylane, à revoir avant
tout usage multi-cabinets réel).

Pas fait : aucun contrôle ne lit encore `parametres_dossier` pour se
désactiver. La table existe, l'API existe, le câblage dans le pipeline
(vérifier un paramètre avant de lancer chaque contrôle) reste à faire.

### Véhicules tourisme/utilitaire — arbitrage à faire avant de développer
Deux approches en balance, pas encore tranché :
a. Détection automatique par LLM (Module 5) à partir des libellés
   d'immobilisation, validée ensuite par le collaborateur.
b. Saisie manuelle : le collaborateur liste les immobilisations concernées
   dans un paramètre dédié et coche tourisme/utilitaire lui-même.

Contrainte commune aux deux : immobilisations parfois anciennes, incertitude
sur la capacité des API (Pennylane et autres) à toujours exposer la liste
complète des immos d'un dossier.

### Déductibilité carburant 80 %/100 %
Le contrôle carburant actuel se contente de signaler "parc de véhicules non
renseigné" sans permettre de trancher. À ajouter : un paramètre par dossier
pour choisir 80 % ou 100 % de déductibilité quand le dossier a un mix
tourisme + utilitaire.
