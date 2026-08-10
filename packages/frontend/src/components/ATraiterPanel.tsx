import { useEffect, useState } from 'react';
import { ApiError, fetchElementsATraiter } from '../api';
import { ICONE_ELEMENT_A_TRAITER } from '../icons';
import type { ElementATraiter } from '../types';

interface ATraiterPanelProps {
  cabinetId: string;
  dossierId: string;
  onNaviguer: (element: ElementATraiter) => void;
  refreshKey: number;
}

const LIBELLE_TYPE: Record<ElementATraiter['type'], string> = {
  anomalie_bloquante: 'Anomalie bloquante',
  convention_candidate: 'Convention à confirmer',
  taux_candidate: 'Taux à confirmer',
  taux_tiers_candidate: 'Taux client à confirmer',
  calcul_brouillon: 'Calcul en attente',
};

export function ATraiterPanel({ cabinetId, dossierId, onNaviguer, refreshKey }: ATraiterPanelProps) {
  const [elements, setElements] = useState<ElementATraiter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchElementsATraiter(cabinetId, dossierId);
      setElements(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les éléments à traiter');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId, refreshKey]);

  if (loading && elements.length === 0) return null;
  if (error) return <p className="error">{error}</p>;
  if (elements.length === 0) {
    return <p className="a-traiter-vide">Rien en attente de décision sur ce dossier.</p>;
  }

  return (
    <section className="panel panel-full a-traiter-panel">
      <div className="panel-header">
        <h2>À traiter ({elements.length})</h2>
      </div>
      <ul className="card-list">
        {elements.map((el) => (
          <li key={`${el.type}-${el.id}`} className="card a-traiter-card" onClick={() => onNaviguer(el)}>
            <div className="card-header">
              <span className="badge a-traiter-badge">
                {(() => {
                  const Icone = ICONE_ELEMENT_A_TRAITER[el.type];
                  return <Icone size={12} aria-hidden="true" />;
                })()}
                {LIBELLE_TYPE[el.type]}
              </span>
            </div>
            <p className="label">{el.resume}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
