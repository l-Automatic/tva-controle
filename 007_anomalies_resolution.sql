-- ============================================================================
-- 007 : colonne `resolution` structurée sur `anomalies`
-- ============================================================================
-- Nécessaire pour le traitement du compte 471 (encaissements non identifiés) :
-- `commentaire_traitement` est un texte libre, mais Module 7 (calcul) doit
-- pouvoir relire une donnée structurée (le taux de TVA retenu par le
-- comptable) pour intégrer la régularisation dans le calcul de la période.
-- Nullable et volontairement générique (pas propre au 471) : d'autres
-- résolutions futures pourront s'en servir sans nouvelle migration.

ALTER TABLE anomalies ADD COLUMN resolution JSONB;

COMMENT ON COLUMN anomalies.resolution IS
  'Donnée structurée de résolution, propre au type d''anomalie. Ex pour '
  'encaissement_non_affecte qualifié comme vente : {"taux": 20}. NULL pour '
  'la plupart des anomalies (le commentaire_traitement suffit).';
