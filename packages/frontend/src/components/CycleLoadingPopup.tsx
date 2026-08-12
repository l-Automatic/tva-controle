import { useEffect, useState } from 'react';

interface CycleLoadingPopupProps {
  phase: 'chargement' | 'succes';
  messageSucces: string;
}

// Aucune progression étape par étape côté API — ces messages n'ont aucun
// lien réel avec ce qui se passe côté serveur, juste de quoi meubler
// l'attente sans faire croire à une barre de progression réelle (cf.
// brief v8, section 1).
const MESSAGES_CHARGEMENT = [
  'Récupération des écritures…',
  'Analyse des règles fiscales…',
  'Vérification des anomalies…',
];

export function CycleLoadingPopup({ phase, messageSucces }: CycleLoadingPopupProps) {
  const [indexMessage, setIndexMessage] = useState(0);

  useEffect(() => {
    if (phase !== 'chargement') return;
    const id = setInterval(() => {
      setIndexMessage((i) => (i + 1) % MESSAGES_CHARGEMENT.length);
    }, 2200);
    return () => clearInterval(id);
  }, [phase]);

  return (
    <div className="popup-overlay">
      <div className="popup popup-cycle-loading" role="status" aria-live="polite">
        {phase === 'chargement' ? (
          <>
            <div className="barre-indeterminee">
              <div className="barre-indeterminee-remplissage" />
            </div>
            <p className="popup-cycle-message">{MESSAGES_CHARGEMENT[indexMessage]}</p>
          </>
        ) : (
          <>
            <svg className="check-anime" viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
              <circle className="check-anime-cercle" cx="26" cy="26" r="24" fill="none" pathLength="100" />
              <path className="check-anime-trait" fill="none" d="M14 27l7 7 17-17" pathLength="100" />
            </svg>
            <p className="popup-cycle-message">{messageSucces}</p>
          </>
        )}
      </div>
    </div>
  );
}
