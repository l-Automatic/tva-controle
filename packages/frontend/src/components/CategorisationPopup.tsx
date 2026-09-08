import { useState } from 'react';
import { X } from 'lucide-react';
import { ApiError, ajouterConvention, confirmerConvention } from '../api';
import { useToast } from '../toast';
import { SuggestionIABlock } from './SuggestionIABlock';
import type { CompteACategoriser } from '../types';

interface CategorisationPopupProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  comptes: CompteACategoriser[];
  // Second motif de blocage (brief v46) — comptes de charge service déjà
  // catégorisés, mais dont le lien avec l'autoliquidation (sous-traitance)
  // n'a jamais été tranché. Optionnel : les appelants pré-v46 (aucun ici en
  // pratique, mais gardé simple) n'ont qu'à ne pas le passer.
  comptesSousCategorieAutoliquidation?: CompteACategoriser[];
  onClose: () => void;
}

// comptes_vente_export (brief v51) — censée être la seule catégorie
// jamais bloquante : n'affecte que l'affichage déclaratif (lignes 6/7 de
// la CA3), jamais le calcul de TVA, peut rester non confirmée
// indéfiniment sans bloquer un cycle. Ajoutée ici comme les 8 autres
// (même route générique de conventions) — MAIS un compte confirmé sous
// cette clé n'est aujourd'hui PAS exempté de la porte de catégorisation
// obligatoire côté backend (verifierComptesACategoriser ne passe pas
// comptesVenteExport à identifierComptesACategoriser, alors que la
// fonction de détection elle-même le supporte déjà) : tant que ce n'est
// pas corrigé côté backend, ce compte réapparaîtra dans ce même popup à
// chaque cycle malgré la confirmation, contrairement à ce que ce brief
// demande. Signalé, pas corrigé ici (hors périmètre frontend).
const CHOIX = [
  { cle: 'comptes_vente_service', libelle: 'Vente de service' },
  { cle: 'comptes_charge_service', libelle: 'Charge de service' },
  { cle: 'comptes_equipement', libelle: 'Équipement' },
  { cle: 'comptes_carburant', libelle: 'Carburant' },
  { cle: 'comptes_cadeaux', libelle: 'Cadeaux clients' },
  { cle: 'comptes_immobilisation', libelle: 'Immobilisation' },
  { cle: 'comptes_entretien_vehicule', libelle: 'Entretien véhicule' },
  { cle: 'comptes_location_vehicule', libelle: 'Location véhicule' },
  { cle: 'comptes_vente_export', libelle: 'Vente export' },
] as const;

function CompteCard({
  compte,
  cabinetId,
  dossierId,
  utilisateurId,
  onTraite,
}: {
  compte: CompteACategoriser;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onTraite: () => void;
}) {
  // Présélection IA (brief v10) : le select part pré-rempli sur la suggestion
  // si elle existe et n'est pas null, mais rien n'est envoyé au serveur tant
  // que l'utilisateur n'a pas lui-même cliqué sur "Ajouter" — la présélection
  // n'est qu'un point de départ, jamais une validation implicite.
  const [cle, setCle] = useState(compte.suggestionIA?.categorieSuggeree ?? '');
  const [enCours, setEnCours] = useState<'ajouter' | 'aucune' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleAjouter() {
    if (!cle) return;
    const libelle = CHOIX.find((c) => c.cle === cle)?.libelle ?? cle;
    setEnCours('ajouter');
    setError(null);
    try {
      const { id } = await ajouterConvention(cabinetId, dossierId, utilisateurId, cle, [compte.compte]);
      await confirmerConvention(cabinetId, id, utilisateurId);
      notifier(`Compte ${compte.compte} catégorisé : ${libelle}`);
      onTraite();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec de la catégorisation du compte ${compte.compte}`);
    } finally {
      setEnCours(null);
    }
  }

  // Bug réel corrigé côté backend (brief v20) : "Aucune de celles-là" ne
  // mémorisait rien nulle part — le compte était redétecté à l'identique à
  // chaque cycle suivant. Même geste que les 6 vraies catégories (mêmes
  // routes), clé technique 'comptes_sans_categorie' distincte — jamais
  // ajoutée à CLES_CONVENTIONS_COMPTES pour ne pas apparaître comme une 7ᵉ
  // catégorie fiscale ; elle atterrit naturellement dans Conventions
  // génériques, comme les autres clés techniques.
  async function handleAucuneCategorie() {
    setEnCours('aucune');
    setError(null);
    try {
      const { id } = await ajouterConvention(cabinetId, dossierId, utilisateurId, 'comptes_sans_categorie', [
        compte.compte,
      ]);
      await confirmerConvention(cabinetId, id, utilisateurId);
      notifier(`Compte ${compte.compte}, aucune catégorie, ne réapparaîtra plus`);
      onTraite();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec de l'enregistrement du compte ${compte.compte}`);
    } finally {
      setEnCours(null);
    }
  }

  return (
    <li className="card">
      <p className="label">Compte {compte.compte}</p>
      {compte.exemplesLibelle.length > 0 && <p className="reference">{compte.exemplesLibelle.join(' · ')}</p>}
      {compte.suggestionIA && <SuggestionIABlock suggestion={compte.suggestionIA} />}
      {error && <p className="error">{error}</p>}
      <div className="popup-choix">
        <select value={cle} disabled={enCours !== null} onChange={(e) => setCle(e.target.value)}>
          <option value="">Choisir une catégorie…</option>
          {CHOIX.map((c) => (
            <option key={c.cle} value={c.cle}>
              {c.libelle}
            </option>
          ))}
        </select>
        <button disabled={enCours !== null || !cle} onClick={() => void handleAjouter()}>
          {enCours === 'ajouter' ? '…' : 'Ajouter'}
        </button>
        <button className="secondary" disabled={enCours !== null} onClick={() => void handleAucuneCategorie()}>
          {enCours === 'aucune' ? '…' : 'Aucune de celles-là'}
        </button>
      </div>
    </li>
  );
}

