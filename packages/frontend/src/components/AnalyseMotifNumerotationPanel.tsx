import { useState } from 'react';
import { ApiError, analyserMotifNumerotation } from '../api';
import { useToast } from '../toast';
import type { MotifNumerotation } from '../types';

interface AnalyseMotifNumerotationPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onAnalyseTerminee: () => void;
}

function premierJourExerciceEnCours(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function dernierJourExerciceEnCours(): string {
  return `${new Date().getFullYear()}-12-31`;
}

export function formatMotifNumerotation(motif: MotifNumerotation): string {
  const parties = [`Préfixe ${motif.prefixe || '(aucun)'}`];
  parties.push(typeof motif.nombreChiffres === 'number' ? `${motif.nombreChiffres} chiffres` : 'nombre de chiffres variable');
  parties.push(motif.suffixe ? `suffixe ${motif.suffixe}` : 'aucun suffixe');
  return parties.join(', ');
}

// Déclenchement MANUEL uniquement (bouton dédié) — jamais à chaque cycle,
// décision explicite de Rami : un changement de format de numérotation est
// trop rare pour justifier plus qu'un déclenchement à la demande, quand le
// collaborateur sait que ça a changé (cf. analyserMotifNumerotation.ts
// côté backend). Peut être relancée à tout moment, pas seulement en
// l'absence de motif existant — l'exercice change, le format peut changer
// avec lui.
export function AnalyseMotifNumerotationPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  onAnalyseTerminee,
}: AnalyseMotifNumerotationPanelProps) {
  const [periodeDebut, setPeriodeDebut] = useState(premierJourExerciceEnCours);
  const [periodeFin, setPeriodeFin] = useState(dernierJourExerciceEnCours);
  const [pennylaneToken, setPennylaneToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motifPropose, setMotifPropose] = useState<MotifNumerotation | null | undefined>(undefined);
  const notifier = useToast();

  async function handleAnalyser() {
    if (!periodeDebut || !periodeFin || !pennylaneToken) {
      setError('Période de début, période de fin et token Pennylane sont requis');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { motifPropose: resultat } = await analyserMotifNumerotation(cabinetId, dossierId, {
        pennylaneToken,
        periodeDebut,
        periodeFin,
        utilisateurId,
      });
      setPennylaneToken('');
      setMotifPropose(resultat);
      if (resultat) {
        notifier('Motif de numérotation proposé — à confirmer dans Conventions génériques');
        onAnalyseTerminee();
      } else {
        notifier('Aucun motif cohérent détecté');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'analyse du motif de numérotation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel-section">
      <div className="panel-header">
        <h2>Analyser le motif de numérotation des factures</h2>
      </div>
      <p className="reference">
        Borné à l'exercice en cours par défaut (modifiable) — propose un motif candidate à confirmer ci-dessous,
        jamais appliqué automatiquement. Peut être relancée à tout moment si le format change.
      </p>
      <div className="cycle-form">
        <label>
          Période — début
          <input type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} disabled={submitting} />
        </label>
        <label>
          Période — fin
          <input type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} disabled={submitting} />
        </label>
        <label className="cycle-form-token">
          Token Pennylane
          <input
            type="password"
            placeholder="Token à usage unique — régénérez-le après ce test"
            value={pennylaneToken}
            onChange={(e) => setPennylaneToken(e.target.value)}
            disabled={submitting}
            autoComplete="off"
          />
        </label>
        <button onClick={() => void handleAnalyser()} disabled={submitting}>
          {submitting ? 'Analyse en cours…' : 'Analyser le motif de numérotation'}
        </button>
      </div>
      <p className="reference cycle-form-warning">
        Pour une première analyse, choisissez une période large (plusieurs mois) pour que le motif dominant se
        dégage clairement. Si le format a changé en cours d'exercice, limitez la période à la partie où le nouveau
        format s'applique uniquement — mélanger l'ancien et le nouveau format dans la même analyse produira un
        résultat confus.
      </p>
      {error && <p className="error">{error}</p>}
      {motifPropose !== undefined &&
        (motifPropose ? (
          <p className="reference">Motif proposé : {formatMotifNumerotation(motifPropose)}</p>
        ) : (
          <p className="empty">Aucun motif cohérent détecté.</p>
        ))}
    </section>
  );
}
