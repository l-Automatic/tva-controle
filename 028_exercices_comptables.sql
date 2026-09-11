-- ============================================================================
-- 028 : exercices comptables (10/08, demande de Rami)
-- ============================================================================
-- Remplace les deux colonnes uniques dossiers.date_debut_exercice /
-- date_fin_exercice (un seul exercice par dossier, jamais extensible) par
-- une vraie table : plusieurs exercices consécutifs par dossier, avec la
-- possibilité d'en ajouter à l'avance. Objectif explicite de Rami : que
-- rien de ce qui dépend de l'exercice ne s'arrête silencieusement faute
-- d'avoir pensé à renseigner le prochain exercice à temps — PAS une
-- gestion complète (clôture, verrouillage...), juste de quoi ne jamais
-- manquer d'exercice défini.
--
-- Rend obsolète le paramètre dossier séparé date_debut_exercice
-- (parametres_dossier), utilisé jusqu'ici uniquement pour la ligne 10 CA3
-- (crédit TVA antérieur) — cf. migration suivante pour son retrait, une
-- fois le code de calcul basculé sur cette nouvelle table.

CREATE TABLE exercices_comptables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    statut TEXT NOT NULL DEFAULT 'en_cours', -- en_cours | cloture — pas de workflow de clôture construit pour l'instant, juste la colonne pour plus tard
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT exercice_dates_coherentes CHECK (date_fin > date_debut)
);

CREATE INDEX idx_exercices_comptables_dossier ON exercices_comptables(dossier_id, date_debut);

ALTER TABLE exercices_comptables ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercices_comptables FORCE ROW LEVEL SECURITY;

CREATE POLICY isolation_cabinet ON exercices_comptables
    USING (dossier_id IN (SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::uuid));

GRANT SELECT, INSERT ON exercices_comptables TO pennylane_tva_app;

-- Migration des données existantes : un dossier qui avait déjà
-- date_debut_exercice/date_fin_exercice renseignés devient un premier
-- exercice "en_cours" dans la nouvelle table. Rien à migrer pour un
-- dossier qui n'avait jamais renseigné ces colonnes.
INSERT INTO exercices_comptables (dossier_id, date_debut, date_fin, statut)
SELECT id, date_debut_exercice, date_fin_exercice, 'en_cours'
FROM dossiers
WHERE date_debut_exercice IS NOT NULL AND date_fin_exercice IS NOT NULL;

ALTER TABLE dossiers DROP COLUMN date_debut_exercice;
ALTER TABLE dossiers DROP COLUMN date_fin_exercice;
