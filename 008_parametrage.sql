-- ============================================================================
-- 008 : paramétrage cabinet et dossier
-- ============================================================================
-- Deux tables clé-valeur symétriques, à deux échelles différentes :
--   - parametres_cabinet : réglages partagés par tous les dossiers d'un
--     cabinet (typiquement un abonnement/clé API — un cabinet paie un seul
--     abonnement Mistral, pas un par dossier).
--   - parametres_dossier : réglages propres à un dossier (ex : désactiver un
--     contrôle précis pour ce client uniquement).
--
-- Volontairement différent de conventions_dossier : pas de workflow
-- candidate/confirmed/rejected ici. Un paramètre n'est pas une proposition
-- détectée automatiquement à valider par un humain, c'est une décision
-- directe du cabinet/collaborateur — la sémantique candidate/confirmed
-- n'aurait pas de sens (on ne "confirme" pas sa propre clé API).
--
-- Sécurité, volontairement documenté plutôt que caché : la colonne `valeur`
-- est en clair, y compris pour un secret comme une clé API Mistral. Même
-- compromis que le token Pennylane (cf. STATUT_PROJET.md, "connu, accepté en
-- sandbox") : pas de gestion de secrets construite à ce stade. À revoir avant
-- tout usage multi-cabinets réel — chiffrement au repos ou secrets manager,
-- pas un ajout à faire à la légère (question de gestion de la clé de
-- chiffrement elle-même, pas juste un ALTER TABLE).

CREATE TABLE parametres_cabinet (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id  UUID NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
    cle         TEXT NOT NULL,
    valeur      JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (cabinet_id, cle)
);

CREATE TABLE parametres_dossier (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id  UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    cle         TEXT NOT NULL,
    valeur      JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (dossier_id, cle)
);

COMMENT ON COLUMN parametres_cabinet.cle IS
  'Ex: mistral_api_key (active la partie LLM pour ce cabinet — présence de '
  'la clé = activé, pas de flag booléen séparé pour éviter un état '
  'incohérent flag=true/clé=absente).';

COMMENT ON COLUMN parametres_dossier.cle IS
  'Ex: controle_carburant_actif: false — désactivation d''un contrôle '
  'précis pour ce dossier uniquement. Vocabulaire des clés pas encore fixé, '
  'à étoffer au fil des besoins réels plutôt que par anticipation.';

-- Pas de DELETE accordé (même politique que le reste du schéma) : "retirer"
-- un paramètre se fait par UPSERT vers une valeur neutre (ex: null, ou
-- false), jamais par suppression de la ligne.
GRANT SELECT, INSERT, UPDATE ON parametres_cabinet TO pennylane_tva_app;
GRANT SELECT, INSERT, UPDATE ON parametres_dossier TO pennylane_tva_app;

ALTER TABLE parametres_cabinet ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametres_dossier ENABLE ROW LEVEL SECURITY;

CREATE POLICY isolation_cabinet ON parametres_cabinet
    USING (cabinet_id = current_setting('app.current_cabinet_id', true)::UUID);

CREATE POLICY isolation_cabinet ON parametres_dossier
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE TRIGGER trg_parametres_cabinet_updated_at
    BEFORE UPDATE ON parametres_cabinet
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_parametres_dossier_updated_at
    BEFORE UPDATE ON parametres_dossier
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
