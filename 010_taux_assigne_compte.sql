-- ============================================================================
-- 010 : taux_assigne_compte — taux de TVA assigné une fois pour toutes
-- ============================================================================
-- Différent de taux_historique (observé, recalculé, vérification de
-- cohérence) : ici le comptable ASSIGNE directement un taux à un compte de
-- produit ou de charge, une fois pour toutes, pas recalculé à chaque cycle.
-- Usage confirmé par Rami (08/08) :
--   - Côté produit : systématique en pratique (le libellé du compte porte
--     déjà le taux, ex "Vente de marchandises 20%") — sert à un contrôle de
--     cohérence CA déclaré / TVA collectée en fin d'exercice.
--   - Côté charge : surtout utile quand un compte est subdivisé par taux
--     (ex restaurants : "achats matières premières 20%" / "... 5,5%").
--
-- Pas de workflow candidate/confirmed : assignation directe par le
-- comptable, pas une proposition détectée automatiquement à valider.

CREATE TABLE taux_assigne_compte (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id                UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    compte_produit_ou_charge  TEXT NOT NULL,
    taux_assigne              TEXT NOT NULL
                                  CHECK (taux_assigne IN (
                                      '0', '2.1', '5.5', '10', '20',
                                      'autoliquide_intracom',
                                      'autoliquide_20', 'autoliquide_10', 'autoliquide_5.5'
                                  )),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (dossier_id, compte_produit_ou_charge)
);

COMMENT ON COLUMN taux_assigne_compte.taux_assigne IS
  'Un des 3 taux nationaux réduits (2.1/5.5/10), le taux normal (20), '
  'exonéré (0), ou une variante autoliquidée (intracom générique, ou '
  'autoliquidée à un taux précis).';

GRANT SELECT, INSERT, UPDATE ON taux_assigne_compte TO pennylane_tva_app;

ALTER TABLE taux_assigne_compte ENABLE ROW LEVEL SECURITY;
ALTER TABLE taux_assigne_compte FORCE ROW LEVEL SECURITY;

CREATE POLICY isolation_cabinet ON taux_assigne_compte
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));

CREATE TRIGGER trg_taux_assigne_compte_updated_at
    BEFORE UPDATE ON taux_assigne_compte
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
