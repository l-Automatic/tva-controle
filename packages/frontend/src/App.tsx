import { useEffect, useState, type CSSProperties } from 'react';
import { ATraiterPanel } from './components/ATraiterPanel';
import { ParametresPanel } from './components/ParametresPanel';
import { ProgressionPanel } from './components/ProgressionPanel';
import { Sidebar, ZONES, type Zone } from './components/Sidebar';
import { ConfigurationZone, type SousOngletConfiguration } from './components/zones/ConfigurationZone';
import { CycleZone } from './components/zones/CycleZone';
import { HistoriqueZone } from './components/zones/HistoriqueZone';
import { fetchAnomalies, fetchCalculs, fetchConventions, fetchParametresDossier } from './api';
import { toDateOnly } from './dateUtils';
import {
  CLE_THEME_DEGRADE,
  CLES_CONVENTIONS_COMPTES,
  DEGRADE_PAR_DEFAUT,
  type CleConventionCompte,
  type Dossier,
  type ElementATraiter,
} from './types';

const STORAGE_KEY = 'module6.identite';
const STORAGE_KEY_DOSSIER = 'module6.dossier';

interface Identite {
  cabinetId: string;
  utilisateurId: string;
}

function chargerIdentite(): Identite {
  try {
    const brut = localStorage.getItem(STORAGE_KEY);
    if (brut) return JSON.parse(brut) as Identite;
  } catch {
    // localStorage indisponible ou contenu invalide, on repart des valeurs par défaut
  }
  return { cabinetId: '', utilisateurId: '' };
}

function chargerDossier(): Dossier | null {
  try {
    const brut = localStorage.getItem(STORAGE_KEY_DOSSIER);
    if (brut) return JSON.parse(brut) as Dossier;
  } catch {
    // idem
  }
  return null;
}

