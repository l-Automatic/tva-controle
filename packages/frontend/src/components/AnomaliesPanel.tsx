import { useEffect, useState } from 'react';
import { CheckCheck, RefreshCw } from 'lucide-react';
import {
  ApiError,
  fetchAnomalies,
  justifierAnomalie,
  qualifierEncaissement,
  resoudreAnomalie,
  resoudreAnomaliesEnMasse,
} from '../api';
import { ICONE_ACTION, iconeTypeAnomalie } from '../icons';
import { useToast } from '../toast';
import type { Anomalie, GraviteAnomalie, StatutAnomalie } from '../types';
import { Accordion } from './Accordion';
import { BadgeStatut } from './BadgeStatut';

// 16 des 20 types du catalogue ont un libellé dédié ici — cf.
// CATALOGUE_ANOMALIES.md ; les 4 restants (immobilisation_vehicule_tourisme_a_verifier,
// incoherence_taux_autoliquidation, immobilisation_sur_compte_tva_incorrect,
// autoliquidation_incomplete) retombent sur le type brut en repli, hors
// périmètre de ce brief (v12 ne demandait que les 4 ci-dessous).
const LIBELLE_TYPE_ANOMALIE: Record<string, string> = {
  compte_tva_non_reconnu: 'Compte de TVA non reconnu',
  encaissement_non_affecte: 'Encaissement non affecté',
  nature_operation_indeterminee: "Nature de l'opération indéterminée",
  nature_operation_mixte: "Nature de l'opération mixte",
  ligne_tiers_introuvable: 'Ligne tiers introuvable',
  paiement_partiel_a_verifier: 'Paiement partiel à vérifier',
  avoir_a_verifier: 'Avoir à vérifier',
  parc_vehicules_non_renseigne: 'Parc de véhicules non renseigné',
  flotte_mixte_carburant: 'Flotte mixte (carburant)',
  immobilisation_potentielle_non_passee: 'Immobilisation potentielle non passée',
  nouveau_tiers_a_verifier: 'Nouveau tiers à vérifier',
  encaissement_client_taux_applique: 'Encaissement client — taux appliqué',
  tva_hotel_a_verifier: 'TVA hôtel à vérifier',
  tva_hotel_a_tort: 'TVA hôtel déduite à tort',
  trou_numerotation_facture: 'Trou dans la numérotation des factures',
  paiement_partiel_calcule: 'Paiement partiel — prorata calculé',
  doublon_numerotation_facture: 'Doublon de numérotation de facture',
};

interface AnomaliesPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  // 'cycle' : anomalies d'une période précise (vue fusionnée du cycle en
  // cours), sans filtres avancés. 'historique' (défaut) : toutes périodes,
  // filtrables par type et statut — cf. brief refonte, zones Cycle/Historique.
  variant?: 'cycle' | 'historique';
  periode?: string | null;
  // Optionnel : incrémenté par le parent pour forcer un rechargement après
  // un nouveau cycle (brief v14) — sans lui, relancer un cycle sur EXACTEMENT
  // la même période ne change pas la valeur de `periode` (une simple
  // chaîne), donc l'effet ci-dessous ne se redéclenche pas et les nouvelles
  // anomalies persistées entre les deux cycles restent invisibles jusqu'à
  // un clic manuel sur "Rafraîchir". Même pattern que PropositionsPanel.
  refreshKey?: number;
}

const LIBELLE_STATUT: Record<StatutAnomalie, string> = {
  ouvert: 'Ouverte',
  resolu: 'Résolue',
  justifie: 'Justifiée',
};

const LIBELLE_GRAVITE: Record<GraviteAnomalie, string> = {
  bloquant: 'Bloquant',
  signale: 'Signalé',
  info: 'Info',
};

const TAUX_TVA = ['20', '10', '5.5', '2.1'];

function detailsMontant(details: unknown): { montantTTC: number | null; date: string | null } {
  if (!details || typeof details !== 'object') return { montantTTC: null, date: null };
  const d = details as Record<string, unknown>;
  return {
    montantTTC: typeof d.montantTTC === 'number' ? d.montantTTC : null,
    date: typeof d.date === 'string' ? d.date : null,
  };
}

// Le libellé de la pièce (quand Pennylane le renseigne) est bien plus
// exploitable que l'ID technique pour retrouver une écriture — devient la
// référence principale affichée (cf. brief v5). `exemplesLibelle` regroupe
// plusieurs écritures (ex : compte_tva_non_reconnu) ; `libelle` est
// singulier sur les autres types. Jamais les deux à la fois.
function libellesDePiece(details: unknown): string[] {
  if (!details || typeof details !== 'object') return [];
  const d = details as Record<string, unknown>;
  if (Array.isArray(d.exemplesLibelle)) {
    return d.exemplesLibelle.filter((l): l is string => typeof l === 'string');
  }
  return typeof d.libelle === 'string' ? [d.libelle] : [];
}

