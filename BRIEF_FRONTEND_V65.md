# Brief frontend v65 — rapprochement paiement achat : investigation finale avec données réelles

## Contexte
Ce bug remonte pour la quatrième fois avec un symptôme identique :
dans le popup portes obligatoires, l'onglet "rapprochements paiement
achat" n'affiche d'abord que le rapprochement hôtel, puis — après une
"actualisation" qui se déclenche seule — plus rien d'autre n'apparaît,
alors que Rami confirme qu'il existe bien d'autres factures
fournisseurs partiellement payées sur ce dossier.

Deux correctifs substantiels ont déjà été tentés sans succès visible
côté utilisateur :
- Backend : `preparerRapprochementsPaiementAchat` regroupe désormais
  tous les comptes tiers en un seul appel Pennylane au lieu d'un par
  facture (commit `9e215e9`)
- Frontend : un `setTimeout(0)` corrige une double exécution réelle
  causée par React StrictMode (commit `d53d419`)

Aucun des deux n'a résolu le symptôme observé par Rami en conditions
réelles.

## Ce qui est différent cette fois — données réelles disponibles

Le dossier **"Electricien Sandbox Reel"** (nom exact en base) est
connecté à un vrai jeton Pennylane sandbox, fonctionnel — utilisé tout
au long de ce projet pour des vérifications en conditions réelles
authentiques, pas des données interceptées côté navigateur. Merci de
tester le scénario exact **sur ce dossier précis, avec de vrais appels
réseau de bout en bout** — jamais d'interception/simulation pour
cette investigation, contrairement aux vérifications précédentes qui
n'avaient pas cet accès.

Si le dossier a besoin d'être remis à zéro pour reproduire l'état
initial (aucune catégorisation, aucun rapprochement déjà traité) :

```sql
ALTER TABLE calculs_tva_lignes DISABLE TRIGGER ALL;
DELETE FROM audit_log WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM conventions_dossier WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM immobilisations WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM rapprochements_paiement_achat WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM tiers_reference WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM taux_historique WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM taux_historique_tiers WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM taux_assigne_compte WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM anomalies WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM calculs_tva WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
DELETE FROM ecritures_verifiees WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom = 'Electricien Sandbox Reel');
ALTER TABLE calculs_tva_lignes ENABLE TRIGGER ALL;
```

## Ce qui est demandé — même rigueur que le v60, jusqu'au bout

1. Reproduire le scénario exact sur ce dossier réel : catégoriser,
   confirmer les comptes TVA, ouvrir l'onglet rapprochements paiement
   achat.
2. Instrumenter réellement les appels réseau (comme au v63) — mais
   cette fois avec de VRAIES réponses Pennylane, pas simulées.
   Comparer précisément : combien de rapprochements le **backend**
   renvoie réellement (vérifiable directement en base ou par un appel
   direct à la route), contre combien le **frontend** affiche
   effectivement.
3. Si le backend renvoie tout mais que le frontend n'affiche qu'une
   partie : c'est un problème de traitement de la réponse ou de
   gestion d'état côté frontend — à corriger avec preuve.
4. Si le backend lui-même ne renvoie pas tout (malgré le correctif du
   fetch groupé) : documenter précisément ce qui manque et pourquoi,
   plutôt que de corriger le frontend pour un problème backend.
5. Ne pas proposer de nouveau correctif sans avoir d'abord identifié,
   avec preuve directe (capture réseau, logs, comptage), la cause
   exacte — pas une hypothèse de plus.

## Vérification
Reproduire le scénario sur "Electricien Sandbox Reel" avec de vraies
données, confirmer que **tous** les rapprochements candidats
s'affichent, capture ou log à l'appui montrant le nombre exact reçu du
backend et le nombre exact affiché.
