# TVA Contrôle – Statut du projet

> Document de référence pour reprendre le projet dans une nouvelle conversation
> (Claude ou Claude Code). Dernière mise à jour : voir dernier commit git.

## Objectif du projet

Système de contrôle et calcul automatique de la TVA pour cabinets d'expertise
comptable, connecté à Pennylane, pensé pour être vendu à plusieurs cabinets
(multi-tenant). Porté par Rami, consultant en automatisation/IA pour cabinets
comptables.

**Scope volontairement exclu pour l'instant** : génération de la déclaration
CA3 (Module 8, jugé "anecdotique avec les bonnes infos"), TVA intracom
(complexité DEB/DES/VIES hors scope), numérotation de facture par IA (mis de
côté, cf. section Décisions).

## Architecture – les 10 modules

| # | Module | Statut | Package |
|---|---|---|---|
| 1 | Connecteurs API (Pennylane) | 🟢 | `connector-pennylane` |
| 2 | Mémoire de Dossier (Postgres) | 🟢 | `001/002/003_*.sql` (racine) |
| 3 | Onboarding (découverte déterministe) | 🟢 | `onboarding-module3` |
| 4 | Pré-contrôles Déterministes | 🟢 | `controles-module4` |
| 5 | Résolution par Jugement (LLM) | ⬜ | pas commencé |
| 6 | Validation Humaine (backend + frontend) | 🟢 backend / 🟡 frontend | `api-module6` + `packages/frontend` (construit par Claude Code, jamais audité par moi) |
| 7 | Calcul TVA | 🟢 | `calcul-module7` |
| 8 | Génération Déclaration (CA3) | ⬜ | explicitement reporté |
| 9 | Orchestrateur global | 🟢 | `orchestrateur-module9` |
| 10 | Audit & Traçabilité | 🟡 | table posée, rien n'écrit dedans |

**112 tests** sur le backend (6 packages testables), `npm test` à la racine du
monorepo. Testé en conditions réelles sur le dossier sandbox Pennylane
(électricien fictif) – un vrai cycle a tourné de bout en bout avec succès.

## Structure du monorepo

```
tva-controle/
├── 001_schema_initial.sql          – schéma Postgres (tables, RLS, immuabilité)
├── 002_roles_and_privileges.sql    – rôles applicatifs, GRANT/REVOKE précis
├── 003_taux_historique_statut.sql  – ajout candidate/confirmed à taux_historique
├── package.json                    – racine npm workspaces
└── packages/
    ├── core/                    – types pivot partagés (EcritureTvaComplete, Anomalie, ContexteDossier...)
    ├── connector-pennylane/     – Module 1 : appels API Pennylane (Company API v2)
    ├── controles-module4/       – Module 4 : 7 contrôles déterministes
    ├── calcul-module7/          – Module 7 : calcul TVA (fonction pure)
    ├── onboarding-module3/      – Module 3 : découverte autoliquidation/taux
    ├── orchestrateur-module9/   – Module 9 : pipeline complet + accès Postgres (lecture ET écriture)
    ├── api-module6/             – Module 6 backend : API Fastify
    └── frontend/                – Module 6 frontend : React/Vite (construit par Claude Code)
```

**Dépôt GitHub** : `https://github.com/l-Automatic/tva-controle` (privé).
Claude Code est la source de vérité git – les sessions Claude (ce chat) livrent
des mises à jour en zip delta, à committer via Claude Code après vérification.

## Décisions structurantes à connaître

- **LLM utilisé le moins possible** : le système est presque entièrement
  déterministe et testé. Aucune donnée fiscale n'est calculée par un LLM.
- **`candidate`/`confirmed`/`rejected`** : toute proposition automatique
  (conventions de dossier, taux historique) reste `candidate` tant qu'un
  humain ne l'a pas validée – jamais de confirmation automatique.
- **Anomalies toujours `signale` sauf si le calcul deviendrait faux** : un
  compte TVA non reconnu (`compte_tva_non_reconnu`) est `bloquant` – le
  calcul refuse de tourner plutôt que d'ignorer silencieusement une vraie
  TVA sur un compte non géré (ex: intracom).
- **Prudence fiscale par défaut** : carburant/déductibilité indéterminée –
  exclu du calcul par défaut (`politiqueIndetermine: 'exclure'`),
  configurable.
