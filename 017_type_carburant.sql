-- ============================================================================
-- 017 : type de carburant par véhicule (prépare le chantier correspondance
-- carburant/véhicule, documenté dans REGLES_FISCALES_ET_TACHES.md, pas
-- encore construit — ce champ permet de commencer à collecter la donnée
-- dès maintenant, plutôt que de devoir la rattraper plus tard sur des
-- véhicules déjà ajoutés sans cette info).
-- ============================================================================

ALTER TABLE immobilisations
    ADD COLUMN type_carburant TEXT
        CHECK (type_carburant IN ('diesel', 'essence'));

COMMENT ON COLUMN immobilisations.type_carburant IS
  'Carburant du véhicule (diesel/essence) — optionnel, NULL = non renseigné. '
  'Utilisé par le futur contrôle de correspondance carburant/véhicule '
  '(comparaison avec le libellé des factures de carburant), pas encore '
  'construit. N''a aucun effet sur le calcul tant que ce contrôle n''existe pas.';