// Sous-catégorisation autoliquidation (brief v46) — deuxième motif de
// blocage distinct de la catégorisation ci-dessus : ce compte est déjà
// catégorisé en charge de service, mais son lien avec l'autoliquidation
// (sous-traitance) n'a jamais été tranché. Deux choix seulement, pas un
// menu déroulant à 6 entrées — même geste ajouterConvention+confirmerConvention
// que CompteCard, clés distinctes (comptes_charge_autoliquidation /
// comptes_charge_autoliquidation_rejetee).
function CompteSousCategorieAutoliquidationCard({
  compte,
  cabinetId,
  dossierId,
  utilisateurId,
  onTraite,
}: {
  compte: CompteACategoriser;
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onTraite: () => void;
}) {
  const [enCours, setEnCours] = useState<'lie' | 'non_lie' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleChoix(lie: boolean) {
    setEnCours(lie ? 'lie' : 'non_lie');
    setError(null);
    const cle = lie ? 'comptes_charge_autoliquidation' : 'comptes_charge_autoliquidation_rejetee';
    try {
      const { id } = await ajouterConvention(cabinetId, dossierId, utilisateurId, cle, [compte.compte]);
      await confirmerConvention(cabinetId, id, utilisateurId);
      notifier(`Compte ${compte.compte} : ${lie ? 'lié à l\'autoliquidation' : 'non lié à l\'autoliquidation'}`);
      onTraite();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Échec de l'enregistrement du compte ${compte.compte}`);
    } finally {
      setEnCours(null);
    }
  }

  return (
    <li className="card">
      <p className="label">Compte {compte.compte}</p>
      {compte.exemplesLibelle.length > 0 && <p className="reference">{compte.exemplesLibelle.join(' · ')}</p>}
      {error && <p className="error">{error}</p>}
      <div className="popup-choix">
        <button disabled={enCours !== null} onClick={() => void handleChoix(true)}>
          {enCours === 'lie' ? '…' : "Lié à l'autoliquidation (sous-traitance)"}
        </button>
        <button className="secondary" disabled={enCours !== null} onClick={() => void handleChoix(false)}>
          {enCours === 'non_lie' ? '…' : 'Non lié'}
        </button>
      </div>
    </li>
  );
}

// Comptes produit/charge mouvementés sur la période mais absents des 6
// conventions — proposés nus si aucune suggestion IA n'est disponible pour
// ce compte (cf. brief v2 section 5 ; 5ᵉ catégorie "cadeaux clients" en v6,
// 6ᵉ "immobilisation" en v9). La présélection IA (v10) reste une simple
// suggestion : jamais de validation automatique, l'ajout requiert toujours
// un clic explicite sur "Ajouter". Fermer sans tout traiter est normal :
// les comptes non traités réapparaîtront au prochain cycle.
export function CategorisationPopup({
  cabinetId,
  dossierId,
  utilisateurId,
  comptes: comptesInitiaux,
  comptesSousCategorieAutoliquidation: comptesSousCategorieInitiaux = [],
  onClose,
}: CategorisationPopupProps) {
  const [comptes, setComptes] = useState(comptesInitiaux);
  const [comptesSousCategorie, setComptesSousCategorie] = useState(comptesSousCategorieInitiaux);

  function retirer(compte: string) {
    setComptes((prev) => prev.filter((c) => c.compte !== compte));
  }

  function retirerSousCategorie(compte: string) {
    setComptesSousCategorie((prev) => prev.filter((c) => c.compte !== compte));
  }

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true" aria-label="Catégorisation des comptes">
      <div className="popup">
        <div className="popup-header">
          <h2>Comptes à catégoriser ({comptes.length})</h2>
          <button className="popup-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <p className="reference">
          Ces comptes produit/charge ont bougé sur la période mais ne sont dans aucune des 9 conventions. Les
          comptes non traités réapparaîtront au prochain cycle.
        </p>
        {comptes.length === 0 ? (
          <p className="empty">Tous les comptes ont été traités.</p>
        ) : (
          <ul className="card-list">
            {comptes.map((c) => (
              <CompteCard
                key={c.compte}
                compte={c}
                cabinetId={cabinetId}
                dossierId={dossierId}
                utilisateurId={utilisateurId}
                onTraite={() => retirer(c.compte)}
              />
            ))}
          </ul>
        )}

        {comptesSousCategorie.length > 0 && (
          <>
            <div className="panel-separateur" />
            <h2>Sous-catégorisation autoliquidation ({comptesSousCategorie.length})</h2>
            <p className="reference">
              Ces comptes de charge de service sont déjà catégorisés, mais leur lien avec l'autoliquidation
              (sous-traitance) n'a jamais été tranché.
            </p>
            <ul className="card-list">
              {comptesSousCategorie.map((c) => (
                <CompteSousCategorieAutoliquidationCard
                  key={c.compte}
                  compte={c}
                  cabinetId={cabinetId}
                  dossierId={dossierId}
                  utilisateurId={utilisateurId}
                  onTraite={() => retirerSousCategorie(c.compte)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
