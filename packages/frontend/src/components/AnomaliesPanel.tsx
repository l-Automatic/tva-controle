import { useEffect, useState } from 'react';
import {
  ApiError,
  fetchAnomalies,
  justifierAnomalie,
  resoudreAnomalie,
} from '../api';
import type { Anomalie, GraviteAnomalie, StatutAnomalie } from '../types';

interface AnomaliesPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

const LIBELLE_STATUT: Record<StatutAnomalie, string> = {
  ouvert: 'Ouverte',
  resolu: 'Résolue',
  justifie: 'Justifiée',
};

const LIBELLE_GRAVITE: Record<GraviteAnomalie, string> = {
  bloquant: 'Bloquant',
  signale: 'Signalé',
  info: 'Info',
};

function detailsLisibles(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  // Cas concret : anomalies de groupe de lettrage (paiement_partiel_a_verifier)
  // — les autres pièces du groupe sont la seule info qui permette d'aller
  // vérifier manuellement dans Pennylane, donc on les met en avant plutôt
  // que de les enterrer dans un bloc JSON générique.
  if (Array.isArray(d.groupeIds)) {
    return `Autres pièces du même groupe de lettrage : ${d.groupeIds.join(', ')}`;
  }
  return JSON.stringify(details, null, 2);
}

function AnomalieRow({
  anomalie,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  anomalie: Anomalie;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [commentaire, setCommentaire] = useState('');
  const [submitting, setSubmitting] = useState<'resoudre' | 'justifier' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResoudre() {
    setSubmitting('resoudre');
    setError(null);
    try {
      await resoudreAnomalie(cabinetId, anomalie.id, utilisateurId, commentaire || undefined);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la résolution');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleJustifier() {
    if (!commentaire.trim()) {
      setError('Un commentaire est requis pour justifier une anomalie');
      return;
    }
    setSubmitting('justifier');
    setError(null);
    try {
      await justifierAnomalie(cabinetId, anomalie.id, utilisateurId, commentaire);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la justification');
    } finally {
      setSubmitting(null);
    }
  }

  const estOuverte = anomalie.statut === 'ouvert';
  const details = detailsLisibles(anomalie.details);

  return (
    <li className={`card anomalie gravite-${anomalie.gravite}`}>
      <div className="card-header">
        <span className={`badge statut-${anomalie.statut}`}>{LIBELLE_STATUT[anomalie.statut]}</span>
        <span className={`badge gravite-badge-${anomalie.gravite}`}>{LIBELLE_GRAVITE[anomalie.gravite]}</span>
        <span className="type-anomalie">{anomalie.typeAnomalie}</span>
        <span className="periode">{anomalie.periode}</span>
      </div>
      <p className="description">{anomalie.description}</p>
      {anomalie.compte && <p className="reference">Compte : {anomalie.compte}</p>}
      {anomalie.referencePiece && (
        <p className="reference">Pièce : {anomalie.referencePiece}</p>
      )}
      {details && <p className="reference details">{details}</p>}

      {estOuverte && (
        <div className="actions">
          <input
            type="text"
            placeholder="Commentaire (requis pour justifier)"
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            disabled={submitting !== null}
          />
          <button onClick={handleResoudre} disabled={submitting !== null}>
            {submitting === 'resoudre' ? '…' : 'Résoudre'}
          </button>
          <button onClick={handleJustifier} disabled={submitting !== null} className="secondary">
            {submitting === 'justifier' ? '…' : 'Justifier'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

export function AnomaliesPanel({ cabinetId, dossierId, utilisateurId }: AnomaliesPanelProps) {
  const [anomalies, setAnomalies] = useState<Anomalie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [afficherTraitees, setAfficherTraitees] = useState(false);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAnomalies(cabinetId, dossierId);
      setAnomalies(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les anomalies');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  const visibles = afficherTraitees ? anomalies : anomalies.filter((a) => a.statut === 'ouvert');
  const nbOuvertes = anomalies.filter((a) => a.statut === 'ouvert').length;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Anomalies ({nbOuvertes} ouverte{nbOuvertes === 1 ? '' : 's'})</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={afficherTraitees}
            onChange={(e) => setAfficherTraitees(e.target.checked)}
          />
          Afficher les anomalies traitées
        </label>
        <button onClick={() => void charger()} disabled={loading}>
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && visibles.length === 0 && <p className="empty">Aucune anomalie à afficher.</p>}
      <ul className="card-list">
        {visibles.map((a) => (
          <AnomalieRow
            key={a.id}
            anomalie={a}
            cabinetId={cabinetId}
            utilisateurId={utilisateurId}
            onChanged={() => void charger()}
          />
        ))}
      </ul>
    </section>
  );
}
