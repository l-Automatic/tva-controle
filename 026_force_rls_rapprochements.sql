-- ============================================================================
-- 026 : corrige un oubli de cohérence — FORCE ROW LEVEL SECURITY manquant
-- sur rapprochements_paiement_achat (trouvé en relisant les 25 migrations
-- avec Rami, 10/08)
-- ============================================================================
-- Toutes les autres tables créées après le schéma initial (008, 009, 010,
-- 012) ont ENABLE + FORCE. Celle-ci n'avait que ENABLE — un oubli lors de
-- la migration 016, jamais un choix volontaire (contrairement à `cabinets`,
-- dont l'absence de FORCE est documentée et nécessaire pour le provisioning).

ALTER TABLE rapprochements_paiement_achat FORCE ROW LEVEL SECURITY;
