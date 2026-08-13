import { useState } from 'react';
import { Fuel, Gift, Package, ShoppingCart, Wrench, X } from 'lucide-react';
import { ApiError, ajouterConvention, confirmerConvention } from '../api';
import { useToast } from '../toast';
import type { CompteACategoriser } from '../types';

interface CategorisationPopupProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  comptes: CompteACategoriser[];
  onClose: () => void;
}

const CHOIX = [
  { cle: 'comptes_vente_service', libelle: 'Vente de service', Icone: ShoppingCart },
  { cle: 'comptes_charge_service', libelle: 'Charge de service', Icone: Wrench },
  { cle: 'comptes_equipement', libelle: 'Équipement', Icone: Package },
  { cle: 'comptes_carburant', libelle: 'Carburant', Icone: Fuel },
  { cle: 'comptes_cadeaux', libelle: 'Cadeaux clients', Icone: Gift },
] as const;

// Comptes produit/charge mouvementés sur la période mais absents des 5
// conventions — proposés nus, sans présélection IA (chantier séparé pas
// construit, cf. brief v2 section 5 ; 5ᵉ catégorie "cadeaux clients"
// ajoutée en v6). Fermer sans tout traiter est normal : les comptes non
// traités réapparaîtront au prochain cycle.
export function CategorisationPopup({
  cabinetId,
  dossierId,
  utilisateurId,
  comptes: comptesInitiaux,
  onClose,
}: CategorisationPopupProps) {
  const [comptes, setComptes] = useState(comptesInitiaux);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleCategoriser(compte: string, cle: string, libelle: string) {
    setEnCours(compte);
    setError(null);
    try {
      const { id } = await ajouterConvention(cabinetId, dossierId, utilisateurId, cle, [compte]);
      await confirmerConvention(cabinetId, id, utilisateurId);
      notifier(`Compte ${compte} catégorisé — ${libelle}`);
      setComptes((prev) => prev.filter((c) => c.compte !== compte));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec de la catégorisation du compte ${compte}`);
    } finally {
      setEnCours(null);
    }
  }

  function handleIgnorer(compte: string) {
    setComptes((prev) => prev.filter((c) => c.compte !== compte));
  }

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true" aria-label="Catégorisation des comptes">
      <div className="popup">
        <div className="popup-header">
          <h2>Comptes à catégoriser ({comptes.length})</h2>
          <button className="popup-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <p className="reference">
          Ces comptes produit/charge ont bougé sur la période mais ne sont dans aucune des 5 conventions. Les
          comptes non traités réapparaîtront au prochain cycle.
        </p>
        {error && <p className="error">{error}</p>}
        {comptes.length === 0 ? (
          <p className="empty">Tous les comptes ont été traités.</p>
        ) : (
          <ul className="card-list">
            {comptes.map((c) => (
              <li key={c.compte} className="card">
                <p className="label">Compte {c.compte}</p>
                {c.exemplesLibelle.length > 0 && (
                  <p className="reference">{c.exemplesLibelle.join(' · ')}</p>
                )}
                <div className="popup-choix">
                  {CHOIX.map(({ cle, libelle, Icone }) => (
                    <button
                      key={cle}
                      disabled={enCours === c.compte}
                      onClick={() => void handleCategoriser(c.compte, cle, libelle)}
                    >
                      <Icone size={14} aria-hidden="true" />
                      {libelle}
                    </button>
                  ))}
                  <button
                    className="secondary"
                    disabled={enCours === c.compte}
                    onClick={() => handleIgnorer(c.compte)}
                  >
                    Aucune de celles-là
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
