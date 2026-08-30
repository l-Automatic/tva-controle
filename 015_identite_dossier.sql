-- ============================================================================
-- 015 : désactivation avec motif, champs d'identité dossier
-- ============================================================================
-- Demande de Rami (10/08) — deux besoins distincts :
--
-- 1. Désactivation d'un dossier, avec un motif texte libre — le statut
--    'inactif' existait déjà (001), jamais exploité. Le motif garde la
--    trace de POURQUOI (hors périmètre TVA découvert lors d'un import en
--    masse, vs dossier trop complexe / régime spécial pour être géré ici
--    — deux raisons différentes que Rami a lui-même distinguées).
--
-- 2. Champs d'identité dossier — une partie déjà couverte par la
--    synchronisation Pennylane (nom, siren, adresse, code NAF — cf. 001 et
--    014), le reste relève d'une saisie humaine (accessible aux deux
--    rôles, dossier et non cabinet) : SIRET, forme juridique, fiscalité,
--    méthode comptable, dates d'exercice, contact, TVA intracom.

ALTER TABLE dossiers ADD COLUMN motif_desactivation TEXT;

ALTER TABLE dossiers ADD COLUMN siret TEXT;
ALTER TABLE dossiers ADD COLUMN forme_juridique TEXT;
ALTER TABLE dossiers ADD COLUMN fiscalite TEXT CHECK (fiscalite IN ('is', 'ir'));
ALTER TABLE dossiers ADD COLUMN comptabilite TEXT CHECK (comptabilite IN ('engagement', 'tresorerie'));
ALTER TABLE dossiers ADD COLUMN date_debut_exercice DATE;
ALTER TABLE dossiers ADD COLUMN date_fin_exercice DATE;
ALTER TABLE dossiers ADD COLUMN email_contact TEXT;
ALTER TABLE dossiers ADD COLUMN contact_nom TEXT;
ALTER TABLE dossiers ADD COLUMN contact_telephone TEXT;

-- Angle mort identifié (10/08) : nécessaire à terme pour vérifier la
-- validité d'un numéro de TVA intracom (VIES) — jamais construit pour
-- l'instant, mais le champ doit exister pour être saisi/affiché dès
-- maintenant sans nouvelle migration plus tard.
ALTER TABLE dossiers ADD COLUMN numero_tva_intracom TEXT;

COMMENT ON COLUMN dossiers.motif_desactivation IS
  'Renseigné uniquement quand statut = ''inactif'' — pourquoi ce dossier '
  'a été désactivé (hors périmètre TVA, trop complexe, régime spécial...). '
  'Pas de contrainte stricte forçant cette cohérence : une valeur laissée '
  'après réactivation est un historique, pas une erreur.';
