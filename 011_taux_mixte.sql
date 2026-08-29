-- ============================================================================
-- 011 : option "mixte/indéfini" pour taux_assigne_compte et taux_historique_tiers
-- ============================================================================
-- Demande de Rami (10/08) : certains comptes (produit/charge, ou client)
-- appliquent légitimement plusieurs taux de TVA différents selon les cas —
-- "mixte" permet de le dire explicitement, plutôt que de forcer un choix
-- artificiel ou de laisser le compte indéfiniment proposé comme "sans taux".
--
-- Côté compte produit/charge (taux_assigne_compte) : simple extension de la
-- liste de valeurs autorisées. Confirmé qu'aucun contrôle ne compare
-- actuellement ce taux à autre chose (utilisé uniquement pour ne plus
-- proposer le compte) — 'mixte' s'y intègre sans changement de logique de
-- calcul.
--
-- Côté client (taux_historique_tiers) : structurellement différent, la
-- colonne est un NUMERIC, pas un texte contraint. Rami a confirmé le sens
-- voulu : un client marqué "mixte" ne doit JAMAIS se voir appliquer un taux
-- par défaut fixe pour le chantier B (encaissements non lettrés) — retombe
-- sur la prudence habituelle (20%) comme si rien n'était confirmé. D'où :
-- rendre la colonne nullable, NULL représentant "mixte, mais confirmé" —
-- filtré à la lecture (dossierRepository.ts) pour ne jamais entrer dans
-- tauxHistorique[], ce qui déclenche automatiquement la prudence existante
-- sans toucher au chantier B lui-même.

ALTER TABLE taux_assigne_compte DROP CONSTRAINT taux_assigne_compte_taux_assigne_check;
ALTER TABLE taux_assigne_compte ADD CONSTRAINT taux_assigne_compte_taux_assigne_check
    CHECK (taux_assigne IN (
        '0', '2.1', '5.5', '10', '20',
        'autoliquide_intracom',
        'autoliquide_20', 'autoliquide_10', 'autoliquide_5.5',
        'mixte'
    ));

ALTER TABLE taux_historique_tiers ALTER COLUMN taux_habituel DROP NOT NULL;

COMMENT ON COLUMN taux_historique_tiers.taux_habituel IS
  'Taux habituel observé ou assigné pour ce client. NULL = confirmé comme '
  '"mixte" explicitement (le client applique plusieurs taux selon les cas) '
  '— distinct de l''absence de ligne confirmée, qui signifie "jamais '
  'examiné". Filtré à la lecture pour ne jamais alimenter tauxHistorique[], '
  'ce qui fait retomber le chantier B sur sa prudence habituelle (20%).';
