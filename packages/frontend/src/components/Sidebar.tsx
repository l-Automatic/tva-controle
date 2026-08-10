import { useEffect, useState } from 'react';
import { ChevronDown, Search, ShieldCheck } from 'lucide-react';
import { ApiError, fetchDossiers } from '../api';
import { ICONE_ZONE } from '../icons';
import type { Dossier } from '../types';

export type Zone = 'cycle' | 'configuration' | 'historique' | 'parametres';

const ZONES: { id: Zone; libelle: string }[] = [
  { id: 'cycle', libelle: 'Cycle' },
  { id: 'configuration', libelle: 'Configuration du dossier' },
  { id: 'historique', libelle: 'Historique' },
  { id: 'parametres', libelle: 'Paramètres' },
];

interface SidebarProps {
  cabinetId: string;
  utilisateurId: string;
  onIdentiteChange: (champ: 'cabinetId' | 'utilisateurId', valeur: string) => void;
  dossier: Dossier | null;
  onSelectDossier: (d: Dossier) => void;
  zone: Zone;
  onChangeZone: (z: Zone) => void;
}

function RechercheDossier({
  cabinetId,
  onSelect,
}: {
  cabinetId: string;
  onSelect: (d: Dossier) => void;
}) {
  const [recherche, setRecherche] = useState('');
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cabinetId) return;
    const id = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        setDossiers(await fetchDossiers(cabinetId, recherche.trim() || undefined));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Impossible de charger les dossiers');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [cabinetId, recherche]);

  return (
    <div className="sidebar-recherche">
      <div className="sidebar-search-input">
        <Search size={15} aria-hidden="true" />
        <input
          type="text"
          placeholder="Rechercher un dossier…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          autoFocus
        />
      </div>
      {error && <p className="sidebar-error">{error}</p>}
      {loading && dossiers.length === 0 && <p className="sidebar-vide">Recherche…</p>}
      {!loading && dossiers.length === 0 && <p className="sidebar-vide">Aucun dossier trouvé.</p>}
      <ul className="sidebar-dossier-liste">
        {dossiers.map((d) => (
          <li key={d.id}>
            <button className="sidebar-dossier-item" onClick={() => onSelect(d)}>
              <span className="sidebar-dossier-item-nom">{d.nom}</span>
              <span className="sidebar-dossier-item-meta">{d.regimeTva}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Volet latéral fixe façon Pennylane : sélection/recherche de dossier et
// les 4 zones — la bannière "à traiter" reste dans le contenu principal,
// pas ici (cf. brief v2, section 1).
export function Sidebar({
  cabinetId,
  utilisateurId,
  onIdentiteChange,
  dossier,
  onSelectDossier,
  zone,
  onChangeZone,
}: SidebarProps) {
  const [rechercheOuverte, setRechercheOuverte] = useState(!dossier);

  function handleSelect(d: Dossier) {
    onSelectDossier(d);
    setRechercheOuverte(false);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <ShieldCheck size={20} aria-hidden="true" />
        <span>Module 6</span>
      </div>

      <div className="sidebar-section">
        <p className="sidebar-section-titre">Dossier</p>
        {dossier && !rechercheOuverte ? (
          <button className="sidebar-dossier-actuel" onClick={() => setRechercheOuverte(true)}>
            <span className="sidebar-dossier-actuel-nom">{dossier.nom}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        ) : (
          <RechercheDossier cabinetId={cabinetId} onSelect={handleSelect} />
        )}
      </div>

      {dossier && !rechercheOuverte && (
        <nav className="sidebar-nav">
          {ZONES.map((z) => {
            const Icone = ICONE_ZONE[z.id];
            return (
              <button
                key={z.id}
                className={`sidebar-nav-item${zone === z.id ? ' actif' : ''}`}
                onClick={() => onChangeZone(z.id)}
              >
                <Icone size={17} aria-hidden="true" />
                <span>{z.libelle}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="sidebar-footer">
        <p className="sidebar-section-titre">Session</p>
        <label className="sidebar-footer-label">
          Cabinet
          <input
            type="text"
            value={cabinetId}
            onChange={(e) => onIdentiteChange('cabinetId', e.target.value)}
            placeholder="UUID du cabinet"
          />
        </label>
        <label className="sidebar-footer-label">
          Utilisateur
          <input
            type="text"
            value={utilisateurId}
            onChange={(e) => onIdentiteChange('utilisateurId', e.target.value)}
            placeholder="UUID de l'utilisateur"
          />
        </label>
      </div>
    </aside>
  );
}
