import { useEffect, useState } from 'react';
import { ApiError } from '../api';
import type { Proposition, StatutProposition } from '../types';

interface PropositionsPanelProps {
  title: string;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  fetchPropositions: (cabinetId: string, dossierId: string, statut?: string) => Promise<Proposition[]>;
  confirmer: (cabinetId: string, id: string, utilisateurId: string) => Promise<void>;
  rejeter: (cabinetId: string, id: string) => Promise<void>;
  renderLabel: (proposition: Proposition) => string;
}

const LIBELLE_STATUT: Record<StatutProposition, string> = {
  candidate: 'En attente',
  confirmed: 'Confirmée',
  rejected: 'Rejetée',
};

function PropositionRow({
  proposition,
  cabinetId,
  utilisateurId,
  confirmer,
  rejeter,
  renderLabel,
  onChanged,
}: {
  proposition: Proposition;
  cabinetId: string;
  utilisateurId: string;
  confirmer: PropositionsPanelProps['confirmer'];
  rejeter: PropositionsPanelProps['rejeter'];
  renderLabel: PropositionsPanelProps['renderLabel'];
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState<'confirmer' | 'rejeter' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirmer() {
    setSubmitting('confirmer');
    setError(null);
    try {
      await confirmer(cabinetId, proposition.id, utilisateurId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la confirmation');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRejeter() {
    setSubmitting('rejeter');
    setError(null);
    try {
      await rejeter(cabinetId, proposition.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du rejet');
    } finally {
      setSubmitting(null);
    }
  }

  const estCandidate = proposition.statut === 'candidate';

  return (
    <li className="card proposition">
      <div className="card-header">
        <span className={`badge statut-${proposition.statut}`}>{LIBELLE_STATUT[proposition.statut]}</span>
        <span className="source">{proposition.source}</span>
      </div>
      <p className="label">{renderLabel(proposition)}</p>
      {proposition.confidenceNote && <p className="reference">{proposition.confidenceNote}</p>}

      {estCandidate && (
        <div className="actions">
          <button onClick={handleConfirmer} disabled={submitting !== null}>
            {submitting === 'confirmer' ? '…' : 'Confirmer'}
          </button>
          <button onClick={handleRejeter} disabled={submitting !== null} className="secondary">
            {submitting === 'rejeter' ? '…' : 'Rejeter'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

export function PropositionsPanel({
  title,
  cabinetId,
  dossierId,
  utilisateurId,
  fetchPropositions,
  confirmer,
  rejeter,
  renderLabel,
}: PropositionsPanelProps) {
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [afficherTraitees, setAfficherTraitees] = useState(false);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPropositions(cabinetId, dossierId);
      setPropositions(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Impossible de charger : ${title}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  const visibles = afficherTraitees ? propositions : propositions.filter((p) => p.statut === 'candidate');
  const nbEnAttente = propositions.filter((p) => p.statut === 'candidate').length;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>
          {title} ({nbEnAttente} en attente)
        </h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={afficherTraitees}
            onChange={(e) => setAfficherTraitees(e.target.checked)}
          />
          Afficher les propositions traitées
        </label>
        <button onClick={() => void charger()} disabled={loading}>
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && visibles.length === 0 && <p className="empty">Aucune proposition à afficher.</p>}
      <ul className="card-list">
        {visibles.map((p) => (
          <PropositionRow
            key={p.id}
            proposition={p}
            cabinetId={cabinetId}
            utilisateurId={utilisateurId}
            confirmer={confirmer}
            rejeter={rejeter}
            renderLabel={renderLabel}
            onChanged={() => void charger()}
          />
        ))}
      </ul>
    </section>
  );
}
