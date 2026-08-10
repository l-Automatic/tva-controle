import { useEffect, useState } from 'react';
import { fetchCalculs } from '../../api';
import { toDateOnly } from '../../dateUtils';
import { AnomaliesPanel } from '../AnomaliesPanel';
import { CalculRow } from '../CalculsPanel';
import { CycleForm } from '../CycleForm';
import type { Calcul } from '../../types';

interface CycleZoneProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periode: { debut: string; fin: string } | null;
  onPeriodeChange: (periode: { debut: string; fin: string } | null) => void;
}

function CalculsDuCycle({
  cabinetId,
  dossierId,
  utilisateurId,
  periode,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periode: { debut: string; fin: string };
}) {
  const [calculs, setCalculs] = useState<Calcul[]>([]);
  const [loading, setLoading] = useState(false);

  async function charger() {
    setLoading(true);
    try {
      const data = await fetchCalculs(cabinetId, dossierId);
      setCalculs(
        data.filter(
          (c) => toDateOnly(c.periodeDebut) === toDateOnly(periode.debut) && toDateOnly(c.periodeFin) === toDateOnly(periode.fin)
        )
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId, periode.debut, periode.fin]);

  return (
    <div className="panel-section">
      <div className="panel-header">
        <h2>Calcul de la période</h2>
      </div>
      {!loading && calculs.length === 0 && <p className="empty">Aucun calcul pour cette période.</p>}
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
    </div>
  );
}

// Vue par défaut une fois un dossier sélectionné : lancement de cycle,
// résultat, anomalies de la période et validation/rejet du calcul dans un
// seul flux, plutôt que trois panneaux séparés à faire défiler (cf. brief
// refonte, section 3).
export function CycleZone({ cabinetId, dossierId, utilisateurId, periode, onPeriodeChange }: CycleZoneProps) {
  useEffect(() => {
    if (periode) return;
    let annule = false;
    async function chargerDernierePeriode() {
      const calculs = await fetchCalculs(cabinetId, dossierId);
      if (annule || calculs.length === 0) return;
      const dernier = calculs[0]!;
      onPeriodeChange({ debut: toDateOnly(dernier.periodeDebut), fin: toDateOnly(dernier.periodeFin) });
    }
    void chargerDernierePeriode();
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  return (
    <section className="panel panel-full">
      <CycleForm
        cabinetId={cabinetId}
        dossierId={dossierId}
        onCycleLance={(debut, fin) => onPeriodeChange({ debut, fin })}
      />
      {periode && (
        <>
          <div className="panel-separateur" />
          <AnomaliesPanel
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            variant="cycle"
            periode={periode.debut}
          />
          <div className="panel-separateur" />
          <CalculsDuCycle cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} periode={periode} />
        </>
      )}
    </section>
  );
}
