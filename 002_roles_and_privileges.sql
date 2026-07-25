-- ============================================================================
-- 002 — ROLES APPLICATIFS ET PRIVILEGES
-- ============================================================================
-- Ce script définit les rôles PostgreSQL utilisés par l'application, avec
-- des privilèges minimaux par table. Il s'exécute après 001_schema_initial.sql.
--
-- Principe directeur : aucun rôle applicatif ne doit être superuser, owner
-- des tables, ni BYPASSRLS. Le seul point d'exception (création d'un
-- cabinet, cf. section 3) passe par une fonction SECURITY DEFINER étroite,
-- pas par un rôle à privilèges larges — pour ne jamais avoir un rôle qui
-- puisse contourner la RLS sur l'ensemble des tables.
--
-- Trois rôles :
--   pennylane_tva_owner        : propriétaire du schéma, utilisé uniquement
--                                 pour les migrations (CI/CD), jamais par
--                                 l'application en fonctionnement.
--   pennylane_tva_app          : rôle applicatif principal (backend), pour
--                                 toutes les opérations quotidiennes,
--                                 qu'elles soient déclenchées par un agent
--                                 ou par un collaborateur humain — la
--                                 distinction se fait au niveau applicatif
--                                 via la colonne `acteur`, pas au niveau
--                                 du rôle DB.
--   pennylane_tva_provisioning : rôle utilisé uniquement par le service
--                                 interne d'onboarding (création d'un
--                                 nouveau cabinet + son premier utilisateur
--                                 admin). Jamais exposé à l'API tenant.
--
-- Règle de conception : AUCUN DELETE physique n'est accordé, sauf sur
-- calculs_tva_lignes (et uniquement tant que le calcul parent est en
-- statut 'brouillon', imposé par trigger, cf. section 5). Le reste du
-- système ne supprime jamais rien — on fait transiter un statut
-- (rejected / inactif / revoque / justifie...), cohérent avec un système
-- adjacent à la comptabilité où rien ne doit disparaître silencieusement.
-- ============================================================================


