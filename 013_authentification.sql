-- ============================================================================
-- 013 : authentification — mot de passe, rôle simplifié à deux valeurs
-- ============================================================================
-- Décision de Rami (10/08) : aller vite, sans dépendance externe (pas de
-- Supabase), deux rôles seulement — 'collaborateur' (accès dossiers, pas
-- aux paramètres cabinet) et 'admin_cabinet' (accès dossiers ET paramètres
-- cabinet). Le rôle 'expert_comptable', prévu dans le schéma initial mais
-- jamais vraiment utilisé, jugé inutile — retiré.
--
-- Nullable au départ : les utilisateurs déjà en base n'ont pas de mot de
-- passe. Un admin_cabinet leur en définit un via la route dédiée — pas de
-- flux "mot de passe oublié" par email pour cette première version
-- (décision explicite, éviter la brique email pour aller vite).

ALTER TABLE utilisateurs ADD COLUMN mot_de_passe_hash TEXT;

-- Simplifie le rôle à deux valeurs. Toute ligne existante en
-- 'expert_comptable' est reclassée 'admin_cabinet' — traitement le plus
-- proche de son intention d'origine (accès large), à corriger manuellement
-- si ce n'est pas le bon choix pour un utilisateur donné.
UPDATE utilisateurs SET role = 'admin_cabinet' WHERE role = 'expert_comptable';

ALTER TABLE utilisateurs DROP CONSTRAINT utilisateurs_role_check;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
    CHECK (role IN ('collaborateur', 'admin_cabinet'));

COMMENT ON COLUMN utilisateurs.mot_de_passe_hash IS
  'Hash scrypt (sel:clé, hex) — format "sel:cle", jamais le mot de passe en '
  'clair. NULL = mot de passe pas encore défini, l''utilisateur ne peut pas '
  'se connecter tant que ce n''est pas fait.';

-- utilisateurs a du RLS FORCÉ (cf. 002) scopé sur app.current_cabinet_id —
-- au moment de la connexion, ce cabinet n'est justement pas encore connu
-- (c'est ce qu'on cherche à établir). Fonction dédiée, SECURITY DEFINER,
-- contourne le RLS de façon contrôlée et étroite : retourne uniquement les
-- champs nécessaires à l'authentification, jamais un accès plus large.
-- Même principe que provisioning_create_cabinet (002) pour la création de
-- cabinet, qui a le même besoin de traverser les cabinets.
CREATE OR REPLACE FUNCTION authentifier_par_email(p_email TEXT)
RETURNS TABLE(id UUID, cabinet_id UUID, role TEXT, mot_de_passe_hash TEXT, statut TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id, cabinet_id, role, mot_de_passe_hash, statut
    FROM utilisateurs
    WHERE email = p_email;
$$;

GRANT EXECUTE ON FUNCTION authentifier_par_email(TEXT) TO pennylane_tva_app;
