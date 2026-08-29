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