// Champs déjà affichés séparément (libellé(s), montant, date) — le reste
// (ex : tauxImplicite/tauxAttendu, nbEcritures/references) garde un intérêt
// de vérification, affiché en JSON compact plutôt que perdu.
const CLES_DEJA_AFFICHEES = new Set(['libelle', 'exemplesLibelle', 'montantTTC', 'date']);

function detailsResiduels(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  // Cas concret : anomalies de groupe de lettrage (paiement_partiel_a_verifier)
  // — le compte tiers (411/401) et les autres pièces du groupe sont la seule
  // info qui permette d'aller vérifier manuellement dans Pennylane ; le champ
  // `compte` de l'anomalie est le compte TVA, pas le compte tiers, d'où le
  // besoin de l'afficher séparément plutôt que de laisser croire que
  // "Compte : 445711" est le compte client/fournisseur concerné.
  if (Array.isArray(d.groupeIds)) {
    const compteTiers = typeof d.compteTiers === 'string' ? `Compte tiers : ${d.compteTiers} — ` : '';
    return `${compteTiers}Autres pièces du même groupe de lettrage : ${d.groupeIds.join(', ')}`;
  }
  const clesRestantes = Object.keys(d).filter((k) => !CLES_DEJA_AFFICHEES.has(k));
  if (clesRestantes.length === 0) return null;
  const reste = Object.fromEntries(clesRestantes.map((k) => [k, d[k]]));
  return JSON.stringify(reste, null, 2);
}

