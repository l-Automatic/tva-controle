-- ============================================================================
-- 022 : ajoute les 4 catégories base_ht_XX (ligne 3 CA3, 10/08)
-- ============================================================================
-- Réutilise la table calculs_tva_lignes plutôt qu'une structure séparée —
-- même mécanisme de persistance, même lecture via chargerDetailCalcul.
-- Ces 4 catégories sont d'une nature différente des autres (un montant HT,
-- pas un montant de TVA) — un choix pragmatique de réutilisation
-- d'infrastructure, documenté clairement dans le code plutôt qu'une
-- nouvelle table pour un seul besoin.

ALTER TABLE calculs_tva_lignes DROP CONSTRAINT calculs_tva_lignes_categorie_check;
ALTER TABLE calculs_tva_lignes ADD CONSTRAINT calculs_tva_lignes_categorie_check
    CHECK (categorie IN (
        'collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1',
        'deductible_abs', 'deductible_immo',
        'autoliquidation_due_btp', 'autoliquidation_due_intracom', 'autoliquidation_deductible',
        'base_ht_20', 'base_ht_10', 'base_ht_5_5', 'base_ht_2_1',
        'ajustement_encaissement_partiel'
    ));
