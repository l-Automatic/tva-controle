import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ApiError, ajouterConvention, confirmerConvention, fetchComptesACategoriser } from '../api';
import { useToast } from '../toast';
import { SuggestionIABlock } from './SuggestionIABlock';
import type { CompteACategoriser, SuggestionIA } from '../types';

interface CategorisationContenuProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  comptes: CompteACategoriser[];
  // Second motif de blocage (brief v46) — comptes de charge service déjà
  // catégorisés, mais dont le lien avec l'autoliquidation (sous-traitance)
  // n'a jamais été tranché. Optionnel : les appelants pré-v46 (aucun ici en
  // pratique, mais gardé simple) n'ont qu'à ne pas le passer.
  comptesSousCategorieAutoliquidation?: CompteACategoriser[];
  // Suggestions IA pour cette porte précise (brief v64) — distinct du
  // suggestionIA déjà porté par un CompteACategoriser issu d'un cycle
  // complet (pipeline.ts, backend, mécanisme plus ancien) : ici un
  // tableau à part, apparié par numéro de compte, jamais nichée
  // directement par le backend. Vide par défaut — les appelants qui n'ont
  // pas cette donnée (aucun aujourd'hui, gardé simple) n'ont qu'à ne pas
  // la passer.
  suggestions?: SuggestionIA[];
  // Période du cycle en préparation (brief v61, point 3) — nécessaire pour
  // rejouer un contrôle ciblé (fetchComptesACategoriser) juste après la
  // confirmation d'un compte en comptes_charge_service : la sous-
  // catégorisation autoliquidation ne peut légitimement rien proposer tant
  // que cette liste est vide, ce n'est pas un bug backend, mais il ne faut
  // pas obliger à fermer et rouvrir tout le popup pour voir un nouveau
  // candidat apparaître.
  periodeDebut: string;
  periodeFin: string;
  // Popup unique à onglets (brief v58) — remonte le nombre de comptes
  // restants pour que l'enveloppe (CategorisationPopup ci-dessous, ou le
  // futur popup à onglets) puisse l'afficher dans son propre titre sans
  // dupliquer la logique de retrait locale.
  onCountChange?: (n: number) => void;
  // Cause racine du brief v69 : le rafraîchissement ciblé introduit au
  // v61/v64 (rafraichirSousCategorie ci-dessous) ne touchait jamais les 3
  // autres onglets du popup portes obligatoires ni leurs badges, restés
  // bloqués sur l'instantané initial même après une catégorisation faite
  // pendant que le popup est ouvert. Fourni uniquement par
  // PortesObligatoiresPopup (qui a un agrégateur complet à recharger) :
  // quand présent, remplace entièrement le rafraîchissement ciblé du
  // dessous dès que la liste principale se vide, quelle que soit la
  // catégorie choisie. Absent pour l'usage autonome (CycleZone.tsx, pas
  // d'agrégateur), qui garde alors l'ancien comportement ciblé.
  onLotTermine?: () => void;
}

// Associe chaque compte à sa suggestion IA par numéro de compte (brief
// v64) — categorieSuggeree null = l'IA n'a pas assez d'indice, ne rien
// associer dans ce cas (CompteCard n'affiche déjà rien sans suggestionIA).
// N'écrase jamais un suggestionIA déjà présent (cas du cycle complet,
// pipeline.ts) : sans correspondance ici, l'entrée d'origine est rendue
// telle quelle.
function avecSuggestions(comptes: CompteACategoriser[], suggestions: SuggestionIA[]): CompteACategoriser[] {
  if (suggestions.length === 0) return comptes;
  const suggestionParCompte = new Map(
    suggestions.filter((s) => s.categorieSuggeree !== null).map((s) => [s.compte, s])
  );
  return comptes.map((c) => {
    const suggestion = suggestionParCompte.get(c.compte);
    return suggestion ? { ...c, suggestionIA: suggestion } : c;
  });
}