// Qualification structurée d'un encaissement non affecté (compte d'attente
// 471) : "lié à une vente" (taux requis) ou "sans lien avec une vente"
// (motif requis) — remplace Résoudre/Justifier pour ce type d'anomalie
// précisément, cf. controles-module4/encaissementNonAffecte.ts.
function EncaissementQualification({
  anomalie,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  anomalie: Anomalie;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [decision, setDecision] = useState<'vente' | 'hors_vente' | null>(null);
  const [taux, setTaux] = useState('');
  const [motif, setMotif] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflit, setConflit] = useState(false);
  const notifier = useToast();

  async function handleConfirmerVente() {
    if (!taux) {
      setError('Sélectionnez un taux de TVA');
      return;
    }
    setSubmitting(true);
    setError(null);
    setConflit(false);
    try {
      await qualifierEncaissement(cabinetId, anomalie.id, utilisateurId, {
        decision: 'vente',
        taux: Number.parseFloat(taux),
      });
      notifier('Encaissement qualifié');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflit(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec de la qualification');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmerHorsVente() {
    if (!motif.trim()) {
      setError('Un motif est requis pour qualifier « sans lien avec une vente »');
      return;
    }
    setSubmitting(true);
    setError(null);
    setConflit(false);
    try {
      await qualifierEncaissement(cabinetId, anomalie.id, utilisateurId, {
        decision: 'hors_vente',
        motif: motif.trim(),
      });
      notifier('Encaissement qualifié');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflit(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Échec de la qualification');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {decision === null && (
        <div className="actions">
          <button onClick={() => setDecision('vente')} disabled={submitting}>
            <ICONE_ACTION.qualifier size={14} aria-hidden="true" />
            Lié à une vente
          </button>
          <button onClick={() => setDecision('hors_vente')} className="secondary" disabled={submitting}>
            Sans lien avec une vente
          </button>
        </div>
      )}

      {decision === 'vente' && (
        <div className="actions">
          <select value={taux} onChange={(e) => setTaux(e.target.value)} disabled={submitting}>
            <option value="">Taux de TVA…</option>
            {TAUX_TVA.map((t) => (
              <option key={t} value={t}>
                {t.replace('.', ',')} %
              </option>
            ))}
          </select>
          <button onClick={() => void handleConfirmerVente()} disabled={submitting}>
            <ICONE_ACTION.confirmer size={14} aria-hidden="true" />
            {submitting ? '…' : 'Confirmer'}
          </button>
          <button onClick={() => setDecision(null)} className="secondary" disabled={submitting}>
            Annuler
          </button>
        </div>
      )}

      {decision === 'hors_vente' && (
        <div className="actions">
          <input
            type="text"
            placeholder="Motif (requis)"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            disabled={submitting}
          />
          <button onClick={() => void handleConfirmerHorsVente()} disabled={submitting}>
            <ICONE_ACTION.confirmer size={14} aria-hidden="true" />
            {submitting ? '…' : 'Confirmer'}
          </button>
          <button onClick={() => setDecision(null)} className="secondary" disabled={submitting}>
            Annuler
          </button>
        </div>
      )}
      {error && <p className={conflit ? 'error error-409' : 'error'}>{error}</p>}
    </>
  );
}

function AnomalieRow({
  anomalie,
  cabinetId,
  utilisateurId,
  onChanged,
}: {
  anomalie: Anomalie;
  cabinetId: string;
  utilisateurId: string;
  onChanged: () => void;
}) {
  const [commentaire, setCommentaire] = useState('');
  const [submitting, setSubmitting] = useState<'resoudre' | 'justifier' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleResoudre() {
    setSubmitting('resoudre');
    setError(null);
    try {
      await resoudreAnomalie(cabinetId, anomalie.id, utilisateurId, commentaire || undefined);
      notifier('Anomalie résolue');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la résolution');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleJustifier() {
    if (!commentaire.trim()) {
      setError('Un commentaire est requis pour justifier une anomalie');
      return;
    }
    setSubmitting('justifier');
    setError(null);
    try {
      await justifierAnomalie(cabinetId, anomalie.id, utilisateurId, commentaire);
      notifier('Anomalie justifiée');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la justification');
    } finally {
      setSubmitting(null);
    }
  }

  const estOuverte = anomalie.statut === 'ouvert';
  const estEncaissement = anomalie.typeAnomalie === 'encaissement_non_affecte';
  const detailsRestants = detailsResiduels(anomalie.details);
  const { montantTTC, date } = detailsMontant(anomalie.details);
  const libelles = libellesDePiece(anomalie.details);

  return (
    <li className={`card anomalie gravite-${anomalie.gravite}`}>
      <Accordion
        defaultOpen={estOuverte}
        titre={
          <span className="card-header">
            <BadgeStatut statut={anomalie.statut} libelle={LIBELLE_STATUT[anomalie.statut]} />
            <span className={`badge gravite-badge-${anomalie.gravite}`}>{LIBELLE_GRAVITE[anomalie.gravite]}</span>
            <span className="type-anomalie">
              {(() => {
                const Icone = iconeTypeAnomalie(anomalie.typeAnomalie);
                return <Icone size={13} aria-hidden="true" />;
              })()}
              {LIBELLE_TYPE_ANOMALIE[anomalie.typeAnomalie] ?? anomalie.typeAnomalie}
            </span>
          </span>
        }
        meta={<span className="periode">{anomalie.periode}</span>}
      >
        <p className="description">{anomalie.description}</p>
        {estEncaissement && montantTTC !== null && (
          <p className="label">
            Montant TTC : <strong>{montantTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</strong>
          </p>
        )}

        {/* Le libellé de la pièce est la référence principale — l'ID technique
            Pennylane passe en information secondaire (cf. brief v5). */}
        {libelles.length > 0 ? (
          <>
            {libelles.length === 1 ? (
              <p className="label piece-libelle">{libelles[0]}</p>
            ) : (
              <ul className="piece-libelles-liste">
                {libelles.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            <p className="reference piece-technique">
              (pièce {anomalie.referencePiece ?? '—'}
              {date ? ` — ${date}` : ''})
            </p>
          </>
        ) : (
          <p className="reference">
            {date ? `${date} — ` : ''}
            {anomalie.referencePiece ? `Pièce : ${anomalie.referencePiece}` : 'Pièce inconnue'}
          </p>
        )}

        {anomalie.compte && <p className="reference">Compte : {anomalie.compte}</p>}
        {detailsRestants && <p className="reference details">{detailsRestants}</p>}

        {estOuverte &&
          (estEncaissement ? (
            <EncaissementQualification
              anomalie={anomalie}
              cabinetId={cabinetId}
              utilisateurId={utilisateurId}
              onChanged={onChanged}
            />
          ) : (
            <div className="actions">
              <input
                type="text"
                placeholder="Commentaire (requis pour justifier)"
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                disabled={submitting !== null}
              />
              <button onClick={handleResoudre} disabled={submitting !== null}>
                <ICONE_ACTION.resoudre size={14} aria-hidden="true" />
                {submitting === 'resoudre' ? '…' : 'Résoudre'}
              </button>
              <button onClick={handleJustifier} disabled={submitting !== null} className="secondary">
                <ICONE_ACTION.justifier size={14} aria-hidden="true" />
                {submitting === 'justifier' ? '…' : 'Justifier'}
              </button>
            </div>
          ))}
        {estOuverte && !estEncaissement && error && <p className="error">{error}</p>}
      </Accordion>
    </li>
  );
}

const TOUS_STATUTS = 'tous';
const TOUS_TYPES = 'tous';

function ResolutionMasse({
  cabinetId,
  utilisateurId,
  anomalieIds,
  onResolues,
}: {
  cabinetId: string;
  utilisateurId: string;
  anomalieIds: string[];
  onResolues: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [commentaire, setCommentaire] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function handleConfirmer() {
    if (!commentaire.trim()) {
      setError('Un commentaire est requis pour une résolution groupée');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { nombreResolues } = await resoudreAnomaliesEnMasse(cabinetId, anomalieIds, utilisateurId, commentaire.trim());
      notifier(`${nombreResolues} anomalie(s) résolue(s)`);
      setOuvert(false);
      setCommentaire('');
      onResolues();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la résolution groupée');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ouvert) {
    return (
      <button onClick={() => setOuvert(true)} disabled={anomalieIds.length === 0}>
        <CheckCheck size={14} aria-hidden="true" />
        Tout résoudre ({anomalieIds.length})
      </button>
    );
  }

  return (
    <div className="actions">
      <input
        type="text"
        placeholder="Commentaire (requis, partagé pour tout le lot)"
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        disabled={submitting}
      />
      <button onClick={() => void handleConfirmer()} disabled={submitting}>
        {submitting ? '…' : `Résoudre les ${anomalieIds.length} anomalies`}
      </button>
      <button className="secondary" onClick={() => setOuvert(false)} disabled={submitting}>
        Annuler
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function AnomaliesPanel({
  cabinetId,
  dossierId,
  utilisateurId,
  variant = 'historique',
  periode = null,
  refreshKey,
}: AnomaliesPanelProps) {
  const [anomalies, setAnomalies] = useState<Anomalie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [afficherTraitees, setAfficherTraitees] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState<typeof TOUS_STATUTS | StatutAnomalie>(TOUS_STATUTS);
  const [filtreType, setFiltreType] = useState(TOUS_TYPES);

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAnomalies(cabinetId, dossierId, periode ? { periode } : {});
      setAnomalies(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les anomalies');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId, periode, refreshKey]);

  const visibles = (
    variant === 'cycle'
      ? afficherTraitees
        ? anomalies
        : anomalies.filter((a) => a.statut === 'ouvert')
      : anomalies
          .filter((a) => filtreStatut === TOUS_STATUTS || a.statut === filtreStatut)
          .filter((a) => filtreType === TOUS_TYPES || a.typeAnomalie === filtreType)
  );
  const nbOuvertes = anomalies.filter((a) => a.statut === 'ouvert').length;
  const idsOuvertesVisibles = visibles.filter((a) => a.statut === 'ouvert').map((a) => a.id);

  return (
    <section className={variant === 'cycle' ? 'panel-section' : 'panel panel-full'}>
      <div className="panel-header">
        <h2>
          {variant === 'cycle' ? 'Anomalies de la période' : 'Anomalies'} ({nbOuvertes} ouverte
          {nbOuvertes === 1 ? '' : 's'})
        </h2>
        {variant === 'cycle' ? (
          <label className="toggle">
            <input
              type="checkbox"
              checked={afficherTraitees}
              onChange={(e) => setAfficherTraitees(e.target.checked)}
            />
            Afficher les anomalies traitées
          </label>
        ) : (
          <>
            <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value as StatutAnomalie)}>
              <option value={TOUS_STATUTS}>Tous les statuts</option>
              <option value="ouvert">Ouvertes</option>
              <option value="resolu">Résolues</option>
              <option value="justifie">Justifiées</option>
            </select>
            <select value={filtreType} onChange={(e) => setFiltreType(e.target.value)}>
              <option value={TOUS_TYPES}>Tous les types</option>
              {Object.entries(LIBELLE_TYPE_ANOMALIE).map(([type, libelle]) => (
                <option key={type} value={type}>
                  {libelle}
                </option>
              ))}
            </select>
            {filtreType !== TOUS_TYPES && (
              <ResolutionMasse
                cabinetId={cabinetId}
                utilisateurId={utilisateurId}
                anomalieIds={idsOuvertesVisibles}
                onResolues={() => void charger()}
              />
            )}
          </>
        )}
        <button onClick={() => void charger()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" />
          {loading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!loading && visibles.length === 0 && (
        <p className="empty">
          {variant === 'cycle' ? 'Aucune anomalie pour cette période.' : 'Aucune anomalie à afficher.'}
        </p>
      )}
      <ul className="card-list">
        {visibles.map((a) => (
          <AnomalieRow
            key={a.id}
            anomalie={a}
            cabinetId={cabinetId}
            utilisateurId={utilisateurId}
            onChanged={() => void charger()}
          />
        ))}
      </ul>
    </section>
  );
}
