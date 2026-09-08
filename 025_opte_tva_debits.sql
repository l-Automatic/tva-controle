-- ============================================================================
-- 025 : opte_tva_debits sur tiers_reference (10/08, demande de Rami)
-- ============================================================================
-- Un fournisseur qui vend des services peut avoir opté lui-même pour la TVA
-- sur les débits (plutôt que sur encaissement) — dans ce cas, on doit
-- pouvoir déduire la TVA dès facturation, même si le service n'est pas
-- encore payé. Sans cette coche, notre moteur d'exigibilité applique la
-- règle par défaut (service = exigible seulement une fois payé), ce qui
-- retarderait à tort la déduction. Coché manuellement par le collaborateur,
-- jamais déduit automatiquement — rien dans les données ne permet de savoir
-- qu'un fournisseur a fait ce choix fiscal.

ALTER TABLE tiers_reference ADD COLUMN opte_tva_debits BOOLEAN NOT NULL DEFAULT false;