interface CategorisationPopupProps extends Omit<CategorisationContenuProps, 'onCountChange'> {
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
  onTraite: (cle: string) => void;
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
      onTraite(cle);
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
      onTraite('comptes_sans_categorie');
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
// Contenu seul, sans l'enveloppe popup — extrait pour être réutilisable
// tel quel comme onglet du popup unique des portes obligatoires (brief
// v58), sans dupliquer la logique de retrait local ni les gestes de
// catégorisation.
export function CategorisationContenu({
  cabinetId,
  dossierId,
  utilisateurId,
  comptes: comptesInitiaux,
  comptesSousCategorieAutoliquidation: comptesSousCategorieInitiaux = [],
  suggestions = [],
  periodeDebut,
  periodeFin,
  onCountChange,
  onLotTermine,
}: CategorisationContenuProps) {
  const [comptes, setComptes] = useState(() => avecSuggestions(comptesInitiaux, suggestions));
  const [comptesSousCategorie, setComptesSousCategorie] = useState(comptesSousCategorieInitiaux);
  // État de chargement explicite (brief v62) — sans lui, confirmer le
  // dernier compte affichait d'abord "Tous les comptes ont été traités."
  // (comptes.length tombe à 0 immédiatement) pendant que ce contrôle ciblé
  // tournait encore en arrière-plan, avant que la nouvelle suggestion ne
  // s'affiche silencieusement. Rien n'incitait alors l'utilisateur à
  // attendre : il pouvait fermer l'onglet en pensant avoir terminé.
  const [verificationSousCategorie, setVerificationSousCategorie] = useState(false);
  // Le debounce du v63 (minuteur depuis la dernière confirmation) ne
  // suffisait pas : une pause de plus de 600ms entre deux validations d'un
  // même lot relançait quand même l'appel en plein milieu (brief v64,
  // point 2, rappel explicite de Rami). Remplacé par un signal de fin de
  // catégorisation : on retient juste qu'au moins UNE confirmation du lot
  // en cours portait sur comptes_charge_service, et on ne déclenche la
  // vérification ciblée que lorsque la liste principale devient vide
  // (tous les comptes de ce lot traités, quel que soit le temps que ça a
  // pris) — jamais sur un minuteur.
  const aConfirmeChargeServiceRef = useRef(false);

  useEffect(() => {
    onCountChange?.(comptes.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comptes.length]);

  // Point 3 ajouté au brief v61 : identifierComptesServiceSansSousCategorieAutoliquidation
  // ne peut légitimement rien proposer tant que comptes_charge_service est
  // vide — dès qu'un compte vient d'y être confirmé, un nouveau candidat à
  // la sous-catégorisation autoliquidation peut donc apparaître. Rejoue un
  // contrôle ciblé (même route que le chargement initial, pas l'agrégateur
  // des 4 portes) pour le détecter tout de suite, sans avoir à fermer et
  // rouvrir tout le popup — cohérent avec le reste de ce brief (une action
  // dans un onglet ne doit affecter que cet onglet).
  async function rafraichirSousCategorie() {
    try {
      const resultat = await fetchComptesACategoriser(cabinetId, dossierId, periodeDebut, periodeFin);
      setComptesSousCategorie(resultat.comptesServiceSansSousCategorieAutoliquidation);
    } catch {
      // Silencieux : la confirmation elle-même a déjà réussi (toast
      // affiché) — un échec de ce contrôle ciblé n'empêche pas de
      // continuer, la porte obligatoire referait ce même contrôle de toute
      // façon au prochain essai de lancement de cycle.
    } finally {
      setVerificationSousCategorie(false);
    }
  }

  function retirer(compte: string, cle: string) {
    if (cle === 'comptes_charge_service') aConfirmeChargeServiceRef.current = true;
    // Filtrage direct sur l'état courant plutôt que la forme fonctionnelle
    // de setComptes : cette fonction n'est appelée que depuis un
    // gestionnaire d'événement (clic), jamais en rafale synchrone, et les
    // effets de bord ci-dessous n'en sont pas plus sûrs dans un updater —
    // le garder hors d'un updater évite un double appel si React
    // l'invoque deux fois pour détecter les impuretés (StrictMode, dev).
    const suivant = comptes.filter((c) => c.compte !== compte);
    setComptes(suivant);
    if (suivant.length === 0) {
      if (onLotTermine) {
        // Popup portes obligatoires (brief v69) : un rechargement complet
        // de l'agrégateur, géré par le parent, remplace entièrement le
        // contrôle ciblé ci-dessous — celui-ci ne rafraîchissait jamais
        // les 3 autres onglets ni les badges, la cause racine identifiée
        // par Rami. Déclenché dès que la liste principale est vide, quelle
        // que soit la catégorie choisie pour le dernier compte (pas
        // seulement comptes_charge_service : les autres onglets peuvent
        // tout autant dépendre du reste de la catégorisation).
        onLotTermine();
      } else if (aConfirmeChargeServiceRef.current) {
        // Usage autonome (CycleZone.tsx, post-cycle) : pas d'agrégateur à
        // recharger ici, seul le contrôle ciblé sur la sous-catégorisation
        // reste pertinent, et seulement si comptes_charge_service a
        // effectivement été touché dans ce lot.
        aConfirmeChargeServiceRef.current = false;
        setVerificationSousCategorie(true);
        void rafraichirSousCategorie();
      }
    }
  }

  function retirerSousCategorie(compte: string) {
    setComptesSousCategorie((prev) => prev.filter((c) => c.compte !== compte));
  }

  return (
    <>
      <p className="reference">
        Ces comptes produit/charge ont bougé sur la période mais ne sont dans aucune des 9 conventions. Les
        comptes non traités réapparaîtront au prochain cycle.
      </p>
      {comptes.length === 0 ? (
        verificationSousCategorie ? (
          // Même classe que le rappel location/crédit-bail (brief v54) —
          // le simple "empty" du v62 passait trop inaperçu, gras en plus
          // pour renforcer la mise en évidence (brief v63).
          <p className="avertissement">
            <strong>Vérification des sous-catégories…</strong>
          </p>
        ) : (
          <p className="empty">Tous les comptes ont été traités.</p>
        )
      ) : (
        <ul className="card-list">
          {comptes.map((c) => (
            <CompteCard
              key={c.compte}
              compte={c}
              cabinetId={cabinetId}
              dossierId={dossierId}
              utilisateurId={utilisateurId}
              onTraite={(cle) => retirer(c.compte, cle)}
            />
          ))}
        </ul>
      )}
      {verificationSousCategorie && comptes.length > 0 && (
        <p className="avertissement">
          <strong>Vérification des sous-catégories…</strong>
        </p>
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
    </>
  );
}

export function CategorisationPopup(props: CategorisationPopupProps) {
  const { onClose } = props;
  const [count, setCount] = useState(props.comptes.length);

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true" aria-label="Catégorisation des comptes">
      <div className="popup">
        <div className="popup-header">
          <h2>Comptes à catégoriser ({count})</h2>
          <button className="popup-close" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <CategorisationContenu {...props} onCountChange={setCount} />
      </div>
    </div>
  );
}
