-- ============================================================================
-- 016 : rapprochements de paiement achats (validation manuelle par facture)
-- ============================================================================
-- Remplace complètement les deux anciens mécanismes achats (jugement sur
-- groupe de lettrage à plus de 2 lignes, recherche d'acompte sans
-- lettrage) — décision de Rami (10/08) : lecture par facture de service,
-- popup présentant tous les paiements candidats du même compte
-- fournisseur, coche manuelle (avec pré-cochage IA quand fiable), validé
-- par le collaborateur. Le terme "groupe de lettrage" est volontairement
-- absent de ce nouveau chantier — jugé source de confusion tout au long du
-- projet (demande explicite de Rami).
--
-- Un rapprochement doit être résolu AVANT qu'un cycle puisse être lancé
-- (même principe que la catégorisation bien/service, migration
-- verifierComptesACategoriser) — jamais rattrapé après coup.

CREATE TABLE rapprochements_paiement_achat (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id               UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    periode                  DATE NOT NULL,
    facture_ledger_entry_id  BIGINT NOT NULL,
    montant_facture_total    NUMERIC(14,2) NOT NULL,
    -- [{ "ledgerEntryId": 123, "montant": 456.78 }, ...] — paiements cochés
    -- et validés par le collaborateur, jamais par le LLM seul.
    paiements_valides        JSONB NOT NULL,
    montant_total_valide     NUMERIC(14,2) NOT NULL,
    confirmed_by             UUID REFERENCES utilisateurs(id),
    confirmed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (dossier_id, facture_ledger_entry_id)
);

CREATE INDEX idx_rapprochements_paiement_achat_dossier_periode
    ON rapprochements_paiement_achat(dossier_id, periode);

COMMENT ON TABLE rapprochements_paiement_achat IS
  'Rapprochement facture/paiements côté achats, validé manuellement par un '
  'collaborateur (avec pré-cochage IA optionnel) — jamais un calcul '
  'automatique aveugle. Une facture de service non lettrée doit avoir une '
  'ligne ici avant qu''un cycle ne puisse être lancé sur sa période.';

GRANT SELECT, INSERT, UPDATE ON rapprochements_paiement_achat TO pennylane_tva_app;

ALTER TABLE rapprochements_paiement_achat ENABLE ROW LEVEL SECURITY;

CREATE POLICY isolation_cabinet ON rapprochements_paiement_achat
    USING (dossier_id IN (
        SELECT id FROM dossiers WHERE cabinet_id = current_setting('app.current_cabinet_id', true)::UUID
    ));
