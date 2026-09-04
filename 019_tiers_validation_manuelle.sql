-- ============================================================================
-- 019 : validation manuelle explicite d'un tiers (10/08, demande de Rami)
-- ============================================================================
-- Distincte du niveau_confiance existant (progression automatique sur
-- plusieurs cycles sans anomalie) : ici, un booléen simple, mis à jour
-- uniquement par une action humaine explicite ("Valider le tiers"), jamais
-- par le cycle lui-même. tiersConnus (chargerContexteDossier) ne doit
-- désormais compter QUE les tiers validés manuellement — un tiers jamais
-- validé (ignoré, ou simplement jamais traité) doit continuer à
-- réapparaître comme "nouveau" à chaque cycle, jamais mémorisé
-- silencieusement par la seule répétition.

ALTER TABLE tiers_reference
    ADD COLUMN valide_manuellement BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tiers_reference.valide_manuellement IS
  'Validation humaine explicite ("Valider le tiers") — seul ce champ, jamais '
  'niveau_confiance ni la simple répétition sur plusieurs cycles, retire un '
  'tiers de la liste des nouveaux tiers à vérifier.';