- **RLS stricte + rôles Postgres séparés** (`pennylane_tva_app`,
  `pennylane_tva_provisioning`, `pennylane_tva_readonly`, `pennylane_tva_owner`)
  – jamais de superuser en usage applicatif.
- **Immuabilité du calcul validé** : un calcul passé en `valide` ne peut plus
  être modifié (trigger Postgres), seule la transition vers `declare` est
  permise.
- **Découverte des comptes TVA via la balance (`trial_balance`), pas via la
  liste brute des comptes** – Pennylane active par défaut des dizaines de
  sous-comptes TVA par pays jamais utilisés ; ne garder que ceux à solde
  non-nul sur la période évite ce bruit.

## Bugs réels trouvés en testant (pas en relisant le code)

- `SET LOCAL ... = $1` invalide en Postgres (paramètre bindé) – `set_config()`
- Deux fonctions du connecteur (`resolveLedgerAccounts`,
  `resolveLedgerAccountsByIds`) sans pagination – sur un vrai dossier avec
  ~30 pièces, des comptes clients tombaient silencieusement hors de la
  première page, corrompant le calcul de base HT (taux implicites à 100%
  sur des écritures pourtant correctes). Corrigé, testé en cassant
  volontairement le fix pour prouver que le test le détecte.
- Distinction à trois voies nécessaire dans les écritures composées
  (`ligneTva` / `lignesTiers` / `autresLignes`) – pas juste deux.

## Ce qui reste en suspens, par urgence

**Fonctionnel, pas juste cosmétique :**
- Module 10 (audit) jamais branché – aucune trace de qui a validé/rejeté quoi
- Pas de déduplication des anomalies – relancer un cycle sur une période déjà
  calculée échoue sur une contrainte d'unicité plutôt que d'écraser (voulu,
  mais implique un nettoyage SQL manuel si on veut retester)
- Le frontend (construit par Claude Code) ne couvre que anomalies/conventions
  génériques – pas d'interface dédiée pour les 4 conventions de comptes
  (vente/charge service, équipement, carburant) ni pour déclencher un cycle
  (existe seulement en HTTP direct, `POST /dossiers/:id/cycles`)

**Technique, connu et documenté :**
- Pas d'authentification – header `x-cabinet-id` en clair, stand-in temporaire
- Le token Pennylane est passé en clair dans le corps de la requête HTTP
  (pas de résolution via secret manager / `connexions_api`)
- Proxy Vite en dev uniquement – pas déployable tel quel en production (CORS)

**Mis de côté consciemment :**
- Module 5 (LLM) – numérotation facture (jugée trop variable pour du
  déterministe), classification véhicule, lecture OCR
- Module 8 (génération CA3) – cases CA3 déjà vérifiées officiellement
  (08–20%, 9B–10%, 09–5,5%, T6–2,1%, 19–immo, 20–abs) si repris un jour
- Intracom – détecté (`compte_tva_non_reconnu`) mais pas traité

## Comment tester sur le vrai dossier sandbox

1. `seed_dossier_reel.sql` (racine du repo) crée un cabinet + dossier persistant
   avec les conventions confirmées (comptes réels déjà identifiés :
   autoliquidation 4454/445664, vente service 706, charge service 611,
   équipement 6063, carburant 6061)
2. Lancer l'API : `DATABASE_URL="postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test" npm run dev` dans `packages/api-module6`
3. `POST /dossiers/:id/cycles` avec `x-cabinet-id` en header, body
   `{periodeDebut, periodeFin, pennylaneToken}` – déclenche un vrai cycle,
   persiste tout en base
4. Interface de validation : `http://localhost:5173/`

## Suggestions pour la suite (par ordre de priorité probable)

1. **Module 10 (audit)** – se branche sur ce qui existe déjà, comble un vrai
   manque de conformité
2. **Interface frontend pour les 4 conventions de comptes** – sans ça, un
   nouveau dossier ne peut pas être configuré via l'UI
3. **Déclenchement de cycle depuis le frontend** (bouton qui appelle
   `POST /dossiers/:id/cycles`)
4. **Module 5 (LLM)** – si on veut débloquer numérotation facture,
   classification véhicule
