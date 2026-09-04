-- ============================================================================
-- 018 : élargit ajustements_calcul.type_montant à deductible_abs et
-- deductible_immo (10/08, demande de Rami)
-- ============================================================================
-- Nécessaire pour le circuit de résolution de
-- immobilisation_potentielle_non_passee : un achat mal classé en charge
-- courante (44566, deductible_abs) qui aurait dû être une immobilisation
-- (44562, deductible_immo) a besoin d'un vrai TRANSFERT entre les deux
-- catégories, pas juste un delta sur le total agrégé (deductible_totale) —
-- le total ne change jamais dans ce cas précis, seule la répartition entre
-- les deux lignes de la déclaration change.

ALTER TABLE ajustements_calcul DROP CONSTRAINT ajustements_calcul_type_montant_check;
ALTER TABLE ajustements_calcul ADD CONSTRAINT ajustements_calcul_type_montant_check
    CHECK (type_montant IN ('collectee_totale', 'deductible_totale', 'deductible_abs', 'deductible_immo'));
