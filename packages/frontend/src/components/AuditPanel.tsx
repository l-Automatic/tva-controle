import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { ApiError, fetchAudit, telechargerExportAudit } from '../api';
import type { ActeurAudit, AuditEvenement } from '../types';

interface AuditPanelProps {
  cabinetId: string;
  dossierId: string;
}

const LIBELLE_ACTEUR: Record<ActeurAudit, string> = {
  utilisateur: 'Humain',
  systeme: 'Automatique',
  agent: 'Agent (LLM)',
};

function formatHorodatage(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR');
  } catch {
    return iso;
  }
}

function EvenementRow({ evenement }: { evenement: AuditEvenement }) {
  return (
    <li className={`card audit-evenement acteur-${evenement.acteur}`}>
      <div className="card-header">
        <span className={`badge acteur-badge-${evenement.acteur}`}>{LIBELLE_ACTEUR[evenement.acteur]}</span>
        <span className="type-evenement">{evenement.typeEvenement}</span>
        <span className="module-source">{evenement.moduleSource}</span>
        <span className="horodatage">{formatHorodatage(evenement.horodatage)}</span>
      </div>
      {evenement.acteurNom && <p className="reference">Par : {evenement.acteurNom}</p>}
      {evenement.details !== null && evenement.details !== undefined && (
        <pre className="details">{JSON.stringify(evenement.details, null, 2)}</pre>
      )}
    </li>
  );
}

export function AuditPanel({ cabinetId, dossierId }: AuditPanelProps) {
  const [evenements, setEvenements] = useState<AuditEvenement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtreActeur, setFiltreActeur] = useState<'' | ActeurAudit>('');
  const [filtreType, setFiltreType] = useState('');
  const [exporting, setExporting] = useState(false);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAudit(cabinetId, dossierId, {
        ...(filtreActeur ? { acteur: filtreActeur } : {}),
        ...(filtreType.trim() ? { typeEvenement: filtreType.trim() } : {}),
      });
      setEvenements(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger le journal d’audit');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId, filtreActeur]);

  async function handleExporter() {
    setExporting(true);
    setError(null);
    try {
      await telechargerExportAudit(cabinetId, dossierId, {
        ...(filtreActeur ? { acteur: filtreActeur } : {}),
        ...(filtreType.trim() ? { typeEvenement: filtreType.trim() } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’export');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Audit ({evenements.length})</h2>
        <select value={filtreActeur} onChange={(e) => setFiltreActeur(e.target.value as '' | ActeurAudit)}>
          <option value="">Tous les acteurs</option>
          <option value="utilisateur">Humain</option>
          <option value="systeme">Automatique</option>
          <option value="agent">Agent (LLM)</option>
        </select>
        <input
          type="text"
          placeholder="Filtrer par type d'événement (ex : calcul_valide)"
          value={filtreType}
          onChange={(e) => setFiltreType(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void charger()}
        />
        <button onClick={() => void charger()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" />
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
        <button onClick={() => void handleExporter()} disabled={exporting} className="secondary">
          <Download size={14} aria-hidden="true" />
          {exporting ? 'Export…' : 'Exporter en CSV'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && evenements.length === 0 && <p className="empty">Aucun événement à afficher.</p>}
      <ul className="card-list">
        {evenements.map((e) => (
          <EvenementRow key={e.id} evenement={e} />
        ))}
      </ul>
    </section>
  );
}
