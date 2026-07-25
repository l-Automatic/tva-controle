-- ============================================================================
-- 003 — WORKFLOW CANDIDATE/CONFIRMED SUR taux_historique
-- ============================================================================
-- Manque trouvé en construisant Module 6 : contrairement à
-- conventions_dossier et immobilisations, taux_historique n'avait pas de
-- colonne statut — les propositions du Module 3 (analyserTauxHistorique)
-- n'avaient donc nulle part où atterrir en tant que "candidate" en attente
-- de validation humaine. Corrigé ici plutôt que de contourner en Module 6.
-- ============================================================================

ALTER TABLE taux_historique
    ADD COLUMN statut TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (statut IN ('candidate', 'confirmed', 'rejected')),
    ADD COLUMN source TEXT NOT NULL DEFAULT 'saisie_manuelle'
        CHECK (source IN ('onboarding', 'decouverte_continue', 'saisie_manuelle')),
    ADD COLUMN confirmed_by UUID REFERENCES utilisateurs(id),
    ADD COLUMN confirmed_at TIMESTAMPTZ;

-- Défaut 'confirmed' choisi pour ne pas casser les lignes déjà existantes
-- (saisies avant cette migration, considérées fiables) ni les INSERT déjà
-- écrits dans les tests antérieurs qui ne précisaient pas ces colonnes.
-- Les nouvelles propositions du Module 3 devront explicitement passer
-- statut='candidate' à l'insertion.

-- Même règle qu'ailleurs : un seul taux confirmed actif par (dossier, compte).
CREATE UNIQUE INDEX uq_taux_historique_confirmed
    ON taux_historique(dossier_id, compte_produit_ou_charge)
    WHERE statut = 'confirmed';

CREATE INDEX idx_taux_historique_statut ON taux_historique(dossier_id, statut);

-- ============================================================================
-- FIN 003
-- ============================================================================
