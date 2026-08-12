import { HelpCircle } from 'lucide-react';

// Info-bulle sobre au survol/focus — icône "?" à côté d'un libellé qui
// prête à confusion, plutôt qu'un paragraphe d'explication toujours visible.
export function InfoTooltip({ texte }: { texte: string }) {
  return (
    <span className="info-tooltip" tabIndex={0}>
      <HelpCircle size={13} aria-hidden="true" />
      <span className="info-tooltip-bulle" role="tooltip">
        {texte}
      </span>
    </span>
  );
}
