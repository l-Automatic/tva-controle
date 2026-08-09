-- ============================================================================
-- 009 : taux_historique_tiers — taux habituel par compte client
-- ============================================================================
-- Chantier B (encaissements clients non lettrés) : `taux_historique` existant
-- suit un taux par compte de PRODUIT/CHARGE (706, 611...), jamais par TIERS.
-- La colonne `tiers_id` sur `taux_historique` existe depuis le schéma
-- initial mais `compte_produit_ou_charge` y est NOT NULL — l'utiliser pour
-- un taux purement tiers casserait l'index unique existant (NULL ne
-- collisionne jamais dans un index unique). Table séparée plutôt que
-- toucher à une contrainte déjà en place ailleurs.
--
-- Même workflow candidate/confirmed/rejected que taux_historique (003) :
-- une proposition détectée automatiquement (onboarding-module3) doit être
-- validée par un humain avant d'influencer un calcul réel.

CREATE TABLE taux_historique_tiers (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id           UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    numero_compte_tiers  TEXT NOT NULL,
    taux_habituel        NUMERIC(4,2) NOT NULL,
    nb_occurrences       INTEGER NOT NULL DEFAULT 1,
    derniere_maj         TIMESTAMPTZ NOT NULL DEFAULT now(),
    statut               TEXT NOT NULL DEFAULT 'candidate'
                             CHECK (statut IN ('candidate', 'confirmed', 'rejected')),
    source               TEXT NOT NULL
                             CHECK (source IN ('onboarding', 'decouverte_continue', 'saisie_manuelle')),
    confirmed_by         UUID REFERENCES utilisateurs(id),
    confirmed_at         TIMESTAMPTZ
);

-- Un seul taux confirmed actif par (dossier, compte tiers) — même règle que
-- taux_historique et conventions_dossier.
CREATE UNIQUE INDEX uq_taux_historique_tiers_confirmed
    ON taux_historique_tiers(dossier_id, numero_compte_tiers) WHERE statut = 'confirmed';

CREATE INDEX idx_taux_historique_tiers_statut ON taux_historique_tiers(dossier_id, statut);

GRANT SELECT, INSERT, UPDATE ON taux_historique_tiers TO pennylane_tva_app;

ALTER TABLE taux_historique_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE taux_historique_tiers FORCE ROW LEVEL SECURITY;

CREATE POLICY isolation_cabinet ON taux_historique_tiers
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));
