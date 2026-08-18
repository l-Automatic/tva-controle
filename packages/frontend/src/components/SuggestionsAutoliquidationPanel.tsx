import { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { ApiError, ajouterConvention, confirmerConvention } from '../api';
import { useToast } from '../toast';
import type { CompteACategoriser } from '../types';

const CLE_CHARGE_AUTOLIQUIDATION = 'comptes_charge_autoliquidation';
const LIBELLE_CONFIANCE = { haute: 'Confiance haute', moyenne: 'Confiance moyenne', basse: 'Confiance basse' } as const;

interface SuggestionsAutoliquidationPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  suggestions: CompteACategoriser[];
  onConsomme: (compte: string) => void;
}

function SuggestionRow({
  compte,
  cabinetId,
  dossierId,
  utilisateurId,
  onConfirme,
}: {
  compte: CompteACategoriser;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onConfirme: () => void;
}) {
  const [enCours, setEnCours] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleConfirmer() {
    setEnCours(true);
    setError(null);
    try {
      const { id } = await ajouterConvention(cabinetId, dossierId, utilisateurId, CLE_CHARGE_AUTOLIQUIDATION, [
        compte.compte,
      ]);
      await confirmerConvention(cabinetId, id, utilisateurId);
      notifier(`Compte ${compte.compte} ajouté aux comptes d'autoliquidation`);
      onConfirme();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec de l'ajout du compte ${compte.compte}`);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <li className="card">
      <p className="label">Compte {compte.compte}</p>
      {compte.exemplesLibelle.length > 0 && <p className="reference">{compte.exemplesLibelle.join(' · ')}</p>}
      {compte.suggestionIA && (
        <p className="suggestion-ia">
          <Lightbulb size={14} aria-hidden="true" />
          <span>
            <span className={`badge confiance-${compte.suggestionIA.confiance}`}>
              {LIBELLE_CONFIANCE[compte.suggestionIA.confiance]}
            </span>{' '}
            {compte.suggestionIA.justification}
          </span>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button disabled={enCours} onClick={() => void handleConfirmer()}>
          {enCours ? '…' : 'Confirmer'}
        </button>
      </div>
    </li>
  );
}

// Suggestions IA (brief v10) pour le compte de charge dédié à
// l'autoliquidation — distinct du popup de catégorisation des comptes
// produit/charge : ici on complète une convention déjà partiellement
// identifiée (comptes_charge_service) avec sa sous-catégorie plus précise.
// N'apparaît que si le dernier cycle a produit des suggestions ; disparaît
// dès qu'un compte est confirmé ou qu'un nouveau cycle est lancé.
export function SuggestionsAutoliquidationPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  suggestions,
  onConsomme,
}: SuggestionsAutoliquidationPanelProps) {
  if (suggestions.length === 0) return null;

  return (
    <section className="panel-section">
      <div className="panel-header">
        <h2>Comptes d'autoliquidation suggérés ({suggestions.length})</h2>
      </div>
      <p className="reference">
        Détectés parmi les comptes de charge de service sans sous-catégorie d'autoliquidation — confirmez pour les
        ajouter à la convention <code>comptes_charge_autoliquidation</code>.
      </p>
      <ul className="card-list">
        {suggestions.map((c) => (
          <SuggestionRow
            key={c.compte}
            compte={c}
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            onConfirme={() => onConsomme(c.compte)}
          />
        ))}
      </ul>
    </section>
  );
}