-- ============================================================================
-- 1. CREATION DES ROLES
-- ============================================================================
-- Mots de passe placeholders : à remplacer par une gestion de secrets réelle
-- (variables d'environnement injectées au déploiement), jamais en clair dans
-- un script versionné en production.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pennylane_tva_owner') THEN
        CREATE ROLE pennylane_tva_owner LOGIN PASSWORD 'CHANGE_ME_OWNER' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pennylane_tva_app') THEN
        CREATE ROLE pennylane_tva_app LOGIN PASSWORD 'CHANGE_ME_APP' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pennylane_tva_provisioning') THEN
        CREATE ROLE pennylane_tva_provisioning LOGIN PASSWORD 'CHANGE_ME_PROVISIONING' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pennylane_tva_readonly') THEN
        CREATE ROLE pennylane_tva_readonly LOGIN PASSWORD 'CHANGE_ME_READONLY' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

-- pennylane_tva_provisioning hérite de tous les droits de pennylane_tva_app
-- (le service d'onboarding fait tout ce que fait l'app normale, plus la
-- création de cabinet via la fonction dédiée) — évite de dupliquer les GRANT.
GRANT pennylane_tva_app TO pennylane_tva_provisioning;

-- Transfert de propriété de tous les objets vers pennylane_tva_owner.
-- Nécessaire quel que soit le rôle qui a exécuté 001_schema_initial.sql
-- (typiquement un rôle CI/migration ou un superuser en environnement local) :
-- la fonction SECURITY DEFINER de la section 3 ne bypass la RLS sur
-- `cabinets` QUE si elle est possédée par le propriétaire réel de cette
-- table. Sans ce transfert explicite, le mécanisme de provisioning échoue
-- silencieusement en RLS dès que 001 et 002 sont exécutés par des rôles
-- différents.
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO pennylane_tva_owner', t);
    END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO pennylane_tva_owner, pennylane_tva_app, pennylane_tva_provisioning, pennylane_tva_readonly;

-- Verrou de base : personne ne doit hériter de droits par défaut via PUBLIC.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;


-- ============================================================================
-- 2. PRIVILEGES PAR TABLE — pennylane_tva_app
-- ============================================================================
-- Aucun DELETE nulle part, sauf calculs_tva_lignes (protégé par trigger,
-- section 5). Aucun accès à cabinets.INSERT (réservé à la fonction de
-- provisioning, section 3).

-- --- Tenancy ---
GRANT SELECT, INSERT, UPDATE ON utilisateurs TO pennylane_tva_app;
GRANT SELECT, UPDATE ON cabinets TO pennylane_tva_app;          -- pas d'INSERT ici, voir section 3

-- --- Dossiers et connexions API ---
GRANT SELECT, INSERT, UPDATE ON dossiers TO pennylane_tva_app;
GRANT SELECT, INSERT, UPDATE ON connexions_api TO pennylane_tva_app;

-- --- Mémoire de dossier ---
GRANT SELECT, INSERT, UPDATE ON conventions_dossier TO pennylane_tva_app;
GRANT SELECT, INSERT, UPDATE ON immobilisations TO pennylane_tva_app;
GRANT SELECT, INSERT, UPDATE ON tiers_reference TO pennylane_tva_app;
GRANT SELECT, INSERT, UPDATE ON taux_historique TO pennylane_tva_app;

-- --- Registre de vérification : append-only strict, jamais de correction ---
-- (si une écriture est rectifiée, son hash change -> nouvelle ligne, pas un UPDATE)
GRANT SELECT, INSERT ON ecritures_verifiees TO pennylane_tva_app;
REVOKE UPDATE, DELETE ON ecritures_verifiees FROM pennylane_tva_app;

-- --- Anomalies et validation ---
GRANT SELECT, INSERT, UPDATE ON anomalies TO pennylane_tva_app;

-- --- Calcul et déclaration ---
GRANT SELECT, INSERT, UPDATE ON calculs_tva TO pennylane_tva_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON calculs_tva_lignes TO pennylane_tva_app;  -- DELETE exceptionnel, cf. section 5

-- --- Audit : écriture seule, jamais de lecture arrière modifiée ni de suppression ---
GRANT SELECT, INSERT ON audit_log TO pennylane_tva_app;
REVOKE UPDATE, DELETE ON audit_log FROM pennylane_tva_app;


-- ============================================================================
-- 3. PROVISIONING D'UN NOUVEAU CABINET — le point d'exception RLS
-- ============================================================================
-- Problème : la politique RLS sur `cabinets` exige que
-- cabinet_id = current_setting('app.current_cabinet_id'). Or à la création
-- d'un cabinet, cet identifiant n'existe pas encore — aucun rôle RLS-scopé
-- ne peut donc insérer la toute première ligne du tenant.
--
-- Solution retenue : une fonction SECURITY DEFINER étroite, possédée par le
-- propriétaire du schéma (qui n'est pas soumis à la RLS sur `cabinets` tant
-- que FORCE ROW LEVEL SECURITY n'est pas activée dessus — volontairement
-- non activée sur cette table précise, voir section 4). La fonction ne fait
-- qu'une seule chose : insérer une ligne dans `cabinets` et retourner son
-- id. Elle n'ouvre aucun accès aux autres tables ni aux autres tenants.
--
-- Alternative écartée : donner BYPASSRLS à un rôle applicatif. Rejetée car
-- BYPASSRLS s'applique à TOUTES les tables pour CE rôle, pas seulement à
-- `cabinets` — surface de risque bien plus large pour un gain nul.

CREATE OR REPLACE FUNCTION provisioning_create_cabinet(p_nom TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_nom IS NULL OR length(trim(p_nom)) = 0 THEN
        RAISE EXCEPTION 'Le nom du cabinet ne peut pas être vide';
    END IF;

    INSERT INTO cabinets (nom) VALUES (p_nom) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

ALTER FUNCTION provisioning_create_cabinet(TEXT) OWNER TO pennylane_tva_owner;

REVOKE ALL ON FUNCTION provisioning_create_cabinet(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provisioning_create_cabinet(TEXT) TO pennylane_tva_provisioning;

-- Usage attendu côté application, dans une seule transaction :
--   1. v_cabinet_id := SELECT provisioning_create_cabinet('Nom du cabinet');
--   2. SET LOCAL app.current_cabinet_id = v_cabinet_id;
--   3. INSERT INTO utilisateurs (cabinet_id, ...) VALUES (v_cabinet_id, ...);
--      -- passe la RLS normalement car current_cabinet_id correspond déjà
--   4. INSERT INTO dossiers (...) le cas échéant, même logique.


-- ============================================================================
-- 4. FORCE ROW LEVEL SECURITY sur les tables de données sensibles
-- ============================================================================
-- Défense en profondeur : même si une requête finissait par s'exécuter avec
-- le rôle propriétaire des tables (ce qui ne devrait jamais arriver en
-- fonctionnement normal), la RLS resterait appliquée sur ces tables.
--
-- Exception volontaire : `cabinets` n'est PAS mise en FORCE, pour que la
-- fonction provisioning_create_cabinet (SECURITY DEFINER, exécutée avec les
-- droits du propriétaire) puisse continuer à fonctionner sans contournement
-- supplémentaire.

ALTER TABLE dossiers FORCE ROW LEVEL SECURITY;
ALTER TABLE connexions_api FORCE ROW LEVEL SECURITY;
ALTER TABLE conventions_dossier FORCE ROW LEVEL SECURITY;
ALTER TABLE immobilisations FORCE ROW LEVEL SECURITY;
ALTER TABLE tiers_reference FORCE ROW LEVEL SECURITY;
ALTER TABLE taux_historique FORCE ROW LEVEL SECURITY;
ALTER TABLE ecritures_verifiees FORCE ROW LEVEL SECURITY;
ALTER TABLE anomalies FORCE ROW LEVEL SECURITY;
ALTER TABLE calculs_tva FORCE ROW LEVEL SECURITY;
ALTER TABLE calculs_tva_lignes FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE utilisateurs FORCE ROW LEVEL SECURITY;


-- ============================================================================
-- 5. IMMUABILITE DU CALCUL TVA UNE FOIS VALIDE
-- ============================================================================
-- Un calcul ne doit plus pouvoir être modifié une fois sorti du statut
-- 'brouillon' — ni son montant, ni ses lignes de détail. Seule la
-- transition de statut vers l'avant (brouillon -> valide -> declare) reste
-- possible. Ceci protège contre un bug applicatif ou une écriture
-- accidentelle qui altérerait un montant déjà validé par un collaborateur.

CREATE OR REPLACE FUNCTION protect_calcul_tva_header()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.statut IN ('valide', 'declare') THEN
        -- Seule une transition de statut vers l'avant est tolérée ;
        -- tout le reste (montant, dates de période, dossier) est gelé.
        IF NEW.tva_nette IS DISTINCT FROM OLD.tva_nette
           OR NEW.sens IS DISTINCT FROM OLD.sens
           OR NEW.periode_debut IS DISTINCT FROM OLD.periode_debut
           OR NEW.periode_fin IS DISTINCT FROM OLD.periode_fin
           OR NEW.dossier_id IS DISTINCT FROM OLD.dossier_id THEN
            RAISE EXCEPTION 'Calcul TVA % : modification interdite au-delà du statut brouillon (statut actuel : %)',
                OLD.id, OLD.statut;
        END IF;

        IF OLD.statut = 'declare' AND NEW.statut IS DISTINCT FROM 'declare' THEN
            RAISE EXCEPTION 'Calcul TVA % : un calcul déclaré ne peut plus changer de statut', OLD.id;
        END IF;

        IF OLD.statut = 'valide' AND NEW.statut NOT IN ('valide', 'declare') THEN
            RAISE EXCEPTION 'Calcul TVA % : impossible de revenir en arrière depuis le statut valide', OLD.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_calcul_tva_header
    BEFORE UPDATE ON calculs_tva
    FOR EACH ROW EXECUTE FUNCTION protect_calcul_tva_header();


CREATE OR REPLACE FUNCTION protect_calcul_tva_lignes()
RETURNS TRIGGER AS $$
DECLARE
    v_statut TEXT;
BEGIN
    SELECT statut INTO v_statut
    FROM calculs_tva
    WHERE id = COALESCE(OLD.calcul_id, NEW.calcul_id);

    IF v_statut IS DISTINCT FROM 'brouillon' THEN
        RAISE EXCEPTION 'Lignes de calcul TVA du calcul % : modification interdite hors statut brouillon (statut actuel : %)',
            COALESCE(OLD.calcul_id, NEW.calcul_id), v_statut;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_calculs_tva_lignes_update
    BEFORE UPDATE ON calculs_tva_lignes
    FOR EACH ROW EXECUTE FUNCTION protect_calcul_tva_lignes();

CREATE TRIGGER trg_protect_calculs_tva_lignes_delete
    BEFORE DELETE ON calculs_tva_lignes
    FOR EACH ROW EXECUTE FUNCTION protect_calcul_tva_lignes();


-- ============================================================================
-- 6. ROLE LECTURE SEULE (reporting / consultation d'audit)
-- ============================================================================
-- Destiné à un futur outil de reporting ou à une consultation d'audit sans
-- aucun risque d'écriture, même accidentelle côté applicatif.

GRANT SELECT ON ALL TABLES IN SCHEMA public TO pennylane_tva_readonly;

-- S'assure que les tables créées par de futures migrations restent couvertes
-- automatiquement pour les rôles définis ici, sans script correctif oublié.
ALTER DEFAULT PRIVILEGES FOR ROLE pennylane_tva_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO pennylane_tva_readonly;

-- ============================================================================
-- FIN — ROLES ET PRIVILEGES
-- ============================================================================
