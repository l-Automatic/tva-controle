-- ============================================================================
-- 004 : colonne `compte` manquante sur `anomalies`
-- ============================================================================
-- Le champ `compte` (numéro de compte TVA concerné, ex: '445711') est calculé
-- par TOUS les contrôles du Module 4 (voir Anomalie.compte dans @tva-controle/core)
-- mais n'a jamais été persisté : la table `anomalies` n'avait pas de colonne
-- pour le recevoir, et enregistrerAnomalies() ne l'écrivait donc pas.
-- Conséquence concrète : un collaborateur qui traite une anomalie dans
-- l'interface ne pouvait identifier ni le compte concerné, ni (pour les
-- anomalies de groupe de lettrage) les autres pièces du groupe — les deux
-- existaient déjà en mémoire au moment du calcul, mais étaient perdus avant
-- d'atteindre la base.

ALTER TABLE anomalies ADD COLUMN compte TEXT;

COMMENT ON COLUMN anomalies.compte IS
  'Numéro de compte TVA concerné (ex: 445711, 44566). Peut contenir plusieurs '
  'comptes séparés par une virgule pour les anomalies multi-lignes (ex: '
  'immobilisation manquée sur plusieurs écritures).';
