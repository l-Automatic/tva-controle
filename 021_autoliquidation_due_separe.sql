-- ============================================================================
-- 021 : sépare autoliquidation_due en BTP et intracom (10/08, demande de Rami)
-- ============================================================================
-- Nécessaire pour l'onglet Déclaration (CA3) : la ligne 4 (intracom) et les
-- "autres opérations imposables" (BTP, art. 283-2 nonies CGI) sont deux
-- cases DIFFÉRENTES du formulaire, alors que jusqu'ici nos deux comptes
-- (compteAutoliquidationDue / compteAutoliquidationDueIntracom) versaient
-- dans la MÊME catégorie interne 'autoliquidation_due' — un choix
-- volontaire à l'époque (le résultat net ne change pas, dû et déductible
-- s'annulent identiquement quelle que soit la famille), mais insuffisant
-- maintenant qu'on veut afficher chaque ligne séparément.
--
-- Le déductible, lui, RESTE fusionné (confirmé par Rami) — 44566 +
-- 445662 + 445664 vont tous à la même ligne 20/8 de la déclaration, aucune
-- raison de les séparer. Seul le dû est scindé ici.

ALTER TABLE calculs_tva_lignes DROP CONSTRAINT calculs_tva_lignes_categorie_check;
ALTER TABLE calculs_tva_lignes ADD CONSTRAINT calculs_tva_lignes_categorie_check
    CHECK (categorie IN (
        'collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1',
        'deductible_abs', 'deductible_immo',
        'autoliquidation_due_btp', 'autoliquidation_due_intracom', 'autoliquidation_deductible',
        'ajustement_encaissement_partiel'
    ));