export function App() {
  const [identite, setIdentite] = useState<Identite>(chargerIdentite);
  const [dossier, setDossier] = useState<Dossier | null>(chargerDossier);
  const [zone, setZone] = useState<Zone>('cycle');
  const [sousOngletConfiguration, setSousOngletConfiguration] = useState<SousOngletConfiguration>('comptes');
  const [periodeCycle, setPeriodeCycle] = useState<{ debut: string; fin: string } | null>(null);
  const [aTraiterRefreshKey, setATraiterRefreshKey] = useState(0);
  const [degrade, setDegrade] = useState<string>(DEGRADE_PAR_DEFAUT);

  const { cabinetId, utilisateurId } = identite;

  useEffect(() => {
    if (!cabinetId || !dossier) {
      setDegrade(DEGRADE_PAR_DEFAUT);
      return;
    }
    let annule = false;
    fetchParametresDossier(cabinetId, dossier.id).then((parametres) => {
      if (annule) return;
      const param = parametres.find((p) => p.cle === CLE_THEME_DEGRADE);
      setDegrade(typeof param?.valeur === 'string' ? param.valeur : DEGRADE_PAR_DEFAUT);
    });
    return () => {
      annule = true;
    };
  }, [cabinetId, dossier]);

  function mettreAJourIdentite(champ: keyof Identite, valeur: string) {
    const suivante = { ...identite, [champ]: valeur };
    setIdentite(suivante);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(suivante));
  }

  function selectionnerDossier(d: Dossier) {
    setDossier(d);
    localStorage.setItem(STORAGE_KEY_DOSSIER, JSON.stringify(d));
    setZone('cycle');
    setPeriodeCycle(null);
    setATraiterRefreshKey((k) => k + 1);
  }

  function allerVersZone(z: Zone) {
    setZone(z);
    // Ce qui reste "à traiter" a pu changer pendant qu'on travaillait dans
    // la zone précédente (anomalie résolue, convention confirmée…) — on
    // rafraîchit à chaque changement de zone plutôt que de laisser la
    // bannière devenir silencieusement obsolète.
    setATraiterRefreshKey((k) => k + 1);
  }

  // Amène l'utilisateur directement sur l'écran concerné pour traiter
  // l'élément cliqué, pas juste sur la bonne zone en général. Les résumés
  // de /a-traiter ne portent pas la période/la clé complète — on la
  // retrouve via les listes déjà exposées.
  async function naviguerVersElement(el: ElementATraiter) {
    const { cabinetId } = identite;
    if (!dossier) return;

    switch (el.type) {
      case 'anomalie_bloquante': {
        const anomalies = await fetchAnomalies(cabinetId, dossier.id);
        const a = anomalies.find((a) => a.id === el.id);
        if (a) {
          const debut = toDateOnly(a.periode);
          // Une anomalie ne porte que sa periode (= periodeDebut du cycle qui
          // l'a générée, cf. pipeline.ts) — on retrouve la periodeFin exacte
          // via le calcul correspondant s'il existe déjà, sinon on retombe
          // sur debut=fin (un cycle bloqué avant calcul n'a pas encore de
          // calcul brouillon à afficher de toute façon).
          const calculs = await fetchCalculs(cabinetId, dossier.id);
          const calculCorrespondant = calculs.find((c) => toDateOnly(c.periodeDebut) === debut);
          setPeriodeCycle({ debut, fin: calculCorrespondant ? toDateOnly(calculCorrespondant.periodeFin) : debut });
        }
        setZone('cycle');
        break;
      }
      case 'calcul_brouillon': {
        const calculs = await fetchCalculs(cabinetId, dossier.id);
        const c = calculs.find((c) => c.id === el.id);
        if (c) setPeriodeCycle({ debut: toDateOnly(c.periodeDebut), fin: toDateOnly(c.periodeFin) });
        setZone('cycle');
        break;
      }
      case 'convention_candidate': {
        const conventions = await fetchConventions(cabinetId, dossier.id);
        const c = conventions.find((c) => c.id === el.id);
        const estCompte = c?.cle && CLES_CONVENTIONS_COMPTES.includes(c.cle as CleConventionCompte);
        setSousOngletConfiguration(estCompte ? 'comptes' : 'generiques');
        setZone('configuration');
        break;
      }
      case 'taux_candidate':
      case 'taux_tiers_candidate':
        setSousOngletConfiguration('taux');
        setZone('configuration');
        break;
    }
  }

  const identiteComplete = Boolean(cabinetId && utilisateurId);

  return (
    <div className="app-shell" style={{ '--degrade-actif': degrade } as CSSProperties}>
      <Sidebar
        cabinetId={cabinetId}
        utilisateurId={utilisateurId}
        onIdentiteChange={mettreAJourIdentite}
        dossier={dossier}
        onSelectDossier={selectionnerDossier}
        zone={zone}
        onChangeZone={allerVersZone}
      />

      <div className="app-content">
        {!identiteComplete ? (
          <p className="empty">Renseignez le cabinet et l'utilisateur dans le volet latéral pour commencer.</p>
        ) : !dossier ? (
          <p className="empty">Sélectionnez un dossier dans le volet latéral pour commencer.</p>
        ) : (
          <>
            <ATraiterPanel
              cabinetId={cabinetId}
              dossierId={dossier.id}
              onNaviguer={(el) => void naviguerVersElement(el)}
              refreshKey={aTraiterRefreshKey}
            />
            <ProgressionPanel cabinetId={cabinetId} dossierId={dossier.id} refreshKey={aTraiterRefreshKey} />

            <div className="zone-intro">
              <h1>{ZONES.find((z) => z.id === zone)?.libelle}</h1>
              <p className="zone-description">{ZONES.find((z) => z.id === zone)?.description}</p>
            </div>

            <main className="app-main">
              {zone === 'cycle' && (
                <CycleZone
                  cabinetId={cabinetId}
                  dossierId={dossier.id}
                  utilisateurId={utilisateurId}
                  periode={periodeCycle}
                  onPeriodeChange={setPeriodeCycle}
                />
              )}
              {zone === 'configuration' && (
                <ConfigurationZone
                  cabinetId={cabinetId}
                  dossierId={dossier.id}
                  utilisateurId={utilisateurId}
                  sousOnglet={sousOngletConfiguration}
                  onChangeSousOnglet={setSousOngletConfiguration}
                />
              )}
              {zone === 'historique' && (
                <HistoriqueZone cabinetId={cabinetId} dossierId={dossier.id} utilisateurId={utilisateurId} />
              )}
              {zone === 'parametres' && (
                <ParametresPanel
                  cabinetId={cabinetId}
                  dossierId={dossier.id}
                  utilisateurId={utilisateurId}
                  degradeActif={degrade}
                  onDegradeChange={setDegrade}
                />
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
