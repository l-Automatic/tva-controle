import { useState } from 'react';
import { ApiError, lancerCycle } from '../api';
import { useToast } from '../toast';
import type { CompteACategoriser, ResultatCycle } from '../types';

interface CycleFormProps {
  cabinetId: string;
  dossierId: string;
  onCycleLance?: (periodeDebut: string, periodeFin: string, comptesACategoriser: CompteACategoriser[]) => void;
}

const LIBELLE_CATEGORIE: Record<string, string> = {
  collectee_20: 'Collectée 20 %',
  collectee_10: 'Collectée 10 %',
  collectee_5_5: 'Collectée 5,5 %',
  collectee_2_1: 'Collectée 2,1 %',
  deductible_abs: 'Déductible (biens/services)',
  deductible_immo: 'Déductible (immobilisations)',
  autoliquidation_due: 'Autoliquidation due',
  autoliquidation_deductible: 'Autoliquidation déductible',
};

function ResultatCycleView({ resultat }: { resultat: ResultatCycle }) {
  if (resultat.statut === 'bloque') {
    return (
      <div className="resultat-cycle resultat-bloque">
        <p className="resultat-titre">
          Cycle bloqué — {resultat.anomalies.filter((a) => a.gravite === 'bloquant').length} anomalie(s) bloquante(s)
        </p>
        <p className="reference">
          Traitez ces anomalies dans le panneau « Anomalies » ci-dessous, puis relancez le cycle.
        </p>
        <ul className="card-list">
          {resultat.anomalies.map((a, i) => (
            <li key={i} className={`card anomalie gravite-${a.gravite}`}>
              <div className="card-header">
                <span className={`badge gravite-badge-${a.gravite}`}>{a.gravite}</span>
                <span className="type-anomalie">{a.type}</span>
              </div>
              <p className="description">{a.description}</p>
              <p className="reference">Compte : {a.compte}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { resultat: calcul, calculId, anomalies } = resultat;

  return (
    <div className="resultat-cycle resultat-calcule">
      <p className="resultat-titre">
        {calcul.sens === 'a_decaisser' ? 'TVA à décaisser' : 'Crédit de TVA'} :{' '}
        <strong>{calcul.tvaNette.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</strong>
      </p>
      <p className="reference">Calcul {calculId} (brouillon — à valider dans le panneau « Calculs »)</p>

      {calcul.lignes.length > 0 && (
        <table className="table-lignes-calcul">
          <thead>
            <tr>
              <th>Catégorie</th>
              <th>Montant</th>
              <th>Pièces</th>
            </tr>
          </thead>
          <tbody>
            {calcul.lignes.map((l, i) => (
              <tr key={i}>
                <td>{LIBELLE_CATEGORIE[l.categorie] ?? l.categorie}</td>
                <td>{l.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</td>
                <td>{l.referencesPieces.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {calcul.ecrituresExclues.length > 0 && (
        <>
          <p className="reference">Écritures exclues du calcul ({calcul.ecrituresExclues.length}) :</p>
          <ul className="card-list">
            {calcul.ecrituresExclues.map((e, i) => (
              <li key={i} className="card">
                <p className="label">
                  Compte {e.compte} — pièce {e.ledgerEntryId}
                </p>
                <p className="reference">{e.motif}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {anomalies.length > 0 && (
        <>
          <p className="reference">{anomalies.length} anomalie(s) non bloquante(s) — voir le panneau « Anomalies ».</p>
        </>
      )}
    </div>
  );
}

export function CycleForm({ cabinetId, dossierId, onCycleLance }: CycleFormProps) {
  const [periodeDebut, setPeriodeDebut] = useState('');
  const [periodeFin, setPeriodeFin] = useState('');
  const [pennylaneToken, setPennylaneToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dejaValide, setDejaValide] = useState(false);
  const [resultat, setResultat] = useState<ResultatCycle | null>(null);
  const notifier = useToast();

  async function handleLancer() {
    if (!periodeDebut || !periodeFin || !pennylaneToken) {
      setError('Période de début, période de fin et token Pennylane sont requis');
      return;
    }
    setSubmitting(true);
    setError(null);
    setDejaValide(false);
    setResultat(null);
    try {
      const res = await lancerCycle(cabinetId, dossierId, { periodeDebut, periodeFin, pennylaneToken });
      setResultat(res);
      setPennylaneToken('');
      notifier(res.statut === 'bloque' ? 'Cycle bloqué — anomalies à traiter' : 'Cycle calculé');
      onCycleLance?.(periodeDebut, periodeFin, res.comptesACategoriser);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDejaValide(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec du lancement du cycle');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel-section">
      <div className="panel-header">
        <h2>Lancer un cycle TVA</h2>
      </div>

      <div className="cycle-form">
        <label>
          Période — début
          <input type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
        </label>
        <label>
          Période — fin
          <input type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
        </label>
        <label className="cycle-form-token">
          Token Pennylane
          <input
            type="password"
            placeholder="Token à usage unique — régénérez-le après ce test"
            value={pennylaneToken}
            onChange={(e) => setPennylaneToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button onClick={() => void handleLancer()} disabled={submitting}>
          {submitting ? 'Cycle en cours…' : 'Lancer le cycle'}
        </button>
      </div>
      <p className="reference cycle-form-warning">
        Le token est transmis en clair au serveur (pas de gestion de secrets à ce stade) — ne réutilisez jamais un
        token déjà collé ailleurs, régénérez-le avant chaque test.
      </p>

      {error && <p className={dejaValide ? 'error error-409' : 'error'}>{error}</p>}
      {resultat && <ResultatCycleView resultat={resultat} />}
    </div>
  );
}
