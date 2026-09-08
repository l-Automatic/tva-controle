import { useEffect, useState } from 'react';

interface JaugeChargementProps {
  phase: 'chargement' | 'succes';
  messageSucces: string;
}

// Jauge de chargement partagée (brief v59) — extraite de CycleLoadingPopup
// pour être réutilisable ailleurs qu'en plein popup dédié (ex : à
// l'intérieur d'un popup déjà ouvert, comme les portes obligatoires),
// cohérence visuelle stricte entre les deux usages : mêmes messages
// rotatifs pendant le chargement (sans lien réel avec une progression
// serveur, cf. brief v8) et même coche animée à la fin.
//
// La coche signale la FIN du chargement, jamais l'absence d'éléments à
// traiter (brief v59) — messageSucces peut varier selon ce qui a été
// trouvé, mais la coche elle-même doit toujours apparaître une fois la
// phase 'succes' atteinte, sans condition sur le contenu.
const MESSAGES_CHARGEMENT = [
  'Récupération des écritures…',
  'Analyse des règles fiscales…',
  'Vérification des anomalies…',
];

export function JaugeChargement({ phase, messageSucces }: JaugeChargementProps) {
  const [indexMessage, setIndexMessage] = useState(0);

  useEffect(() => {
    if (phase !== 'chargement') return;
    const id = setInterval(() => {
      setIndexMessage((i) => (i + 1) % MESSAGES_CHARGEMENT.length);
    }, 2200);
    return () => clearInterval(id);
  }, [phase]);

  return phase === 'chargement' ? (
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
  );
}
