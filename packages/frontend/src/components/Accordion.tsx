import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

// Motif accordéon générique pour les listes potentiellement longues
// (anomalies, décisions validées, dossiers…) — un en-tête cliquable qui
// déplie le contenu, plutôt qu'une liste toujours entièrement affichée
// (brief v29 §3). `defaultOpen` laisse chaque appelant décider du
// comportement le plus lisible à son endroit, pas de règle imposée.
export function Accordion({
  titre,
  meta,
  defaultOpen = false,
  children,
}: {
  titre: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [ouvert, setOuvert] = useState(defaultOpen);

  return (
    <div className="accordion">
      <button type="button" className="accordion-header" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
        <ChevronDown size={15} className={`accordion-chevron${ouvert ? ' ouvert' : ''}`} aria-hidden="true" />
        <span className="accordion-titre">{titre}</span>
        {meta}
      </button>
      {ouvert && <div className="accordion-corps">{children}</div>}
    </div>
  );
}
