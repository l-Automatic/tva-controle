import { useEffect, useState } from 'react';
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

  useEffect(() => {
    // AbortController plutôt qu'un simple booléen "annule" (brief v61) :
    // React StrictMode double-invoque cet effet en dev (montage ->
    // nettoyage -> remontage immédiat), et un simple booléen ignoré au
    // retour laissait quand même les DEUX appels réseau partir en
    // parallèle vers un agrégateur potentiellement lent (cf. chantier de
    // performance backend en cours) — signalé comme cause plausible du
    // chargement initial parfois incomplet. Le signal annule réellement la
    // requête abandonnée au lieu de seulement ignorer sa réponse.
    const controller = new AbortController();
    let idTimeout: ReturnType<typeof setTimeout> | undefined;
    setPhase('chargement');
    setError(null);
    fetchPortesObligatoires(cabinetId, dossierId, periodeDebut, periodeFin, controller.signal)
      .then((data) => {
        setEtat(data);
        setPhase('succes');
        idTimeout = setTimeout(() => {
          setPhase(null);
        }, 1100);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : 'Impossible de charger les portes obligatoires');
        setPhase(null);
      });
    return () => {
      controller.abort();
      if (idTimeout) clearTimeout(idTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId, periodeDebut, periodeFin]);

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
                periodeDebut={periodeDebut}
                periodeFin={periodeFin}
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
