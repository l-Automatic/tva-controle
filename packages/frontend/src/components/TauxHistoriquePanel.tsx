import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  ApiError,
  confirmerTauxHistorique,
  confirmerTauxHistoriqueTiers,
  fetchTauxHistorique,
  fetchTauxHistoriqueTiers,
  rejeterTauxHistorique,
  rejeterTauxHistoriqueTiers,
} from '../api';
import { ICONE_ACTION } from '../icons';
import { useToast } from '../toast';
import type { Proposition, StatutProposition } from '../types';
import { BadgeStatut } from './BadgeStatut';

interface TauxHistoriquePanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

// Les deux tables (taux_historique / taux_historique_tiers, cf. chantier B)
// n'ont pas d'espace de numérotation qui se chevauche (445xxx vs 411xxx) —
// on les distingue simplement par la présence de compteProduitOuCharge vs
// numeroCompteTiers, déjà exposé tel quel par l'API.
type Origine = 'compte' | 'tiers';

function origineDe(p: Proposition): Origine {
  return p.numeroCompteTiers !== undefined ? 'tiers' : 'compte';
}

const LIBELLE_STATUT: Record<StatutProposition, string> = {
  candidate: 'En attente',
  confirmed: 'Confirmée',
  rejected: 'Rejetée',
};

function TauxRow({
  proposition,
  origine,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  proposition: Proposition;
  origine: Origine;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState<'confirmer' | 'rejeter' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  const confirmer = origine === 'compte' ? confirmerTauxHistorique : confirmerTauxHistoriqueTiers;
  const rejeter = origine === 'compte' ? rejeterTauxHistorique : rejeterTauxHistoriqueTiers;

  async function handleConfirmer() {
    setSubmitting('confirmer');
    setError(null);
    try {
      await confirmer(cabinetId, proposition.id, utilisateurId);
      notifier('Taux confirmé');
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
  const libelle =
    origine === 'compte'
      ? `Compte produit/charge ${proposition.compteProduitOuCharge ?? '—'} — taux habituel ${proposition.tauxHabituel ?? '—'}%`
      : `Client ${proposition.numeroCompteTiers ?? '—'} — taux habituel ${proposition.tauxHabituel ?? '—'}%`;

  return (
    <li className="card proposition">
      <div className="card-header">
        <BadgeStatut statut={proposition.statut} libelle={LIBELLE_STATUT[proposition.statut]} />
        <span className="badge badge-origine">{origine === 'compte' ? 'Compte produit/charge' : 'Compte client'}</span>
        <span className="source">{proposition.source}</span>
      </div>
      <p className="label">{libelle}</p>
      {proposition.confidenceNote && <p className="reference">{proposition.confidenceNote}</p>}

      {estCandidate && (
        <div className="actions">
          <button onClick={() => void handleConfirmer()} disabled={submitting !== null}>
            <ICONE_ACTION.confirmer size={14} aria-hidden="true" />
            {submitting === 'confirmer' ? '…' : 'Confirmer'}
          </button>
          <button onClick={() => void handleRejeter()} disabled={submitting !== null} className="secondary">
            <ICONE_ACTION.rejeter size={14} aria-hidden="true" />
            {submitting === 'rejeter' ? '…' : 'Rejeter'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

export function TauxHistoriquePanel({ cabinetId, dossierId, utilisateurId }: TauxHistoriquePanelProps) {
  const [comptes, setComptes] = useState<Proposition[]>([]);
  const [tiers, setTiers] = useState<Proposition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [afficherTraitees, setAfficherTraitees] = useState(false);
  const [filtreOrigine, setFiltreOrigine] = useState<'tous' | Origine>('tous');

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const [dataComptes, dataTiers] = await Promise.all([
        fetchTauxHistorique(cabinetId, dossierId),
        fetchTauxHistoriqueTiers(cabinetId, dossierId),
      ]);
      setComptes(dataComptes);
      setTiers(dataTiers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger le taux historique');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  const toutes = [
    ...comptes.map((p) => ({ p, origine: 'compte' as const })),
    ...tiers.map((p) => ({ p, origine: 'tiers' as const })),
  ];
  const visibles = toutes
    .filter(({ p }) => afficherTraitees || p.statut === 'candidate')
    .filter(({ origine }) => filtreOrigine === 'tous' || origine === filtreOrigine);
  const nbEnAttente = toutes.filter(({ p }) => p.statut === 'candidate').length;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Taux historique ({nbEnAttente} en attente)</h2>
        <select value={filtreOrigine} onChange={(e) => setFiltreOrigine(e.target.value as 'tous' | Origine)}>
          <option value="tous">Comptes et clients</option>
          <option value="compte">Comptes produit/charge</option>
          <option value="tiers">Comptes clients</option>
        </select>
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
      {!loading && visibles.length === 0 && <p className="empty">Aucune proposition à afficher.</p>}
      <ul className="card-list">
        {visibles.map(({ p, origine }) => (
          <TauxRow
            key={`${origine}-${p.id}`}
            proposition={p}
            origine={origine}
            cabinetId={cabinetId}
            utilisateurId={utilisateurId}
            onChanged={() => void charger()}
          />
        ))}
      </ul>
    </section>
  );
}
