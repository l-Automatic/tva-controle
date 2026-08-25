import { BookCheck, Lightbulb } from 'lucide-react';
import type { SuggestionIA } from '../types';

const LIBELLE_CONFIANCE = { haute: 'Confiance haute', moyenne: 'Confiance moyenne', basse: 'Confiance basse' } as const;

// Extrait de CategorisationPopup et SuggestionsAutoliquidationPanel (brief
// v11) — une suggestion 'plan_comptable' vient d'un référentiel déterministe
// (aucun appel réseau, aucune erreur possible), un niveau de confiance
// haute/moyenne/basse n'a pas de sens pour elle : badge et icône distincts,
// sans rien qui évoque une estimation.
export function SuggestionIABlock({ suggestion }: { suggestion: SuggestionIA }) {
  if (suggestion.source === 'plan_comptable') {
    return (
      <p className="suggestion-ia">
        <BookCheck size={14} aria-hidden="true" />
        <span>
          <span className="badge badge-plan-comptable">Déterminé par le plan comptable</span> {suggestion.justification}
        </span>
      </p>
    );
  }

  return (
    <p className="suggestion-ia">
      <Lightbulb size={14} aria-hidden="true" />
      <span>
        <span className={`badge confiance-${suggestion.confiance}`}>{LIBELLE_CONFIANCE[suggestion.confiance]}</span>{' '}
        {suggestion.justification}
      </span>
    </p>
  );
}
