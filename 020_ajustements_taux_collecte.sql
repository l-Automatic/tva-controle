-- ============================================================================
-- 020 : élargit ajustements_calcul.type_montant aux quatre taux de collecte
-- individuels (10/08, demande de Rami)
-- ============================================================================
-- Nécessaire pour corriger le taux appliqué sur UN encaissement précis
-- (encaissement_client_taux_applique) sans jamais réécrire une règle
-- générale pour tout le compte client — un seul encaissement n'est pas une
-- base suffisante pour ça (demande explicite de Rami). Transfert entre
-- deux catégories de taux (ex: collectee_20 -> collectee_10), le total
-- collecte change du montant réel de la différence de taux.

ALTER TABLE ajustements_calcul DROP CONSTRAINT ajustements_calcul_type_montant_check;
ALTER TABLE ajustements_calcul ADD CONSTRAINT ajustements_calcul_type_montant_check
    CHECK (type_montant IN (
        'collectee_totale', 'deductible_totale', 'deductible_abs', 'deductible_immo',
        'collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1'
    ));
