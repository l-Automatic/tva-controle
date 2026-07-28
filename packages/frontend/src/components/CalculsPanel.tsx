import { useEffect, useState } from 'react';
import { ApiError, fetchCalculs, validerCalcul } from '../api';
import type { Calcul, StatutCalcul } from '../types';

interface CalculsPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

const LIBELLE_STATUT: Record<StatutCalcul, string> = {
  brouillon: 'Brouillon',
  valide: 'Validé',
  declare: 'Déclaré',
};

function formatMontant(montant: number): string {
  return `${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;
}

// L'API renvoie des colonnes DATE Postgres sérialisées en ISO complet
// (2025-04-01T00:00:00.000Z) — on ne garde que la partie date pour l'affichage.
function formatDate(iso: string): string {
  return iso.split('T')[0] ?? iso;
}

function CalculRow({
  calcul,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  calcul: Calcul;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleValider() {
    setSubmitting(true);
    setError(null);
    try {
      await validerCalcul(cabinetId, calcul.id, utilisateurId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la validation');
    } finally {
      setSubmitting(false);
    }
  }

  const estBrouillon = calcul.statut === 'brouillon';

  return (
    <li className={`card calcul statut-carte-${calcul.statut}`}>
      <div className="card-header">
        <span className={`badge statut-${calcul.statut}`}>{LIBELLE_STATUT[calcul.statut]}</span>
        <span className="periode">
          {formatDate(calcul.periodeDebut)} — {formatDate(calcul.periodeFin)}
        </span>
      </div>
      <p className="label">
        {calcul.sens === 'a_decaisser' ? 'TVA à décaisser' : 'Crédit de TVA'} :{' '}
        <strong>{formatMontant(calcul.tvaNette)}</strong>
      </p>

      {estBrouillon ? (
        <div className="actions">
          <button onClick={() => void handleValider()} disabled={submitting}>
            {submitting ? '…' : 'Valider'}
          </button>
        </div>
      ) : (
        <p className="reference">Immuable — plus aucune modification possible après validation.</p>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

export function CalculsPanel({ cabinetId, dossierId, utilisateurId }: CalculsPanelProps) {
  const [calculs, setCalculs] = useState<Calcul[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCalculs(cabinetId, dossierId);
      setCalculs(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les calculs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  const nbBrouillons = calculs.filter((c) => c.statut === 'brouillon').length;

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>
          Calculs ({nbBrouillons} brouillon{nbBrouillons === 1 ? '' : 's'} à valider)
        </h2>
        <button onClick={() => void charger()} disabled={loading}>
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && calculs.length === 0 && <p className="empty">Aucun calcul pour ce dossier.</p>}
      <ul className="card-list">
        {calculs.map((c) => (
          <CalculRow
            key={c.id}
            calcul={c}
            cabinetId={cabinetId}
            utilisateurId={utilisateurId}
            onChanged={() => void charger()}
          />
        ))}
      </ul>
    </section>
  );
}
