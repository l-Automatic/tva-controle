import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { ApiError } from '../api';
import { ICONE_ACTION } from '../icons';
import { useToast } from '../toast';
import type { Proposition, StatutProposition } from '../types';
import { BadgeStatut } from './BadgeStatut';

interface PropositionsPanelProps {
  title: string;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  fetchPropositions: (cabinetId: string, dossierId: string, statut?: string) => Promise<Proposition[]>;
  confirmer: (cabinetId: string, id: string, utilisateurId: string) => Promise<void>;
  rejeter: (cabinetId: string, id: string, utilisateurId: string) => Promise<void>;
  renderLabel: (proposition: Proposition) => string;
  // Optionnel : si fourni, affiche un formulaire d'ajout clé/valeur libre
  // au-dessus de la liste — même mécanique que Conventions de comptes, sans
  // laquelle il n'existait aucun moyen de re-créer une convention perdue
  // (cf. brief v4, section 3).
  ajouter?: (cabinetId: string, dossierId: string, utilisateurId: string, cle: string, valeur: string) => Promise<{ id: string }>;
  // Optionnel : incrémenté par un parent pour forcer un rechargement externe
  // (ex : après qu'une action hors de ce panneau — analyse du motif de
  // numérotation, brief v12 — a créé une nouvelle convention candidate),
  // même pattern que ATraiterPanel/ProgressionPanel.
  refreshKey?: number;
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
  const notifier = useToast();

  async function handleConfirmer() {
    setSubmitting('confirmer');
    setError(null);
    try {
      await confirmer(cabinetId, proposition.id, utilisateurId);
      notifier('Proposition confirmée');
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
      await rejeter(cabinetId, proposition.id, utilisateurId);
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
        <BadgeStatut statut={proposition.statut} libelle={LIBELLE_STATUT[proposition.statut]} />
        <span className="source">{proposition.source}</span>
      </div>
      <p className="label">{renderLabel(proposition)}</p>
      {proposition.confidenceNote && <p className="reference">{proposition.confidenceNote}</p>}

      {estCandidate && (
        <div className="actions">
          <button onClick={handleConfirmer} disabled={submitting !== null}>
            <ICONE_ACTION.confirmer size={14} aria-hidden="true" />
            {submitting === 'confirmer' ? '…' : 'Confirmer'}
          </button>
          <button onClick={handleRejeter} disabled={submitting !== null} className="secondary">
            <ICONE_ACTION.rejeter size={14} aria-hidden="true" />
            {submitting === 'rejeter' ? '…' : 'Rejeter'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

function AjoutForm({
  cabinetId,
  dossierId,
  utilisateurId,
  ajouter,
  onAjoute,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  ajouter: NonNullable<PropositionsPanelProps['ajouter']>;
  onAjoute: () => void;
}) {
  const [cle, setCle] = useState('');
  const [valeur, setValeur] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAjouter() {
    if (!cle.trim() || !valeur.trim()) {
      setError('Clé et valeur sont requises');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await ajouter(cabinetId, dossierId, utilisateurId, cle.trim(), valeur.trim());
      setCle('');
      setValeur('');
      onAjoute();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’ajout');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ajout-convention">
      <input
        type="text"
        placeholder="Clé (ex : compte_tva_due_autoliquidee)"
        value={cle}
        onChange={(e) => setCle(e.target.value)}
        disabled={submitting}
      />
      <input
        type="text"
        placeholder="Valeur"
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        disabled={submitting}
      />
      <button onClick={() => void handleAjouter()} disabled={submitting}>
        <Plus size={14} aria-hidden="true" />
        {submitting ? '…' : 'Ajouter'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
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
  ajouter,
  refreshKey,
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
  }, [cabinetId, dossierId, refreshKey]);

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
          <RefreshCw size={14} aria-hidden="true" />
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {ajouter && (
        <AjoutForm
          cabinetId={cabinetId}
          dossierId={dossierId}
          utilisateurId={utilisateurId}
          ajouter={ajouter}
          onAjoute={() => void charger()}
        />
      )}

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
