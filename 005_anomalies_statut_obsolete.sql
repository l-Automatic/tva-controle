-- ============================================================================
-- 005 : statut `obsolete` sur `anomalies`
-- ============================================================================
-- Nécessaire pour dédupliquer les anomalies lors de la relance d'un cycle
-- sur une période déjà contrôlée, sans DELETE (le rôle applicatif n'a
-- volontairement aucun DELETE sur cette table, cf. 002, section 2 : "Aucun
-- DELETE nulle part, sauf calculs_tva_lignes" — préserver la trace d'audit
-- fiscale prime sur la commodité).
--
-- Les anomalies encore 'ouvert' d'un cycle précédent sur la même période
-- passent en 'obsolete' avant réinsertion du nouveau lot, au lieu d'être
-- supprimées. Les anomalies 'resolu'/'justifie' (décision humaine) ne sont
-- jamais touchées.

ALTER TABLE anomalies DROP CONSTRAINT anomalies_statut_check;
ALTER TABLE anomalies ADD CONSTRAINT anomalies_statut_check
    CHECK (statut IN ('ouvert', 'resolu', 'justifie', 'obsolete'));
