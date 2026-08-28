import { useEffect, useState } from 'react';
import { confirmerConvention, fetchConventions, rejeterConvention } from '../api';
import { formatMotifNumerotation } from './AnalyseMotifNumerotationPanel';
import { PropositionRow } from './PropositionsPanel';
import { CLE_MOTIF_NUMEROTATION, type MotifNumerotation, type Proposition } from '../types';

interface MotifNumerotationCandidatPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  // Incrémenté après une nouvelle analyse (AnalyseMotifNumerotationPanel)
  // pour forcer un rechargement — même pattern que PropositionsPanel/
  // AnomaliesPanel (cf. brief v12/v14).
  refreshKey: number;
  // Appelé après confirmation/rejet depuis CETTE carte, pour que la liste
  // générale "Conventions génériques" plus bas se resynchronise aussi.
  onChange: () => void;
}

function libelleMotif(proposition: Proposition): string {
  if (proposition.valeur && typeof proposition.valeur === 'object') {
    return `Motif de numérotation facture : ${formatMotifNumerotation(proposition.valeur as MotifNumerotation)}`;
  }
  return `Motif de numérotation facture : ${JSON.stringify(proposition.valeur)}`;
}

// Brief v18 : la carte de résultat (motif proposé + Confirmer/Rejeter)
// n'était visible que noyée dans la liste générale "Conventions
// génériques" plus bas — ici, réaffichée juste après le formulaire
// d'analyse dès qu'un motif candidate existe, en réutilisant PropositionRow
// telle quelle (mêmes routes de confirmation/rejet, même rendu, pas de
// nouveau mécanisme). Reste aussi visible dans la liste générale — pas de
// retrait demandé, seulement un ajout de visibilité.
export function MotifNumerotationCandidatPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  refreshKey,
  onChange,
}: MotifNumerotationCandidatPanelProps) {
  const [candidats, setCandidats] = useState<Proposition[]>([]);

  async function charger() {
    const toutes = await fetchConventions(cabinetId, dossierId, 'candidate');
    setCandidats(toutes.filter((p) => p.cle === CLE_MOTIF_NUMEROTATION));
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId, refreshKey]);

  if (candidats.length === 0) return null;

  return (
    <ul className="card-list">
      {candidats.map((p) => (
        <PropositionRow
          key={p.id}
          proposition={p}
          cabinetId={cabinetId}
          utilisateurId={utilisateurId}
          confirmer={confirmerConvention}
          rejeter={rejeterConvention}
          renderLabel={libelleMotif}
          onChanged={() => {
            void charger();
            onChange();
          }}
        />
      ))}
    </ul>
  );
}
