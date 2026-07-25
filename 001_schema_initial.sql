-- ============================================================================
-- SCHEMA INITIAL — Système de contrôle et calcul TVA pour cabinets comptables
-- ============================================================================
-- Convention : tables en français (cohérent avec le métier du produit),
-- colonnes techniques en anglais quand elles sont purement structurelles
-- (id, created_at) pour rester lisible par tout outillage standard.
--
-- Choix structurants (voir échanges de conception) :
--   - UUID en clé primaire partout : évite les collisions d'ID entre
--     cabinets si le système devient un jour distribué / partitionné,
--     et évite l'énumérabilité des ID côté API.
--   - Row-Level Security (RLS) activée dès la v1 sur toutes les tables
--     multi-tenant, posée via current_setting('app.current_cabinet_id').
--   - CHECK constraints plutôt que des types ENUM natifs Postgres :
--     les valeurs possibles vont évoluer avec l'usage réel (nouveaux
--     types d'anomalies, nouvelles conventions découvertes...) et
--     ALTER TYPE ... ADD VALUE est plus lourd à opérer qu'un ALTER
--     CONSTRAINT en migration.
--   - conventions_dossier en clé-valeur (JSONB) : la liste des
--     conventions comptables propres à un dossier n'est pas figée à
--     l'avance (comptes d'autoliquidation variables, sous-comptes 604
--     avec/sans, etc.) et va s'enrichir avec l'usage.
--   - audit_log en append-only strict (REVOKE UPDATE/DELETE) : preuve
--     en cas de contrôle DGFIP côté client du cabinet.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- pour gen_random_uuid()

-- ============================================================================
-- 1. TENANCY — Cabinets et utilisateurs
-- ============================================================================

