import { useEffect, useState, type CSSProperties } from 'react';
import { ATraiterPanel } from './components/ATraiterPanel';
import { LoginScreen } from './components/LoginScreen';
import { ParametresPanel } from './components/ParametresPanel';
import { ProgressionPanel } from './components/ProgressionPanel';
import { Sidebar, ZONES, type Zone } from './components/Sidebar';
import { ConfigurationZone, type SousOngletConfiguration } from './components/zones/ConfigurationZone';
import { CycleZone } from './components/zones/CycleZone';
import { HistoriqueZone } from './components/zones/HistoriqueZone';
import { UtilisateursZone } from './components/zones/UtilisateursZone';
import { definirJeton, fetchAnomalies, fetchCalculs, fetchConventions, fetchParametresDossier, surSessionExpiree } from './api';
import { toDateOnly } from './dateUtils';
import {
  CLE_THEME_DEGRADE,
  CLES_CONVENTIONS_COMPTES,
  DEGRADE_PAR_DEFAUT,
  type CleConventionCompte,
  type CompteACategoriser,
  type CompteClientSansTauxAssigne,
  type CompteSansTauxAssigne,
  type Dossier,
  type ElementATraiter,
  type Session,
} from './types';

const STORAGE_KEY_SESSION = 'module6.session';
const STORAGE_KEY_DOSSIER = 'module6.dossier';

