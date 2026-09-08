import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ApiError, fetchPortesObligatoires } from '../api';
import type { EtatPortesObligatoires } from '../types';
import { CategorisationContenu } from './CategorisationPopup';
import { ComptesTvaAConfirmerPanel } from './ComptesTvaAConfirmerPanel';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sousOnglet, setSousOnglet] = useState<SousOngletPorte>('categorisation');

  useEffect(() => {
    let annule = false;
    setLoading(true);
    setError(null);
    fetchPortesObligatoires(cabinetId, dossierId, periodeDebut, periodeFin)
      .then((data) => {
        if (!annule) setEtat(data);
      })
      .catch((err) => {
        if (!annule) setError(err instanceof ApiError ? err.message : 'Impossible de charger les portes obligatoires');
      })
      .finally(() => {
        if (!annule) setLoading(false);
      });
    return () => {
      annule = true;
    };
  }, [cabinetId, dossierId, periodeDebut, periodeFin]);

  const ongletActif = ONGLETS_PORTES.find((o) => o.id === sousOnglet);

  function compteur(id: SousOngletPorte): number {
    if (!etat) return 0;
    if (id === 'categorisation') {
      return etat.categorisation.comptesACategoriser.length + etat.categorisation.comptesServiceSansSousCategorieAutoliquidation.length;
    }
    if (id === 'comptesTva') return etat.comptesTvaAConfirmer.length;
    if (id === 'rapprochement') return etat.rapprochementsPaiementAchat.length;
    return etat.parcVehiculesNonRenseigne ? 1 : 0;
  }

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true" aria-label="Portes obligatoires avant le cycle">
      <div className="popup">
        <div className="popup-header">
          <h2>Portes obligatoires avant le cycle</h2>
          <button className="popup-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        {loading && <p className="empty">Chargement…</p>}
        {error && <p className="error">{error}</p>}
        {etat && (
          <>
            <nav className="sous-onglets">
              {ONGLETS_PORTES.map((o) => {
                const n = compteur(o.id);
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
            <div key={sousOnglet} className="sous-onglet-contenu">
              {sousOnglet === 'categorisation' && (
                <CategorisationContenu
                  cabinetId={cabinetId}
                  dossierId={dossierId}
                  utilisateurId={utilisateurId}
                  comptes={etat.categorisation.comptesACategoriser}
                  comptesSousCategorieAutoliquidation={etat.categorisation.comptesServiceSansSousCategorieAutoliquidation}
                />
              )}
              {sousOnglet === 'comptesTva' && (
                <ComptesTvaAConfirmerPanel
                  cabinetId={cabinetId}
                  dossierId={dossierId}
                  utilisateurId={utilisateurId}
                  donneesInitiales={{ periodeDebut, periodeFin, comptes: etat.comptesTvaAConfirmer }}
                />
              )}
              {sousOnglet === 'rapprochement' && (
                <RapprochementPaiementAchatContenu
                  cabinetId={cabinetId}
                  dossierId={dossierId}
                  utilisateurId={utilisateurId}
                  periodeDebut={periodeDebut}
                  periodeFin={periodeFin}
                  factures={etat.rapprochementsPaiementAchat}
                />
              )}
              {sousOnglet === 'vehicules' && (
                <VehiculesPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
