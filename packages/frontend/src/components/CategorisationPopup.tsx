import { useState } from 'react';
import { X } from 'lucide-react';
import { ApiError, ajouterConvention, confirmerConvention } from '../api';
import { useToast } from '../toast';
import { SuggestionIABlock } from './SuggestionIABlock';
import type { CompteACategoriser } from '../types';

interface CategorisationPopupProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  comptes: CompteACategoriser[];
  onClose: () => void;
}

const CHOIX = [
  { cle: 'comptes_vente_service', libelle: 'Vente de service' },
  { cle: 'comptes_charge_service', libelle: 'Charge de service' },
  { cle: 'comptes_equipement', libelle: 'Équipement' },
  { cle: 'comptes_carburant', libelle: 'Carburant' },
  { cle: 'comptes_cadeaux', libelle: 'Cadeaux clients' },
  { cle: 'comptes_immobilisation', libelle: 'Immobilisation' },
] as const;

function CompteCard({
  compte,
  cabinetId,
  dossierId,
  utilisateurId,
  onTraite,
}: {
  compte: CompteACategoriser;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onTraite: () => void;
}) {
  // Présélection IA (brief v10) : le select part pré-rempli sur la suggestion
  // si elle existe et n'est pas null, mais rien n'est envoyé au serveur tant
  // que l'utilisateur n'a pas lui-même cliqué sur "Ajouter" — la présélection
  // n'est qu'un point de départ, jamais une validation implicite.
  const [cle, setCle] = useState(compte.suggestionIA?.categorieSuggeree ?? '');
  const [enCours, setEnCours] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleAjouter() {
    if (!cle) return;
    const libelle = CHOIX.find((c) => c.cle === cle)?.libelle ?? cle;
    setEnCours(true);
    setError(null);
    try {
      const { id } = await ajouterConvention(cabinetId, dossierId, utilisateurId, cle, [compte.compte]);
      await confirmerConvention(cabinetId, id, utilisateurId);
      notifier(`Compte ${compte.compte} catégorisé — ${libelle}`);
      onTraite();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec de la catégorisation du compte ${compte.compte}`);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <li className="card">
      <p className="label">Compte {compte.compte}</p>
      {compte.exemplesLibelle.length > 0 && <p className="reference">{compte.exemplesLibelle.join(' · ')}</p>}
      {compte.suggestionIA && <SuggestionIABlock suggestion={compte.suggestionIA} />}
      {error && <p className="error">{error}</p>}
      <div className="popup-choix">
        <select value={cle} disabled={enCours} onChange={(e) => setCle(e.target.value)}>
          <option value="">Choisir une catégorie…</option>
          {CHOIX.map((c) => (
            <option key={c.cle} value={c.cle}>
              {c.libelle}
            </option>
          ))}
        </select>
        <button disabled={enCours || !cle} onClick={() => void handleAjouter()}>
          {enCours ? '…' : 'Ajouter'}
        </button>
        <button className="secondary" disabled={enCours} onClick={onTraite}>
          Aucune de celles-là
        </button>
      </div>
    </li>
  );
}

// Comptes produit/charge mouvementés sur la période mais absents des 6
// conventions — proposés nus si aucune suggestion IA n'est disponible pour
// ce compte (cf. brief v2 section 5 ; 5ᵉ catégorie "cadeaux clients" en v6,
// 6ᵉ "immobilisation" en v9). La présélection IA (v10) reste une simple
// suggestion : jamais de validation automatique, l'ajout requiert toujours
// un clic explicite sur "Ajouter". Fermer sans tout traiter est normal :
// les comptes non traités réapparaîtront au prochain cycle.
export function CategorisationPopup({
  cabinetId,
  dossierId,
  utilisateurId,
  comptes: comptesInitiaux,
  onClose,
}: CategorisationPopupProps) {
  const [comptes, setComptes] = useState(comptesInitiaux);

  function retirer(compte: string) {
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
          Ces comptes produit/charge ont bougé sur la période mais ne sont dans aucune des 6 conventions. Les
          comptes non traités réapparaîtront au prochain cycle.
        </p>
        {comptes.length === 0 ? (
          <p className="empty">Tous les comptes ont été traités.</p>
        ) : (
          <ul className="card-list">
            {comptes.map((c) => (
              <CompteCard
                key={c.compte}
                compte={c}
                cabinetId={cabinetId}
                dossierId={dossierId}
                utilisateurId={utilisateurId}
                onTraite={() => retirer(c.compte)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
