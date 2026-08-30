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

// Affichée une seule fois, entre la fin de ce bloc (bouton + carte de
// résultat quand elle existe) et le panneau "Conventions génériques" —
// cf. ConfigurationZone.tsx (brief v17, corrige la double occurrence
// encadrant les champs introduite par erreur en v15).
export const RECOMMANDATION_PERIODE = (
  <>
    Pour une première analyse, choisissez une période large (plusieurs mois) pour que le motif dominant se
    dégage clairement. Si le format a changé en cours d'exercice, limitez la période à la partie où le nouveau
    format s'applique uniquement — mélanger l'ancien et le nouveau format dans la même analyse produira un
    résultat confus.
  </>
);

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motifPropose, setMotifPropose] = useState<MotifNumerotation | null | undefined>(undefined);
  const notifier = useToast();

  async function handleAnalyser() {
    if (!periodeDebut || !periodeFin) {
      setError('Période de début et période de fin sont requises');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // pennylaneToken retiré (brief v27) — le backend résout maintenant
      // lui-même le client Pennylane depuis le jeton cabinet configuré.
      const { motifPropose: resultat } = await analyserMotifNumerotation(cabinetId, dossierId, {
        periodeDebut,
        periodeFin,
        utilisateurId,
      });
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
        <button onClick={() => void handleAnalyser()} disabled={submitting}>
          {submitting ? 'Analyse en cours…' : 'Analyser le motif de numérotation'}
        </button>
      </div>
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
