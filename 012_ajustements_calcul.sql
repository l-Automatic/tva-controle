-- ============================================================================
-- 012 : ajustements_calcul — correction manuelle des totaux collectée/déductible
-- ============================================================================
-- Demande de Rami (10/08) : permettre au collaborateur d'ajuster
-- manuellement les montants totaux de TVA collectée et déductible d'un
-- calcul, sans jamais écraser silencieusement le résultat produit par le
-- moteur de calcul.
--
-- Principe : additif, jamais un remplacement. calculs_tva et
-- calculs_tva_lignes restent INTOUCHÉS (déjà protégés par trigger
-- d'immuabilité une fois validés, cf. 002) — un ajustement est une couche
-- séparée, combinée au résultat d'origine uniquement à l'affichage.
--
-- Restreint aux calculs encore 'brouillon' — vérifié applicativement
-- (writeRepository.ts), pas par un trigger dédié : cette table est
-- nouvelle, pas couverte par le trigger existant qui ne protège que
-- calculs_tva et calculs_tva_lignes.
--
-- Un seul ajustement actif par (calcul, type de montant) — remplaçable,
-- mais montant_original n'est JAMAIS réécrit après la première fois : il
-- doit toujours représenter ce que le moteur de calcul a produit, pas la
-- valeur juste avant le dernier ajustement.

CREATE TABLE ajustements_calcul (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calcul_id         UUID NOT NULL REFERENCES calculs_tva(id) ON DELETE CASCADE,
    type_montant      TEXT NOT NULL
                          CHECK (type_montant IN ('collectee_totale', 'deductible_totale')),
    montant_original  NUMERIC(14,2) NOT NULL,
    montant_ajuste    NUMERIC(14,2) NOT NULL,
    justification     TEXT NOT NULL CHECK (char_length(trim(justification)) > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID NOT NULL REFERENCES utilisateurs(id),

    UNIQUE (calcul_id, type_montant)
);

CREATE INDEX idx_ajustements_calcul_calcul ON ajustements_calcul(calcul_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ajustements_calcul TO pennylane_tva_app;  -- DELETE pour retirerAjustementCalcul

ALTER TABLE ajustements_calcul ENABLE ROW LEVEL SECURITY;
ALTER TABLE ajustements_calcul FORCE ROW LEVEL SECURITY;

CREATE POLICY isolation_cabinet ON ajustements_calcul
    USING (calcul_id IN (
        SELECT c.id FROM calculs_tva c
        JOIN dossiers d ON d.id = c.dossier_id
        WHERE d.cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));
