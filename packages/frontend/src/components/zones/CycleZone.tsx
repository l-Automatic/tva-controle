import { useEffect, useState } from 'react';
import { fetchCalculs } from '../../api';
import { toDateOnly } from '../../dateUtils';
import { AnomaliesPanel } from '../AnomaliesPanel';
import { CalculRow, formatMontant } from '../CalculsPanel';
import { CategorisationPopup } from '../CategorisationPopup';
import { CycleForm } from '../CycleForm';
import type {
  Anomalie,
  Calcul,
  CompteACategoriser,
  CompteClientSansTauxAssigne,
  CompteSansTauxAssigne,
  LigneCalcul,
  ProrataApplique,
} from '../../types';

interface CycleZoneProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  periode: { debut: string; fin: string } | null;
  onPeriodeChange: (periode: { debut: string; fin: string } | null) => void;
  onSuggestionsTaux: (comptes: CompteSansTauxAssigne[], clients: CompteClientSansTauxAssigne[]) => void;
  onSuggestionsAutoliquidation: (comptes: CompteACategoriser[]) => void;
  onCompteNonReconnuClic?: (anomalie: Anomalie) => void;
  onParcVehiculesManquant?: () => void;
}

// Paiements partiels réellement appliqués côté ventes (brief v35) —
// remplace l'ancienne anomalie paiement_partiel_calcule, jamais dans le
// panneau Anomalies. Le montant TVA exigible n'est isolable que quand la
// ligne de calcul agrégée (par catégorie de taux) ne regroupe QUE cette
// pièce (referencesPieces d'une seule entrée) : au-delà, calculerTva ne
// distingue plus la contribution de chaque pièce dans le total — mieux
// vaut l'indiquer explicitement que d'afficher un montant qui mélangerait
// plusieurs pièces sans le dire.
interface DetailProrataCollecte {
  ledgerEntryId: number;
  compte: string;
  compteTiers: string;
  prorataPourcent: number;
  montantExigible: number | null;
  montantExclu: number | null;
}

function calculerDetailsProrataCollecte(prorataAppliques: ProrataApplique[], lignes: LigneCalcul[]): DetailProrataCollecte[] {
  return prorataAppliques
    .filter((p) => p.sens === 'collecte')
    .map((p) => {
      const ligne = lignes.find((l) => l.referencesPieces.length === 1 && l.referencesPieces[0] === p.ledgerEntryId);
      const montantExigible = ligne ? ligne.montant : null;
      const montantExclu = ligne && p.prorata > 0 ? (ligne.montant * (1 - p.prorata)) / p.prorata : null;
      return {
        ledgerEntryId: p.ledgerEntryId,
        compte: p.compte,
        compteTiers: p.compteTiers,
        prorataPourcent: Math.round(p.prorata * 100),
        montantExigible,
        montantExclu,
      };
    });
}

function DetailsProrataCollecte({ details }: { details: DetailProrataCollecte[] }) {
  if (details.length === 0) return null;
  return (
    <>
      <div className="panel-separateur" />
      <div className="panel-header">
        <h2>Paiements partiels appliqués</h2>
      </div>
      <ul className="card-list">
        {details.map((d) => (
          <li key={d.ledgerEntryId} className="card">
            <p className="label">
              Compte {d.compte} — client {d.compteTiers} : <strong>{d.prorataPourcent} % exigible</strong>
            </p>
            {d.montantExigible !== null ? (
              <p className="reference">
                TVA exigible : {formatMontant(d.montantExigible)}
                {d.montantExclu !== null && ` — TVA exclue (paiement restant) : ${formatMontant(d.montantExclu)}`}
              </p>
            ) : (
              <p className="reference">
                Montant non isolable — plusieurs pièces agrégées dans la même ligne de calcul.
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
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
            montantEnGrand
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
  onCompteNonReconnuClic,
  onParcVehiculesManquant,
}: CycleZoneProps) {
  const [comptesACategoriser, setComptesACategoriser] = useState<CompteACategoriser[]>([]);
  const [detailsProrataCollecte, setDetailsProrataCollecte] = useState<DetailProrataCollecte[]>([]);
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
    <div className="cycle-zone-layout">
      <section className="panel cycle-zone-main">
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
            setDetailsProrataCollecte(calculerDetailsProrataCollecte(resultat.prorataAppliques, resultat.resultat.lignes));
          }}
          onAjustementChange={() => setCycleRefreshKey((k) => k + 1)}
          onParcVehiculesManquant={onParcVehiculesManquant}
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
              periodeFin={periode.fin}
              refreshKey={cycleRefreshKey}
              onCompteNonReconnuClic={onCompteNonReconnuClic}
              onAnomalieChangee={() => setCycleRefreshKey((k) => k + 1)}
            />
          </>
        )}
      </section>
      {periode && (
        <aside className="panel cycle-zone-calcul">
          <CalculsDuCycle
            cabinetId={cabinetId}
            dossierId={dossierId}
            utilisateurId={utilisateurId}
            periode={periode}
            refreshKey={cycleRefreshKey}
          />
          <DetailsProrataCollecte details={detailsProrataCollecte} />
        </aside>
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
    </div>
  );
}