CREATE TABLE cabinets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom             TEXT NOT NULL,
    statut          TEXT NOT NULL DEFAULT 'actif'
                        CHECK (statut IN ('actif', 'suspendu', 'resilie')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE utilisateurs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      UUID NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
    nom             TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    role            TEXT NOT NULL
                        CHECK (role IN ('collaborateur', 'expert_comptable', 'admin_cabinet')),
    statut          TEXT NOT NULL DEFAULT 'actif'
                        CHECK (statut IN ('actif', 'inactif')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_utilisateurs_cabinet ON utilisateurs(cabinet_id);

-- ============================================================================
-- 2. DOSSIERS ET CONNEXIONS API
-- ============================================================================

CREATE TABLE dossiers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id              UUID NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
    nom                     TEXT NOT NULL,
    siren                   TEXT,
    regime_tva              TEXT NOT NULL
                                CHECK (regime_tva IN ('reel_normal', 'reel_simplifie', 'franchise')),
    periodicite_declaration TEXT NOT NULL DEFAULT 'mensuelle'
                                CHECK (periodicite_declaration IN ('mensuelle', 'trimestrielle')),
    tva_encaissement        BOOLEAN NOT NULL DEFAULT false,  -- true si prestataire de services
    logiciel_source         TEXT NOT NULL
                                CHECK (logiciel_source IN ('pennylane', 'inqom', 'acd', 'generation_expert', 'cegid_loop')),
    external_company_id     TEXT NOT NULL,  -- identifiant du dossier chez le logiciel source
    statut                  TEXT NOT NULL DEFAULT 'onboarding'
                                CHECK (statut IN ('onboarding', 'actif', 'inactif')),
    date_onboarding         TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (cabinet_id, logiciel_source, external_company_id)
);

CREATE INDEX idx_dossiers_cabinet ON dossiers(cabinet_id);
CREATE INDEX idx_dossiers_statut ON dossiers(statut);

CREATE TABLE connexions_api (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id                  UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    logiciel                    TEXT NOT NULL,
    scopes_autorises            TEXT[] NOT NULL DEFAULT '{}',
    token_reference              TEXT NOT NULL,  -- pointeur vers secret manager externe, JAMAIS le token en clair
    statut                       TEXT NOT NULL DEFAULT 'valide'
                                    CHECK (statut IN ('valide', 'expire', 'revoque')),
    derniere_synchronisation    TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_connexions_dossier ON connexions_api(dossier_id);

-- ============================================================================
-- 3. MEMOIRE DE DOSSIER
-- ============================================================================

-- Conventions comptables propres à un dossier (clé-valeur, extensible sans migration).
-- Exemples de clés : 'compte_tva_due_autoliquidee', 'compte_tva_deductible_autoliquidee',
-- 'comptes_charge_avec_autoliquidation', 'sous_compte_604_avec_auto'.
CREATE TABLE conventions_dossier (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id          UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    cle                 TEXT NOT NULL,
    valeur              JSONB NOT NULL,          -- string, nombre, ou liste selon la clé
    statut              TEXT NOT NULL DEFAULT 'candidate'
                            CHECK (statut IN ('candidate', 'confirmed', 'rejected')),
    source               TEXT NOT NULL
                            CHECK (source IN ('onboarding', 'decouverte_continue', 'saisie_manuelle')),
    confidence_note      TEXT,                    -- justification de l'agent lors de la proposition
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_by         UUID REFERENCES utilisateurs(id),
    confirmed_at         TIMESTAMPTZ
);

-- Un seul enregistrement confirmed actif par (dossier, cle) à un instant donné.
CREATE UNIQUE INDEX uq_convention_confirmed
    ON conventions_dossier(dossier_id, cle)
    WHERE statut = 'confirmed';

CREATE INDEX idx_conventions_dossier ON conventions_dossier(dossier_id, statut);

-- Parc d'immobilisations du dossier (notamment véhicules, pour la règle carburant).
CREATE TABLE immobilisations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id          UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    compte              TEXT NOT NULL,           -- 215X / 218X
    designation          TEXT,
    montant_ht           NUMERIC(14,2),
    date_acquisition     DATE,
    type_bien            TEXT
                            CHECK (type_bien IN ('vehicule_tourisme', 'vehicule_utilitaire', 'autre')),
    reference_piece       TEXT,                   -- traçabilité vers l'écriture source
    statut                TEXT NOT NULL DEFAULT 'candidate'
                            CHECK (statut IN ('candidate', 'confirmed', 'rejected')),
    source                TEXT NOT NULL
                            CHECK (source IN ('onboarding', 'decouverte_continue', 'saisie_manuelle')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_by          UUID REFERENCES utilisateurs(id),
    confirmed_at          TIMESTAMPTZ
);

CREATE INDEX idx_immobilisations_dossier ON immobilisations(dossier_id, statut);

-- Référentiel de confiance par tiers (fournisseur/client), pour cibler l'OCR
-- et éviter de re-scanner un fournisseur "propre" à chaque période.
CREATE TABLE tiers_reference (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id                  UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    numero_compte_tiers         TEXT NOT NULL,    -- 401xxx / 411xxx
    nom_tiers                   TEXT,
    niveau_confiance            TEXT NOT NULL DEFAULT 'nouveau'
                                    CHECK (niveau_confiance IN ('nouveau', 'a_surveiller', 'confiance')),
    nb_controles_sans_anomalie  INTEGER NOT NULL DEFAULT 0,
    derniere_date_controle      DATE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (dossier_id, numero_compte_tiers)
);

CREATE INDEX idx_tiers_dossier ON tiers_reference(dossier_id);

-- Taux de TVA habituel par tiers récurrent (détection d'écart sans motif).
CREATE TABLE taux_historique (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id          UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    tiers_id             UUID REFERENCES tiers_reference(id),
    compte_produit_ou_charge TEXT NOT NULL,
    taux_habituel        NUMERIC(4,2) NOT NULL,   -- ex: 20.00 / 10.00 / 5.50 / 2.10
    nb_occurrences        INTEGER NOT NULL DEFAULT 1,
    derniere_maj          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_taux_hist_dossier ON taux_historique(dossier_id);

-- ============================================================================
-- 4. REGISTRE DE VERIFICATION (anti double-travail)
-- ============================================================================

CREATE TABLE ecritures_verifiees (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id          UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    reference_piece      TEXT NOT NULL,
    compte                TEXT NOT NULL,
    periode                DATE NOT NULL,          -- premier jour de la période contrôlée
    type_verification      TEXT NOT NULL
                                CHECK (type_verification IN (
                                    'ocr_mentions', 'regroupement_immo', 'nouveau_tiers',
                                    'coherence_taux', 'autoliquidation'
                                )),
    hash_ecriture_source    TEXT NOT NULL,          -- empreinte du contenu de l'écriture au moment du contrôle ;
                                                     -- si l'écriture est rectifiée après coup, le hash change et
                                                     -- la vérification existante doit être invalidée / rejouée
    resultat                JSONB,
    date_verification        TIMESTAMPTZ NOT NULL DEFAULT now(),
    verifie_par               TEXT NOT NULL DEFAULT 'agent'
                                CHECK (verifie_par IN ('agent', 'utilisateur')),
    verifie_par_utilisateur_id UUID REFERENCES utilisateurs(id)
);

CREATE UNIQUE INDEX uq_ecriture_verifiee
    ON ecritures_verifiees(dossier_id, reference_piece, type_verification, hash_ecriture_source);

CREATE INDEX idx_ecritures_verifiees_lookup
    ON ecritures_verifiees(dossier_id, reference_piece, type_verification);

-- ============================================================================
-- 5. ANOMALIES ET VALIDATION HUMAINE
-- ============================================================================

CREATE TABLE anomalies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id          UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    periode              DATE NOT NULL,
    type_anomalie         TEXT NOT NULL,
    -- valeurs attendues (non contraintes en DB pour rester extensible) :
    --   trou_sequence_facture, encaissement_non_affecte, taux_incoherent,
    --   taux_multi_non_eclate, autoliquidation_desequilibree,
    --   autoliquidation_manquante, immo_potentielle_non_passee,
    --   nouveau_tiers_a_verifier, flotte_mixte_carburant,
    --   avoir_orphelin, exigibilite_a_verifier, mentions_facture_incompletes
    gravite                TEXT NOT NULL
                                CHECK (gravite IN ('bloquant', 'signale', 'info')),
    reference_piece         TEXT,
    description              TEXT NOT NULL,
    details                   JSONB,
    statut                    TEXT NOT NULL DEFAULT 'ouvert'
                                CHECK (statut IN ('ouvert', 'resolu', 'justifie')),
    traite_par                UUID REFERENCES utilisateurs(id),
    date_traitement            TIMESTAMPTZ,
    commentaire_traitement      TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anomalies_dossier_periode ON anomalies(dossier_id, periode);
CREATE INDEX idx_anomalies_statut ON anomalies(statut) WHERE statut = 'ouvert';
CREATE INDEX idx_anomalies_bloquant_ouvert
    ON anomalies(dossier_id, periode)
    WHERE gravite = 'bloquant' AND statut = 'ouvert';

-- ============================================================================
-- 6. CALCUL ET DECLARATION
-- ============================================================================

CREATE TABLE calculs_tva (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id          UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    periode_debut        DATE NOT NULL,
    periode_fin           DATE NOT NULL,
    statut                 TEXT NOT NULL DEFAULT 'brouillon'
                                CHECK (statut IN ('brouillon', 'valide', 'declare')),
    tva_nette               NUMERIC(14,2) NOT NULL,
    sens                     TEXT NOT NULL
                                CHECK (sens IN ('a_decaisser', 'credit')),
    date_calcul               TIMESTAMPTZ NOT NULL DEFAULT now(),
    valide_par                 UUID REFERENCES utilisateurs(id),
    date_validation              TIMESTAMPTZ,

    UNIQUE (dossier_id, periode_debut, periode_fin)
);

CREATE INDEX idx_calculs_dossier ON calculs_tva(dossier_id);

CREATE TABLE calculs_tva_lignes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calcul_id            UUID NOT NULL REFERENCES calculs_tva(id) ON DELETE CASCADE,
    categorie             TEXT NOT NULL
                                CHECK (categorie IN (
                                    'collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1',
                                    'deductible_abs', 'deductible_immo',
                                    'autoliquidation_due', 'autoliquidation_deductible',
                                    'ajustement_encaissement_partiel'
                                )),
    montant                 NUMERIC(14,2) NOT NULL,
    nb_ecritures_source       INTEGER NOT NULL DEFAULT 0,
    references_pieces          TEXT[]              -- pour remonter le détail depuis la ligne agrégée
);

CREATE INDEX idx_calculs_lignes_calcul ON calculs_tva_lignes(calcul_id);

-- ============================================================================
-- 7. AUDIT IMMUABLE
-- ============================================================================

CREATE TABLE audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          UUID NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
    dossier_id          UUID REFERENCES dossiers(id),
    type_evenement        TEXT NOT NULL,
    module_source          TEXT NOT NULL,
    acteur                  TEXT NOT NULL
                                CHECK (acteur IN ('agent', 'utilisateur', 'systeme')),
    acteur_utilisateur_id    UUID REFERENCES utilisateurs(id),
    details                    JSONB,
    horodatage                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_cabinet ON audit_log(cabinet_id, horodatage);
CREATE INDEX idx_audit_dossier ON audit_log(dossier_id, horodatage);

-- Append-only strict : personne ne peut modifier ou supprimer une ligne d'audit,
-- y compris un admin applicatif via un bug de code. Seul un rôle de maintenance
-- explicite pourrait le faire directement en base, hors applicatif.
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- ============================================================================
-- 8. ROW-LEVEL SECURITY — isolation stricte multi-cabinet
-- ============================================================================
-- Convention : l'application définit `app.current_cabinet_id` en début de
-- chaque session/transaction via `SET LOCAL app.current_cabinet_id = '<uuid>'`
-- juste après avoir authentifié l'utilisateur. Toutes les requêtes qui suivent
-- sont automatiquement filtrées par Postgres lui-même, indépendamment de la
-- rigueur du code applicatif.

ALTER TABLE dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE connexions_api ENABLE ROW LEVEL SECURITY;
ALTER TABLE conventions_dossier ENABLE ROW LEVEL SECURITY;
ALTER TABLE immobilisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiers_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE taux_historique ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecritures_verifiees ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculs_tva ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculs_tva_lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE utilisateurs ENABLE ROW LEVEL SECURITY;

-- Tables directement rattachées à cabinet_id
CREATE POLICY isolation_cabinet ON utilisateurs
    USING (cabinet_id = current_setting('app.current_cabinet_id', true)::UUID);

CREATE POLICY isolation_cabinet ON dossiers
    USING (cabinet_id = current_setting('app.current_cabinet_id', true)::UUID);

CREATE POLICY isolation_cabinet ON audit_log
    USING (cabinet_id = current_setting('app.current_cabinet_id', true)::UUID);

-- Tables rattachées via dossier_id : isolation par jointure implicite sur dossiers
CREATE POLICY isolation_cabinet ON connexions_api
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE POLICY isolation_cabinet ON conventions_dossier
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE POLICY isolation_cabinet ON immobilisations
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE POLICY isolation_cabinet ON tiers_reference
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE POLICY isolation_cabinet ON taux_historique
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE POLICY isolation_cabinet ON ecritures_verifiees
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE POLICY isolation_cabinet ON anomalies
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE POLICY isolation_cabinet ON calculs_tva
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE POLICY isolation_cabinet ON calculs_tva_lignes
    USING (calcul_id IN (
        SELECT c.id FROM calculs_tva c
        JOIN dossiers d ON d.id = c.dossier_id
        WHERE d.cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

-- ============================================================================
-- 9. TRIGGERS UTILITAIRES — updated_at automatique
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cabinets_updated_at
    BEFORE UPDATE ON cabinets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_dossiers_updated_at
    BEFORE UPDATE ON dossiers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- FIN SCHEMA INITIAL
-- ============================================================================