function chargerSession(): Session | null {
  try {
    const brut = localStorage.getItem(STORAGE_KEY_SESSION);
    if (brut) return JSON.parse(brut) as Session;
  } catch {
    // localStorage indisponible ou contenu invalide, on repart sans session
    // (l'écran de connexion s'affichera).
  }
  return null;
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
  const [session, setSession] = useState<Session | null>(chargerSession);
  const [dossier, setDossier] = useState<Dossier | null>(chargerDossier);
  const [zone, setZone] = useState<Zone>('cycle');
  const [sousOngletConfiguration, setSousOngletConfiguration] = useState<SousOngletConfiguration>('comptes');
  const [periodeCycle, setPeriodeCycle] = useState<{ debut: string; fin: string } | null>(null);
  const [aTraiterRefreshKey, setATraiterRefreshKey] = useState(0);
  // Brief v27 : bumpé après "Synchroniser les dossiers" pour que la
  // recherche de dossiers du volet latéral (Sidebar.tsx) reflète
  // immédiatement les nouveaux dossiers, sans attendre une nouvelle
  // frappe dans le champ de recherche.
  const [dossiersRefreshKey, setDossiersRefreshKey] = useState(0);
  const [degrade, setDegrade] = useState<string>(DEGRADE_PAR_DEFAUT);
  const [suggestionsTauxComptes, setSuggestionsTauxComptes] = useState<CompteSansTauxAssigne[]>([]);
  const [suggestionsTauxClients, setSuggestionsTauxClients] = useState<CompteClientSansTauxAssigne[]>([]);
  const [suggestionsAutoliquidation, setSuggestionsAutoliquidation] = useState<CompteACategoriser[]>([]);

  // Authentification (brief v25) — jeton donné à api.ts dès qu'une session
  // existe (chargée depuis localStorage au premier rendu, ou fraîchement
  // posée après connexion) ; surSessionExpiree branche un 401 SUR N'IMPORTE
  // QUEL appel (jeton absent, invalide ou expiré) vers une déconnexion
  // propre — un seul point d'écoute pour toute l'application.
  useEffect(() => {
    definirJeton(session?.jeton ?? null);
  }, [session]);

  useEffect(() => {
    surSessionExpiree(() => deconnexion());
    return () => surSessionExpiree(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connexionReussie(nouvelleSession: Session) {
    setSession(nouvelleSession);
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(nouvelleSession));
  }

  // Réinitialise aussi le dossier et l'état éphémère lié — sans ça, un
  // autre utilisateur (éventuellement d'un cabinet différent) qui se
  // connecte ensuite dans le même onglet verrait encore le dossier et les
  // suggestions de la session précédente.
  function deconnexion() {
    setSession(null);
    localStorage.removeItem(STORAGE_KEY_SESSION);
    localStorage.removeItem(STORAGE_KEY_DOSSIER);
    definirJeton(null);
    setDossier(null);
    setZone('cycle');
    setPeriodeCycle(null);
    setSuggestionsTauxComptes([]);
    setSuggestionsTauxClients([]);
    setSuggestionsAutoliquidation([]);
  }

  // cabinetId toujours calculé, jamais sous condition — comme avant
  // l'authentification (identite.cabinetId pouvait déjà être vide avant
  // saisie) : garde tous les hooks ci-dessous inconditionnels, le retour
  // anticipé vers l'écran de connexion arrive après, cf. plus bas (règle
  // des hooks React : jamais après un retour conditionnel).
  const cabinetId = session?.utilisateur.cabinetId ?? '';

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

  if (!session) {
    return <LoginScreen onConnecte={connexionReussie} />;
  }

  const { role } = session.utilisateur;
  const utilisateurId = session.utilisateur.id;

  function selectionnerDossier(d: Dossier) {
    setDossier(d);
    localStorage.setItem(STORAGE_KEY_DOSSIER, JSON.stringify(d));
    setZone('cycle');
    setPeriodeCycle(null);
    setATraiterRefreshKey((k) => k + 1);
    setSuggestionsTauxComptes([]);
    setSuggestionsTauxClients([]);
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

  // Une anomalie compte_tva_non_reconnu se résout le plus souvent en
  // confirmant une convention d'autoliquidation — amène directement sur
  // Conventions génériques plutôt que de laisser chercher (brief v30).
  function allerVersConventionsGeneriques() {
    setSousOngletConfiguration('generiques');
    setZone('configuration');
  }

  // Troisième porte obligatoire avant un cycle (brief v38), même principe
  // que la catégorisation ci-dessus mais sans données à pré-remplir — un
  // 409 sur le parc de véhicules manquant amène directement sur l'écran
  // de gestion du parc.
  function allerVersParcVehicules() {
    setSousOngletConfiguration('vehicules');
    setZone('configuration');
  }

  return (
    <div className="app-shell" style={{ '--degrade-actif': degrade } as CSSProperties}>
      <Sidebar
        cabinetId={cabinetId}
        role={role}
        dossier={dossier}
        onSelectDossier={selectionnerDossier}
        zone={zone}
        onChangeZone={allerVersZone}
        onDeconnexion={deconnexion}
        dossiersRefreshKey={dossiersRefreshKey}
      />

      <div className="app-content">
        {!dossier ? (
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

            <main className="app-main" key={zone}>
              {zone === 'cycle' && (
                <CycleZone
                  cabinetId={cabinetId}
                  dossierId={dossier.id}
                  utilisateurId={utilisateurId}
                  periode={periodeCycle}
                  onPeriodeChange={setPeriodeCycle}
                  onSuggestionsTaux={(comptes, clients) => {
                    setSuggestionsTauxComptes(comptes);
                    setSuggestionsTauxClients(clients);
                  }}
                  onSuggestionsAutoliquidation={setSuggestionsAutoliquidation}
                  onCompteNonReconnuClic={allerVersConventionsGeneriques}
                  onParcVehiculesManquant={allerVersParcVehicules}
                />
              )}
              {zone === 'configuration' && (
                <ConfigurationZone
                  cabinetId={cabinetId}
                  dossierId={dossier.id}
                  utilisateurId={utilisateurId}
                  sousOnglet={sousOngletConfiguration}
                  onChangeSousOnglet={setSousOngletConfiguration}
                  suggestionsTauxComptes={suggestionsTauxComptes}
                  suggestionsTauxClients={suggestionsTauxClients}
                  onSuggestionTauxCompteConsommee={(compte) =>
                    setSuggestionsTauxComptes((prev) => prev.filter((c) => c.compte !== compte))
                  }
                  onSuggestionTauxClientConsommee={(numeroCompteTiers) =>
                    setSuggestionsTauxClients((prev) => prev.filter((c) => c.numeroCompteTiers !== numeroCompteTiers))
                  }
                  suggestionsAutoliquidation={suggestionsAutoliquidation}
                  onSuggestionAutoliquidationConsommee={(compte) =>
                    setSuggestionsAutoliquidation((prev) => prev.filter((c) => c.compte !== compte))
                  }
                />
              )}
              {zone === 'historique' && (
                <HistoriqueZone
                  cabinetId={cabinetId}
                  dossierId={dossier.id}
                  utilisateurId={utilisateurId}
                  onCompteNonReconnuClic={allerVersConventionsGeneriques}
                />
              )}
              {zone === 'parametres' && (
                <ParametresPanel
                  cabinetId={cabinetId}
                  dossierId={dossier.id}
                  utilisateurId={utilisateurId}
                  role={role}
                  degradeActif={degrade}
                  onDegradeChange={setDegrade}
                  onDossiersSynchronises={() => setDossiersRefreshKey((k) => k + 1)}
                  dossiersRefreshKey={dossiersRefreshKey}
                />
              )}
              {zone === 'utilisateurs' && role === 'admin_cabinet' && <UtilisateursZone cabinetId={cabinetId} />}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
