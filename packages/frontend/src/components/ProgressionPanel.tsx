import { useEffect, useState } from 'react';
import { fetchAnomalies, fetchCalculs, fetchConventions, fetchTiersReference } from '../api';
import { toDateOnly } from '../dateUtils';
import type { Anomalie, Calcul, TiersReference } from '../types';

interface ProgressionPanelProps {
  cabinetId: string;
  dossierId: string;
  refreshKey: number;
}

// Jauges sobres appuyées sur des données réellement en base (pas de score
// inventé) — cf. brief refonte : terminologie "progression"/"jalon", pas
// "XP"/"achievement", pas de leaderboard.

function JaugeConfianceTiers({ tiers }: { tiers: TiersReference[] }) {
  if (tiers.length === 0) {
    return (
      <div className="jauge">
        <p className="jauge-titre">Confiance des tiers</p>
        <p className="empty">Aucun tiers suivi pour l’instant.</p>
      </div>
    );
  }
  const nouveaux = tiers.filter((t) => t.niveauConfiance === 'nouveau').length;
  const aSurveiller = tiers.filter((t) => t.niveauConfiance === 'a_surveiller').length;
  const confiance = tiers.filter((t) => t.niveauConfiance === 'confiance').length;
  const total = tiers.length;

  return (
    <div className="jauge">
      <p className="jauge-titre">Confiance des tiers ({total})</p>
      <div className="jauge-barre" role="img" aria-label={`${confiance} en confiance, ${aSurveiller} à surveiller, ${nouveaux} nouveaux`}>
        <div className="jauge-segment jauge-segment-confiance" style={{ width: `${(confiance / total) * 100}%` }} />
        <div className="jauge-segment jauge-segment-surveiller" style={{ width: `${(aSurveiller / total) * 100}%` }} />
        <div className="jauge-segment jauge-segment-nouveau" style={{ width: `${(nouveaux / total) * 100}%` }} />
      </div>
      <p className="jauge-legende">
        <span className="jauge-puce jauge-puce-confiance" /> Confiance ({confiance}) · <span className="jauge-puce jauge-puce-surveiller" /> À
        surveiller ({aSurveiller}) · <span className="jauge-puce jauge-puce-nouveau" /> Nouveaux ({nouveaux})
      </p>
    </div>
  );
}

function JaugeCompletude({ tauxCompletude, nbCandidates }: { tauxCompletude: number | null; nbCandidates: number }) {
  return (
    <div className="jauge">
      <p className="jauge-titre">Configuration du dossier</p>
      {tauxCompletude === null ? (
        <p className="empty">Aucune convention à configurer pour l’instant.</p>
      ) : (
        <>
          <div className="jauge-barre jauge-barre-simple">
            <div className="jauge-segment jauge-segment-confiance" style={{ width: `${tauxCompletude}%` }} />
          </div>
          <p className="jauge-legende">
            Dossier configuré à {Math.round(tauxCompletude)} %
            {nbCandidates > 0 && ` — ${nbCandidates} en attente`}
          </p>
        </>
      )}
    </div>
  );
}

function IndicateurSuiteCycles({ calculs, anomalies }: { calculs: Calcul[]; anomalies: Anomalie[] }) {
  if (calculs.length === 0) {
    return (
      <div className="jauge">
        <p className="jauge-titre">Suite de cycles</p>
        <p className="empty">Aucun cycle lancé pour l’instant.</p>
      </div>
    );
  }

  const bloquePourPeriode = new Set(
    anomalies.filter((a) => a.gravite === 'bloquant').map((a) => toDateOnly(a.periode))
  );

  let streak = 0;
  for (const c of calculs) {
    if (bloquePourPeriode.has(toDateOnly(c.periodeDebut))) break;
    streak += 1;
  }

  return (
    <div className="jauge">
      <p className="jauge-titre">Suite de cycles</p>
      {streak > 0 ? (
        <p className="jauge-legende jauge-ok">
          <span aria-hidden="true">✓</span> {streak} cycle{streak === 1 ? '' : 's'} consécutif{streak === 1 ? '' : 's'}{' '}
          sans anomalie bloquante
        </p>
      ) : (
        <p className="jauge-legende">Dernier cycle avec anomalie(s) bloquante(s)</p>
      )}
    </div>
  );
}

export function ProgressionPanel({ cabinetId, dossierId, refreshKey }: ProgressionPanelProps) {
  const [tiers, setTiers] = useState<TiersReference[]>([]);
  const [tauxCompletude, setTauxCompletude] = useState<number | null>(null);
  const [nbCandidates, setNbCandidates] = useState(0);
  const [calculs, setCalculs] = useState<Calcul[]>([]);
  const [anomalies, setAnomalies] = useState<Anomalie[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!cabinetId || !dossierId) return;
    let annule = false;
    async function charger() {
      const [dataTiers, dataConventions, dataCalculs, dataAnomalies] = await Promise.all([
        fetchTiersReference(cabinetId, dossierId),
        fetchConventions(cabinetId, dossierId),
        fetchCalculs(cabinetId, dossierId),
        fetchAnomalies(cabinetId, dossierId),
      ]);
      if (annule) return;
      setTiers(dataTiers);
      const confirmed = dataConventions.filter((c) => c.statut === 'confirmed').length;
      const candidate = dataConventions.filter((c) => c.statut === 'candidate').length;
      const total = confirmed + candidate;
      setTauxCompletude(total > 0 ? (confirmed / total) * 100 : null);
      setNbCandidates(candidate);
      setCalculs(dataCalculs);
      setAnomalies(dataAnomalies);
      setLoaded(true);
    }
    void charger();
    return () => {
      annule = true;
    };
  }, [cabinetId, dossierId, refreshKey]);

  if (!loaded) return null;

  return (
    <section className="panel panel-full progression-panel">
      <div className="panel-header">
        <h2>Progression du dossier</h2>
      </div>
      <div className="progression-grid">
        <JaugeConfianceTiers tiers={tiers} />
        <JaugeCompletude tauxCompletude={tauxCompletude} nbCandidates={nbCandidates} />
        <IndicateurSuiteCycles calculs={calculs} anomalies={anomalies} />
      </div>
    </section>
  );
}
