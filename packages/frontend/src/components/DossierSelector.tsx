import { useEffect, useState } from 'react';
import { ApiError, fetchDossiers } from '../api';
import type { Dossier, StatutDossier } from '../types';

interface DossierSelectorProps {
  cabinetId: string;
  onSelect: (dossier: Dossier) => void;
}

const LIBELLE_STATUT: Record<StatutDossier, string> = {
  onboarding: 'Onboarding',
  actif: 'Actif',
  inactif: 'Inactif',
};

export function DossierSelector({ cabinetId, onSelect }: DossierSelectorProps) {
  const [recherche, setRecherche] = useState('');
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function charger(q: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDossiers(cabinetId, q.trim() || undefined);
      setDossiers(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les dossiers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!cabinetId) return;
    const id = setTimeout(() => void charger(recherche), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, recherche]);

  return (
    <section className="dossier-selector">
      <h2>Sélectionner un dossier</h2>
      <input
        type="text"
        className="dossier-selector-search"
        placeholder="Rechercher un dossier par nom…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        autoFocus
      />
      {error && <p className="error">{error}</p>}
      {loading && dossiers.length === 0 && <p className="empty">Recherche…</p>}
      {!loading && dossiers.length === 0 && <p className="empty">Aucun dossier trouvé.</p>}
      <ul className="card-list">
        {dossiers.map((d) => (
          <li key={d.id} className="card dossier-card" onClick={() => onSelect(d)}>
            <div className="card-header">
              <span className={`badge statut-carte-${d.statut === 'actif' ? 'valide' : d.statut === 'inactif' ? 'rejete' : 'brouillon'}`}>
                {LIBELLE_STATUT[d.statut]}
              </span>
              <span className="reference">{d.regimeTva}</span>
            </div>
            <p className="label">{d.nom}</p>
            {d.siren && <p className="reference">SIREN {d.siren}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
