-- ============================================================================
-- 014 : champs additionnels dossiers — capturés depuis l'API Cabinet Pennylane
-- ============================================================================
-- Demande de Rami (10/08) : capturer le maximum d'information disponible
-- lors de la synchronisation, en pensant à la future déclaration de TVA
-- (qui aura besoin de l'adresse complète du dossier, entre autres, sur les
-- documents officiels).
--
-- Champs confirmés par le schéma OpenAPI officiel de l'endpoint
-- List/Show companies de l'API Cabinet (firm-pennylane.readme.io) — jamais
-- une supposition.

ALTER TABLE dossiers ADD COLUMN nom_commercial TEXT;
ALTER TABLE dossiers ADD COLUMN adresse TEXT;
ALTER TABLE dossiers ADD COLUMN ville TEXT;
ALTER TABLE dossiers ADD COLUMN code_postal TEXT;
ALTER TABLE dossiers ADD COLUMN code_naf TEXT;
ALTER TABLE dossiers ADD COLUMN code_client_pennylane TEXT;

COMMENT ON COLUMN dossiers.code_client_pennylane IS
  'client_code de l''API Cabinet Pennylane — référence assignée par le '
  'cabinet lui-même dans Pennylane, distincte de external_company_id (l''id '
  'technique Pennylane utilisé pour les appels API).';
