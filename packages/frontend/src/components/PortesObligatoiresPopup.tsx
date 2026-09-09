import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ApiError, fetchPortesObligatoires } from '../api';
import type { EtatPortesObligatoires } from '../types';
import { CategorisationContenu } from './CategorisationPopup';
import { ComptesTvaAConfirmerPanel } from './ComptesTvaAConfirmerPanel';
import { JaugeChargement } from './JaugeChargement';
import { RapprochementPaiementAchatContenu } from './RapprochementPaiementAchatPopup';
import { VehiculesPanel } from './VehiculesPanel';

interface PortesObligatoiresPopupProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periodeDebut: string;
  periodeFin: string;
  onClose: () => void;
}

type SousOngletPorte = 'categorisation' | 'comptesTva' | 'rapprochement' | 'vehicules';

const ONGLETS_PORTES: { id: SousOngletPorte; libelle: string; description: string }[] = [
  {
    id: 'categorisation',
    libelle: 'Catégorisation',
    description:
      "Comptes produit/charge mouvementés sur la période mais absents des conventions, ou comptes de charge de service sans sous-catégorie d'autoliquidation tranchée.",
  },
  {
    id: 'comptesTva',
    libelle: 'Comptes TVA à confirmer',
    description:
      "Comptes de la famille TVA (445xx) mouvementés mais jamais confirmés dans l'un de leurs rôles (dû/déductible, BTP ou intracom).",
  },
  {
    id: 'rapprochement',
    libelle: 'Rapprochements paiements achats',
    description: "Factures de service non payées, avec leurs paiements candidats à valider ou écarter.",
  },
  {
    id: 'vehicules',
    libelle: 'Parc de véhicules',
    description: "Un compte carburant a été mouvementé sur la période, mais aucun véhicule n'est encore renseigné.",
  },
];

