-- ============================================================================
-- 027 : corrige un bug réel dans protect_calcul_tva_lignes (10/08, trouvé
-- par Rami en conditions réelles pendant un nettoyage de données de test)
-- ============================================================================
-- Le trigger allait chercher le statut du calcul parent via un SELECT — mais
-- lors d'une suppression EN CASCADE (DELETE FROM dossiers, qui cascade
-- jusqu'à calculs_tva puis calculs_tva_lignes), le calcul parent peut déjà
-- avoir disparu au moment où le trigger se déclenche sur les lignes
-- enfants. Le SELECT ne trouve alors rien, v_statut reste NULL, et
-- "NULL IS DISTINCT FROM 'brouillon'" vaut TRUE (contrairement à une
-- comparaison classique avec NULL) — l'exception se déclenchait donc à
-- tort sur une suppression en cascade parfaitement légitime, jamais une
-- vraie tentative de modifier les lignes d'un calcul validé.
--
-- Corrigé : si le calcul parent n'existe plus DU TOUT (NOT FOUND), c'est
-- que sa propre suppression est déjà en cours — les lignes doivent
-- pouvoir suivre sans blocage. L'exception ne se déclenche désormais que
-- si le calcul EXISTE encore et n'est pas en brouillon, exactement le cas
-- que ce trigger est censé empêcher.

CREATE OR REPLACE FUNCTION protect_calcul_tva_lignes()
RETURNS TRIGGER AS $$
DECLARE
    v_statut TEXT;
BEGIN
    SELECT statut INTO v_statut
    FROM calculs_tva
    WHERE id = COALESCE(OLD.calcul_id, NEW.calcul_id);

    IF NOT FOUND THEN
        -- Le calcul parent a déjà disparu — suppression en cascade
        -- légitime depuis calculs_tva (ou plus haut, dossiers), jamais
        -- une modification directe des lignes à bloquer.
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF v_statut IS DISTINCT FROM 'brouillon' THEN
        RAISE EXCEPTION 'Lignes de calcul TVA du calcul % : modification interdite hors statut brouillon (statut actuel : %)',
            COALESCE(OLD.calcul_id, NEW.calcul_id), v_statut;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
