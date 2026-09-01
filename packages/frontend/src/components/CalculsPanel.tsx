import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError, fetchAjustementsCalcul, fetchCalculs, rejeterCalcul, validerCalcul } from '../api';
import { formatDate } from '../dateUtils';
import { ICONE_ACTION } from '../icons';
import { useToast } from '../toast';
import type { AjustementCalcul, Calcul, StatutCalcul } from '../types';
import { BadgeStatut } from './BadgeStatut';

interface CalculsPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

export const LIBELLE_STATUT_CALCUL: Record<StatutCalcul, string> = {
  brouillon: 'Brouillon',
  valide: 'Validé',
  declare: 'Déclaré',
  rejete: 'Rejeté',
};

export function formatMontant(montant: number): string {
  return `${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;
}

// Le calcul se produit toujours, même incomplet (brief v31) — ce message
// remplace l'ancien écran plein "Cycle bloqué" : visible à côté du montant,
// pas alarmiste au point de le cacher, mais clair sur le fait que la
// validation reste impossible tant que ces anomalies sont ouvertes.
export function MessageCalculIncomplet({ nombre }: { nombre: number }) {
  return (
    <p className="avertissement">
      Ce calcul n'est pas définitif — {nombre} anomalie{nombre > 1 ? 's' : ''} critique{nombre > 1 ? 's' : ''} à
      résoudre avant validation.
    </p>
  );
}

export function CalculRow({
  calcul,
  cabinetId,
  utilisateurId,
  onChanged,
  refreshKey,
  montantEnGrand = false,
}: {
  calcul: Calcul;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
  // Optionnel : incrémenté par un parent pour forcer un rechargement des
  // ajustements après une action ailleurs (ex : CycleForm.tsx, sibling —
  // brief v23), même pattern que AnomaliesPanel/PropositionsPanel.
  refreshKey?: number;
  // Panneau de calcul de la période (Cycle zone, brief v31) : LE montant à
  // voir en premier — plus grand, en gras. Pas appliqué dans la liste
  // Historique, où plusieurs calculs s'empilent (surdimensionner chaque
  // ligne y nuirait à la lisibilité plutôt que d'aider).
  montantEnGrand?: boolean;
}) {
  const [motif, setMotif] = useState('');
  const [submitting, setSubmitting] = useState<'valider' | 'rejeter' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflit, setConflit] = useState(false);
  const [ajustements, setAjustements] = useState<AjustementCalcul[]>([]);
  const notifier = useToast();

  // Recalcul pur affichage (brief v23) : le formulaire d'ajustement lui-même
  // vit dans CycleForm.tsx (seul endroit où les totaux collectée/déductible
  // d'origine sont connus, dérivés des lignes du calcul fraîchement reçu) —
  // ici, sans ces lignes, seul le delta (ajusté - original) de chaque
  // ajustement actif est nécessaire pour corriger la TVA nette affichée,
  // évitant que ce panneau affiche une valeur périmée face à celle,
  // recalculée, du résultat de cycle juste au-dessus.
  useEffect(() => {
    if (cabinetId && calcul.id) {
      fetchAjustementsCalcul(cabinetId, calcul.id)
        .then(setAjustements)
        .catch(() => setAjustements([]));
    }
  }, [cabinetId, calcul.id, refreshKey]);

  async function handleValider() {
    if (
      !window.confirm(
        'Valider ce calcul ? Cette action est définitive : plus aucune modification ne sera possible ensuite (immuabilité).'
      )
    ) {
      return;
    }
    setSubmitting('valider');
    setError(null);
    setConflit(false);
    try {
      await validerCalcul(cabinetId, calcul.id, utilisateurId);
      notifier('Calcul validé');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflit(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec de la validation');
      }
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRejeter() {
    if (!motif.trim()) {
      setError('Un motif est requis pour rejeter un calcul');
      return;
    }
    if (!window.confirm('Rejeter ce calcul ? Il redeviendra un brouillon éditable si un cycle est relancé sur la même période.')) {
      return;
    }
    setSubmitting('rejeter');
    setError(null);
    setConflit(false);
    try {
      await rejeterCalcul(cabinetId, calcul.id, utilisateurId, motif.trim());
      notifier('Calcul rejeté');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflit(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec du rejet');
      }
    } finally {
      setSubmitting(null);
    }
  }

  const estBrouillon = calcul.statut === 'brouillon';
  const estIncomplet = calcul.anomaliesBloquantesOuvertes > 0;

  const ajustementCollectee = ajustements.find((a) => a.typeMontant === 'collectee_totale');
  const ajustementDeductible = ajustements.find((a) => a.typeMontant === 'deductible_totale');
  const signeOrigine = calcul.sens === 'a_decaisser' ? 1 : -1;
  const deltaCollectee = ajustementCollectee ? ajustementCollectee.montantAjuste - ajustementCollectee.montantOriginal : 0;
  const deltaDeductible = ajustementDeductible ? ajustementDeductible.montantAjuste - ajustementDeductible.montantOriginal : 0;
  const netSigneAjuste = signeOrigine * calcul.tvaNette + deltaCollectee - deltaDeductible;
  const tvaNetteAffichee = Math.abs(netSigneAjuste);
  const sensAffiche: 'a_decaisser' | 'credit' = netSigneAjuste >= 0 ? 'a_decaisser' : 'credit';
  const aUnAjustementActif = Boolean(ajustementCollectee || ajustementDeductible);

  return (
    <li className={`card calcul statut-carte-${calcul.statut}`}>
      <div className="card-header">
        <BadgeStatut statut={calcul.statut} libelle={LIBELLE_STATUT_CALCUL[calcul.statut]} />
        <span className="periode">
          {formatDate(calcul.periodeDebut)} — {formatDate(calcul.periodeFin)}
        </span>
      </div>
      <p className={montantEnGrand ? 'label montant-principal' : 'label'}>
        {sensAffiche === 'a_decaisser' ? 'TVA à décaisser' : 'Crédit de TVA'} :{' '}
        <strong>{formatMontant(tvaNetteAffichee)}</strong>
        {aUnAjustementActif && <span className="reference"> (montants ajustés manuellement)</span>}
      </p>
      {estBrouillon && estIncomplet && <MessageCalculIncomplet nombre={calcul.anomaliesBloquantesOuvertes} />}

      {estBrouillon ? (
        <div className="actions">
          <input
            type="text"
            placeholder="Motif (requis pour rejeter)"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            disabled={submitting !== null}
          />
          <button
            onClick={() => void handleValider()}
            disabled={submitting !== null || estIncomplet}
            title={estIncomplet ? 'Anomalies bloquantes encore ouvertes — résolvez-les avant de valider' : undefined}
          >
            <ICONE_ACTION.valider size={14} aria-hidden="true" />
            {submitting === 'valider' ? '…' : 'Valider'}
          </button>
          <button onClick={() => void handleRejeter()} disabled={submitting !== null} className="secondary">
            <ICONE_ACTION.rejeter size={14} aria-hidden="true" />
            {submitting === 'rejeter' ? '…' : 'Rejeter'}
          </button>
        </div>
      ) : calcul.statut === 'rejete' ? (
        <p className="reference">Rejeté — redeviendra brouillon si un cycle est relancé sur cette période.</p>
      ) : (
        <p className="reference">Immuable — plus aucune modification possible après validation.</p>
      )}
      {error && <p className={conflit ? 'error error-409' : 'error'}>{error}</p>}
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
          <RefreshCw size={14} aria-hidden="true" />
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
