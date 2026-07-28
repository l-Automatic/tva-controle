-- ============================================================================
-- 006 : statut `rejete` sur `calculs_tva`
-- ============================================================================
-- Permet de rejeter un calcul en brouillon issu d'une erreur de saisie
-- (ex : mauvaise période), sans le supprimer (pas de DELETE possible sur
-- cette table, choix délibéré — cf. 005 pour le même raisonnement côté
-- anomalies). Reste visible dans l'historique avec un badge distinct plutôt
-- que de disparaître silencieusement.

ALTER TABLE calculs_tva DROP CONSTRAINT calculs_tva_statut_check;
ALTER TABLE calculs_tva ADD CONSTRAINT calculs_tva_statut_check
    CHECK (statut IN ('brouillon', 'valide', 'declare', 'rejete'));
