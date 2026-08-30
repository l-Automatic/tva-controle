import { useEffect, useState } from 'react';
import { ChevronDown, LogOut, Search } from 'lucide-react';
import { ApiError, fetchDossiers } from '../api';
import { ICONE_ZONE } from '../icons';
import { LIBELLE_ROLE, type Dossier, type Role } from '../types';

export type Zone = 'cycle' | 'configuration' | 'historique' | 'parametres' | 'utilisateurs';

export const ZONES: { id: Zone; libelle: string; description: string; roles?: Role[] }[] = [
  {
    id: 'cycle',
    libelle: 'Cycle',
    description:
      'Lance un calcul de TVA sur une période, affiche le résultat et les anomalies à traiter pour ce cycle précis.',
  },
  {
    id: 'configuration',
    libelle: 'Configuration du dossier',
    description:
      "Réglages fiscaux durables du dossier — s'appliquent à tous les cycles tant qu'ils ne sont pas modifiés.",
  },
  {
    id: 'historique',
    libelle: 'Historique',
    description: 'Calculs et anomalies de toutes les périodes passées, journal d’audit complet.',
  },
  {
    id: 'parametres',
    libelle: 'Paramètres',
    description:
      'Réglages techniques — clé Mistral (cabinet), et décisions déjà validées modifiables (confiance des tiers, comptes retirés d’une convention, taux rejetés).',
  },
  {
    id: 'utilisateurs',
    libelle: 'Utilisateurs',
    // Réservée à admin_cabinet côté backend (brief v25) — masquée
    // entièrement pour un collaborateur, pas juste désactivée.
    roles: ['admin_cabinet'],
    description: 'Ajoute des utilisateurs au cabinet, réinitialise un mot de passe oublié.',
  },
];

interface SidebarProps {
  cabinetId: string;
  role: Role;
  dossier: Dossier | null;
  onSelectDossier: (d: Dossier) => void;
  zone: Zone;
  onChangeZone: (z: Zone) => void;
  onDeconnexion: () => void;
  // Brief v27 : bumpé après "Synchroniser les dossiers" (Paramètres
  // cabinet) pour que les nouveaux dossiers apparaissent ici sans attendre
  // une nouvelle frappe dans le champ de recherche.
  dossiersRefreshKey?: number;
}

function RechercheDossier({
  cabinetId,
  onSelect,
  refreshKey,
}: {
  cabinetId: string;
  onSelect: (d: Dossier) => void;
  refreshKey?: number;
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
  }, [cabinetId, recherche, refreshKey]);

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
  role,
  dossier,
  onSelectDossier,
  zone,
  onChangeZone,
  onDeconnexion,
  dossiersRefreshKey = 0,
}: SidebarProps) {
  const [rechercheOuverte, setRechercheOuverte] = useState(!dossier);
  const zonesVisibles = ZONES.filter((z) => !z.roles || z.roles.includes(role));

  function handleSelect(d: Dossier) {
    onSelectDossier(d);
    setRechercheOuverte(false);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/favicon.svg" alt="" width={22} height={22} className="sidebar-brand-logo" />
        <span>TVA Contrôle</span>
      </div>

      <div className="sidebar-section">
        <p className="sidebar-section-titre">Dossier</p>
        {dossier && !rechercheOuverte ? (
          <button className="sidebar-dossier-actuel" onClick={() => setRechercheOuverte(true)}>
            <span className="sidebar-dossier-actuel-nom">{dossier.nom}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        ) : (
          <RechercheDossier cabinetId={cabinetId} onSelect={handleSelect} refreshKey={dossiersRefreshKey} />
        )}
      </div>

      {dossier && !rechercheOuverte && (
        <nav className="sidebar-nav">
          {zonesVisibles.map((z) => {
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
        <p className="sidebar-footer-role">{LIBELLE_ROLE[role]}</p>
        <button className="sidebar-logout" onClick={onDeconnexion}>
          <LogOut size={14} aria-hidden="true" />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
