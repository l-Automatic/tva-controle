-- ============================================================================
-- 024 : ajoute credit_tva_anterieur (ligne 10 CA3, phase 2, 10/08)
-- ============================================================================

ALTER TABLE calculs_tva_lignes DROP CONSTRAINT calculs_tva_lignes_categorie_check;
ALTER TABLE calculs_tva_lignes ADD CONSTRAINT calculs_tva_lignes_categorie_check
    CHECK (categorie IN (
        'collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1',
        'deductible_abs', 'deductible_immo',
        'autoliquidation_due_btp', 'autoliquidation_due_intracom', 'autoliquidation_deductible',
        'base_ht_20', 'base_ht_10', 'base_ht_5_5', 'base_ht_2_1',
        'base_ht_export', 'base_ht_intracom_exoneree',
        'credit_tva_anterieur',
        'ajustement_encaissement_partiel'
    ));
