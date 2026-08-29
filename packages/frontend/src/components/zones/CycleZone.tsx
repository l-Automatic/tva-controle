import { useEffect, useState } from 'react';
import { fetchCalculs } from '../../api';
import { toDateOnly } from '../../dateUtils';
import { AnomaliesPanel } from '../AnomaliesPanel';
import { CalculRow } from '../CalculsPanel';
import { CategorisationPopup } from '../CategorisationPopup';
import { CycleForm } from '../CycleForm';
import type { Calcul, CompteACategoriser, CompteClientSansTauxAssigne, CompteSansTauxAssigne } from '../../types';

interface CycleZoneProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periode: { debut: string; fin: string } | null;
  onPeriodeChange: (periode: { debut: string; fin: string } | null) => void;
  onSuggestionsTaux: (comptes: CompteSansTauxAssigne[], clients: CompteClientSansTauxAssigne[]) => void;
  onSuggestionsAutoliquidation: (comptes: CompteACategoriser[]) => void;
}

function CalculsDuCycle({
  cabinetId,
  dossierId,
  utilisateurId,
  periode,
  refreshKey,
}: {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periode: { debut: string; fin: string };
  // cf. brief v14 : relancer un cycle sur la même période met à jour le
  // calcul EN PLACE côté backend (même id, cf. enregistrerCalcul) — sans ce
  // compteur, periode.debut/fin restent identiques et cet effet ne se
  // redéclenche pas, laissant le montant affiché périmé.
  refreshKey: number;
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
  }, [cabinetId, dossierId, periode.debut, periode.fin, refreshKey]);

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
            refreshKey={refreshKey}
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
export function CycleZone({
  cabinetId,
  dossierId,
  utilisateurId,
  periode,
  onPeriodeChange,
  onSuggestionsTaux,
  onSuggestionsAutoliquidation,
}: CycleZoneProps) {
  const [comptesACategoriser, setComptesACategoriser] = useState<CompteACategoriser[]>([]);
  // Bug réel (brief v14) : relancer un cycle sur EXACTEMENT la même période
  // ne change pas la valeur de `periode.debut` passée à AnomaliesPanel — son
  // effet ne se redéclenchait donc pas, laissant les nouvelles anomalies
  // (ex: trou/doublon de numérotation détectés après confirmation d'un
  // motif entre deux cycles) invisibles jusqu'à un clic manuel sur
  // "Rafraîchir". Incrémenté à chaque cycle, indépendamment de la période.
  const [cycleRefreshKey, setCycleRefreshKey] = useState(0);

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
        utilisateurId={utilisateurId}
        onCycleLance={(debut, fin, resultat) => {
          onPeriodeChange({ debut, fin });
          setCycleRefreshKey((k) => k + 1);
          if (resultat.comptesACategoriser.length > 0) setComptesACategoriser(resultat.comptesACategoriser);
          onSuggestionsTaux(resultat.comptesSansTauxAssigne, resultat.comptesClientSansTaux);
          onSuggestionsAutoliquidation(resultat.comptesAutoliquidationSuggeres);
        }}
        onAjustementChange={() => setCycleRefreshKey((k) => k + 1)}
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
            refreshKey={cycleRefreshKey}
          />
          <div className="panel-separateur" />
          <CalculsDuCycle
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            periode={periode}
            refreshKey={cycleRefreshKey}
          />
        </>
      )}
      {comptesACategoriser.length > 0 && (
        <CategorisationPopup
          cabinetId={cabinetId}
          dossierId={dossierId}
          utilisateurId={utilisateurId}
          comptes={comptesACategoriser}
          onClose={() => setComptesACategoriser([])}
        />
      )}
    </section>
  );
}
