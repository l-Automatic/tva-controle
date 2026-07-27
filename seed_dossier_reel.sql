-- ============================================================================
-- SEED DOSSIER RÉEL — électricien sandbox Pennylane
-- ============================================================================
-- À exécuter UNE FOIS, en tant que rôle pennylane_tva_provisioning, sur la
-- base réellement utilisée par l'API en dev (tva_orchestrateur_test par
-- défaut). Contrairement aux tests, ces lignes ne sont PAS nettoyées après
-- coup — c'est volontaire, c'est un dossier persistant.
--
-- external_company_id : purement informatif, n'est jamais utilisé pour
-- sélectionner l'entreprise côté Pennylane (c'est le token qui détermine
-- l'entreprise, confirmé dès le début du projet) — une valeur libre suffit.
-- ============================================================================

BEGIN;

SELECT provisioning_create_cabinet('Cabinet Réel Test') AS cabinet_id \gset
SELECT set_config('app.current_cabinet_id', :'cabinet_id', true);

INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
VALUES (:'cabinet_id', 'Electricien Sandbox Reel', 'reel_normal', 'pennylane', 'sandbox-electricien-reel', true)
RETURNING id AS dossier_id \gset

INSERT INTO utilisateurs (cabinet_id, nom, email, role)
VALUES (:'cabinet_id', 'Toi', 'toi@cabinet-test.fr', 'expert_comptable')
RETURNING id AS utilisateur_id \gset

-- Conventions confirmées — valeurs déjà établies au fil du projet sur ce
-- dossier précis (4454/445664 pour l'autoliquidation, 706 pour la vente de
-- service, 611 pour la sous-traitance, 6063/6061 pour équipement/carburant).
-- Ajuste si ta réalité sur ce dossier diffère.
INSERT INTO conventions_dossier (dossier_id, cle, valeur, statut, source) VALUES
  (:'dossier_id', 'compte_tva_due_autoliquidee', '"4454"', 'confirmed', 'saisie_manuelle'),
  (:'dossier_id', 'compte_tva_deductible_autoliquidee', '"445664"', 'confirmed', 'saisie_manuelle'),
  (:'dossier_id', 'comptes_vente_service', '["706"]', 'confirmed', 'saisie_manuelle'),
  (:'dossier_id', 'comptes_charge_service', '["611"]', 'confirmed', 'saisie_manuelle'),
  (:'dossier_id', 'comptes_equipement', '["6063"]', 'confirmed', 'saisie_manuelle'),
  (:'dossier_id', 'comptes_carburant', '["6061"]', 'confirmed', 'saisie_manuelle');

COMMIT;

\echo '--- Identifiants à noter ---'
\echo 'cabinet_id :'
SELECT :'cabinet_id';
\echo 'dossier_id :'
SELECT :'dossier_id';