// Popup unique à onglets pour les 4 portes obligatoires avant un cycle
// (brief v58) — remplace les boutons/redirections séparés qui géraient
// jusqu'ici chacune des 4 portes (catégorisation, comptes TVA à confirmer,
// rapprochements paiement achat, parc de véhicules). Un seul appel réseau
// (GET /dossiers/:dossierId/portes-obligatoires) peuple les 4 onglets ;
// chaque onglet réutilise tel quel le composant déjà existant pour cette
// porte précise (CategorisationContenu et RapprochementPaiementAchatContenu,
// extraits des anciennes popups dédiées ; ComptesTvaAConfirmerPanel et
// VehiculesPanel, réutilisés sans changement pour ce dernier). Même
// principe de structure de sous-onglets que Paramètres cabinet/dossier et
// Confiance des tiers Clients/Fournisseurs.
export function PortesObligatoiresPopup({
  cabinetId,
  dossierId,
  utilisateurId,
  periodeDebut,
  periodeFin,
  onClose,
}: PortesObligatoiresPopupProps) {
  const [etat, setEtat] = useState<EtatPortesObligatoires | null>(null);
  // Même jauge que le lancement de cycle (brief v59) — un seul appel
  // réseau, la jauge ne reflète aucune vraie progression interne. La coche
  // de fin ('succes') signale uniquement la FIN du chargement, jamais
  // l'absence d'éléments à traiter : elle apparaît systématiquement dès
  // que la réponse arrive, que les 4 portes soient vides ou non — seul le
  // message qui l'accompagne varie selon ce qui a été trouvé.
  const [phase, setPhase] = useState<'chargement' | 'succes' | null>('chargement');
  const [error, setError] = useState<string | null>(null);
  const [sousOnglet, setSousOnglet] = useState<SousOngletPorte>('categorisation');

  const ongletActif = ONGLETS_PORTES.find((o) => o.id === sousOnglet);

  function compteur(id: SousOngletPorte, source: EtatPortesObligatoires): number {
    if (id === 'categorisation') {
      return source.categorisation.comptesACategoriser.length + source.categorisation.comptesServiceSansSousCategorieAutoliquidation.length;
    }
    if (id === 'comptesTva') return source.comptesTvaAConfirmer.length;
    if (id === 'rapprochement') return source.rapprochementsPaiementAchat.length;
    return source.parcVehiculesNonRenseigne ? 1 : 0;
  }

  // Rechargement complet de l'agrégateur, réutilisé au montage initial ET
  // à la demande (brief v69, cf. useEffect et rechargerApresCategorisation
  // ci-dessous) — un seul minuteur de coche à annuler proprement dans les
  // deux cas, gardé dans un ref plutôt que dans la fermeture locale d'un
  // seul appelant.
  const idTimeoutCocheRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function chargerEtat(signal?: AbortSignal) {
    setPhase('chargement');
    setError(null);
    if (idTimeoutCocheRef.current) clearTimeout(idTimeoutCocheRef.current);
    try {
      const data = await fetchPortesObligatoires(cabinetId, dossierId, periodeDebut, periodeFin, signal);
      setEtat(data);
      setPhase('succes');
      idTimeoutCocheRef.current = setTimeout(() => {
        setPhase(null);
      }, 1100);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les portes obligatoires');
      setPhase(null);
    }
  }

  useEffect(() => {
    // Bug réel investigué en profondeur (brief v63, point 3, même rigueur
    // que le v60) : l'AbortController du v61 empêchait déjà le CLIENT de
    // traiter la réponse du montage jeté par le double-invoque StrictMode
    // (dev), mais PAS le SERVEUR de traiter réellement les deux appels en
    // double — abort() annule une requête déjà en vol côté navigateur,
    // mais n'empêche pas le fetch() du premier montage d'avoir déjà
    // atteint le serveur avant que le nettoyage synchrone (montage ->
    // nettoyage -> remontage, tout dans le même tick) n'ait pu appeler
    // abort(). Deux exécutions réelles et concurrentes de l'agrégateur
    // (potentiellement lent, cf. chantier de performance backend) restent
    // donc possibles à chaque ouverture du popup, une cause plausible
    // d'une réponse incomplète en cas d'interférence côté connecteur
    // Pennylane sous appels simultanés. Corrigé en reportant l'appel réel
    // d'un tick (setTimeout 0) : le montage jeté par StrictMode annule ce
    // minuteur avant qu'il n'ait eu la moindre chance de s'exécuter (le
    // montage/nettoyage/remontage de StrictMode est entièrement
    // synchrone), donc SEUL le montage qui survit déclenche un appel
    // réseau pour de vrai — plus aucune requête doublon n'atteint jamais
    // le serveur, vérifié par comptage réel des requêtes réseau.
    let annule = false;
    const controller = new AbortController();
    const idDelai = setTimeout(() => {
      if (annule) return;
      void chargerEtat(controller.signal);
    }, 0);
    return () => {
      annule = true;
      clearTimeout(idDelai);
      controller.abort();
      if (idTimeoutCocheRef.current) clearTimeout(idTimeoutCocheRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId, periodeDebut, periodeFin]);

  // Cause racine identifiée au brief v69, par élimination et sur
  // observation directe de Rami : l'agrégateur ne calculait les 4 portes
  // QU'À L'OUVERTURE du popup — caté à catégoriser, confirmer les comptes
  // TVA, puis regarder les rapprochements DANS LE MÊME POPUP laissait les
  // 3 autres onglets et les badges bloqués sur leur tout premier
  // instantané, jamais recalculés. Les 3 investigations précédentes
  // (v65/v66/v68) ne l'avaient jamais trouvé car elles testaient toujours
  // sur un état déjà stable AVANT l'ouverture, jamais une catégorisation
  // faite pendant que le popup est ouvert. Signal de fin de lot déjà
  // utilisé au v64 (comptesACategoriser devient vide) — mais cette fois,
  // au lieu de ne rafraîchir QUE la sous-catégorisation (rafraichirSousCategorie
  // dans CategorisationContenu, insuffisant : ne touche jamais les 3
  // autres onglets ni les badges), on relance l'agrégateur complet et on
  // remplace tout l'état d'un coup — même jauge de chargement que le
  // montage initial (~35s sur un vrai dossier), pas un nouveau mécanisme.
  function rechargerApresCategorisation() {
    void chargerEtat();
  }

  const totalAregler = etat
    ? (['categorisation', 'comptesTva', 'rapprochement', 'vehicules'] as SousOngletPorte[]).reduce(
        (acc, id) => acc + compteur(id, etat),
        0
      )
    : 0;
  const messageSucces =
    totalAregler === 0
      ? 'Vérification terminée, aucune porte obligatoire à régler pour cette période'
      : `Vérification terminée, ${totalAregler} élément(s) à régler`;

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true" aria-label="Portes obligatoires avant le cycle">
      <div className="popup">
        <div className={`popup-header${phase ? ' popup-header-centre' : ''}`}>
          <h2>Portes obligatoires avant le cycle</h2>
          <button className="popup-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        {phase && (
          <div className="popup-cycle-loading">
            <JaugeChargement phase={phase} messageSucces={messageSucces} />
            {/* Mystère résolu aux briefs v65/v66 : l'onglet rapprochements ne
                manquait rien, la catégorisation des comptes de charge n'était
                simplement pas encore terminée au moment où Rami regardait —
                pas un bug. Message reformulé au v68 : le brief v67 le
                présentait à tort comme propre à l'onglet rapprochements,
                alors que depuis le correctif de performance backend
                (portesObligatoires.ts), les 4 portes se chargent en un seul
                appel groupé à l'ouverture du popup — il n'y a plus de
                chargement séparé par onglet. Reformulé pour rester honnête
                sur ce qui se passe réellement : un seul chargement pour les
                4 portes, dont le contenu (tous onglets confondus) dépend de
                l'état actuel de la catégorisation. Même mise en évidence que
                la sous-catégorisation autoliquidation (brief v63) : reste
                visible tant que le chargement n'est pas réellement terminé,
                jamais un état "terminé" prématuré. */}
            <p className="avertissement">
              <strong>
                Chargement des 4 portes obligatoires en cours… Le contenu de chaque onglet (comptes à catégoriser,
                TVA à confirmer, rapprochements, parc de véhicules) dépend de l'état actuel de la catégorisation et
                des conventions déjà confirmées pour ce dossier.
              </strong>
            </p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {!phase && etat && (
          <>
            <nav className="sous-onglets">
              {ONGLETS_PORTES.map((o) => {
                const n = compteur(o.id, etat);
                return (
                  <button
                    key={o.id}
                    className={`sous-onglet${sousOnglet === o.id ? ' actif' : ''}`}
                    onClick={() => setSousOnglet(o.id)}
                  >
                    {o.libelle}
                    {n > 0 ? ` (${n})` : ''}
                  </button>
                );
              })}
            </nav>
            {ongletActif && <p className="sous-onglet-description">{ongletActif.description}</p>}
            {/* Bug réel corrigé (brief v60) : les 4 onglets restent montés en
                permanence, seule leur visibilité bascule (hidden), au lieu
                d'un rendu conditionnel exclusif qui démontait/remontait le
                composant de l'onglet quitté. Chaque onglet gère localement
                l'état des éléments déjà traités (retirés de sa propre liste
                sans re-fetch) — un démontage perdait cet état à chaque
                retour sur l'onglet, faisant réapparaître des comptes déjà
                confirmés ou des factures déjà rapprochées, parfois en double
                avec les listes qui, elles, se rechargent réellement (ex :
                "Comptes TVA déjà confirmés"). */}
            <div className="sous-onglet-contenu" hidden={sousOnglet !== 'categorisation'}>
              <CategorisationContenu
                cabinetId={cabinetId}
                dossierId={dossierId}
                utilisateurId={utilisateurId}
                comptes={etat.categorisation.comptesACategoriser}
                comptesSousCategorieAutoliquidation={etat.categorisation.comptesServiceSansSousCategorieAutoliquidation}
                suggestions={etat.categorisation.suggestions}
                periodeDebut={periodeDebut}
                periodeFin={periodeFin}
                onLotTermine={rechargerApresCategorisation}
              />
            </div>
            <div className="sous-onglet-contenu" hidden={sousOnglet !== 'comptesTva'}>
              <ComptesTvaAConfirmerPanel
                cabinetId={cabinetId}
                dossierId={dossierId}
                utilisateurId={utilisateurId}
                donneesInitiales={{ periodeDebut, periodeFin, comptes: etat.comptesTvaAConfirmer }}
              />
            </div>
            <div className="sous-onglet-contenu" hidden={sousOnglet !== 'rapprochement'}>
              <RapprochementPaiementAchatContenu
                cabinetId={cabinetId}
                dossierId={dossierId}
                utilisateurId={utilisateurId}
                periodeDebut={periodeDebut}
                factures={etat.rapprochementsPaiementAchat}
              />
            </div>
            <div className="sous-onglet-contenu" hidden={sousOnglet !== 'vehicules'}>
              <VehiculesPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
