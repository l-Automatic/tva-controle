import type { EcritureTvaComplete, Anomalie, ContexteDossier } from '@tva-controle/core';
import { tauxHabituelPour } from '@tva-controle/core';
import type { StatutExigibilite } from '@tva-controle/controles-module4';
import type { StatutCarburant } from '@tva-controle/controles-module4';

export type CategorieLigneCalcul =
  | 'collectee_20'
  | 'collectee_10'
  | 'collectee_5_5'
  | 'collectee_2_1'
  | 'deductible_abs'
  | 'deductible_immo'
  | 'autoliquidation_due'
  | 'autoliquidation_deductible';

export interface LigneCalculTva {
  categorie: CategorieLigneCalcul;
  montant: number;
  referencesPieces: number[];
}

export interface EcritureExclue {
  ledgerEntryId: number;
  compte: string;
  motif: string;
}

export interface ResultatCalculTva {
  lignes: LigneCalculTva[];
  tvaNette: number;
  sens: 'a_decaisser' | 'credit';
  // Traçabilité de tout ce qui a été volontairement écarté du calcul — pas
  // silencieusement ignoré. Sert de preuve en cas de contrôle et de base pour
  // un recalcul une fois les anomalies/indéterminations résolues.
  ecrituresExclues: EcritureExclue[];
}

export interface ConfigCalculTva {
  // Bucketing par taux pour la collecte — même logique de priorité que
  // coherenceTaux : le contexte dossier prime, la table nationale est le repli.
  tauxNominalParCompte?: Record<string, number>;
  contexteDossier?: ContexteDossier;
  compteAutoliquidationDue?: string;
  compteAutoliquidationDeductible?: string;
  // Taux appliqué pour extraire la TVA du montant porté sur les comptes
  // d'autoliquidation (4454/445664...). Défaut 20% : quasi systématique en
  // pratique pour l'autoliquidation générale sur prestations de services
  // intracommunautaires (le cas de loin le plus fréquent), donc un défaut
  // raisonnable plutôt qu'un champ obligatoire à chaque fois — mais
  // configurable, un dossier avec un cas à taux réduit reste possible.
  tauxAutoliquidation?: number;
  // Politique fiscale, pas un fait technique : que faire d'une ligne dont
  // l'exigibilité ou la déductibilité n'a pas pu être déterminée (flotte
  // mixte, nature d'opération ambiguë...). Défaut prudent : exclure plutôt
  // que risquer une collecte/déduction non confirmée — régularisable à la
  // période suivante une fois l'anomalie traitée.
  politiqueIndetermine?: 'inclure' | 'exclure';
}

const TAUX_NATIONAL_PAR_DEFAUT: Record<string, number> = {
  '445711': 20,
  '445712': 10,
  '445713': 5.5,
  '445714': 2.1,
};

const CATEGORIE_PAR_TAUX: Record<number, CategorieLigneCalcul> = {
  20: 'collectee_20',
  10: 'collectee_10',
  5.5: 'collectee_5_5',
  2.1: 'collectee_2_1',
};

export function calculerTva(
  ecritures: EcritureTvaComplete[],
  anomalies: Anomalie[],
  statutsExigibilite: StatutExigibilite[],
  statutsCarburant: StatutCarburant[],
  config: ConfigCalculTva = {}
): ResultatCalculTva {
  const bloquantes = anomalies.filter((a) => a.gravite === 'bloquant');
  if (bloquantes.length > 0) {
    throw new Error(
      `Calcul refusé : ${bloquantes.length} anomalie(s) bloquante(s) non résolue(s) (${bloquantes
        .map((a) => a.type)
        .join(', ')}).`
    );
  }

  const politique = config.politiqueIndetermine ?? 'exclure';
  const compteDue = config.compteAutoliquidationDue ?? '4454';
  const compteDeductible = config.compteAutoliquidationDeductible ?? '445664';
  const tauxAutoliquidation = config.tauxAutoliquidation ?? 20;
  const tauxNominalParCompte = config.tauxNominalParCompte ?? TAUX_NATIONAL_PAR_DEFAUT;

  const exigibiliteParPiece = new Map(statutsExigibilite.map((s) => [`${s.ledgerEntryId}:${s.compte}`, s]));
  const carburantParPiece = new Map(statutsCarburant.map((s) => [`${s.ledgerEntryId}:${s.compte}`, s]));

  const accumulateur = new Map<CategorieLigneCalcul, { montant: number; pieces: Set<number> }>();
  const exclues: EcritureExclue[] = [];

  function ajouter(categorie: CategorieLigneCalcul, montant: number, ledgerEntryId: number): void {
    const entree = accumulateur.get(categorie) ?? { montant: 0, pieces: new Set<number>() };
    entree.montant += montant;
    entree.pieces.add(ledgerEntryId);
    accumulateur.set(categorie, entree);
  }

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId, debit, credit } = ecriture.ligneTva;
    const montantAbsolu = Math.abs(credit - debit);
    const cle = `${ledgerEntryId}:${compte}`;

    // --- Autoliquidation : hors bucketing par taux, hors question d'exigibilité ---
    // Le montant porté sur ces comptes est le TTC-équivalent de la
    // prestation (ce que le fournisseur étranger a facturé, sans TVA
    // française dessus), pas la TVA elle-même — contrairement à une lecture
    // naïve du compte. Il faut donc en extraire la TVA au taux applicable,
    // exactement comme pour une régularisation d'encaissement (cf.
    // integrerRegularisations) : montant - montant/(1+taux/100).
    if (compte === compteDue) {
      const tva = montantAbsolu - montantAbsolu / (1 + tauxAutoliquidation / 100);
      ajouter('autoliquidation_due', tva, ledgerEntryId);
      continue;
    }
    if (compte === compteDeductible) {
      const tva = montantAbsolu - montantAbsolu / (1 + tauxAutoliquidation / 100);
      ajouter('autoliquidation_deductible', tva, ledgerEntryId);
      continue;
    }

    const estCollecte = compte.startsWith('44571');
    const estDeductibleImmo = compte.startsWith('44562');
    const estDeductibleAbs = compte.startsWith('44566');

    if (!estCollecte && !estDeductibleImmo && !estDeductibleAbs) {
      // Compte TVA hors périmètre connu de ce calcul (ex: TVA sur régularisations
      // spécifiques) — ni inclus ni tracé comme exclusion volontaire, car ce
      // n'est pas une décision, c'est un compte non géré par cette v1.
      continue;
    }

    // --- Exigibilité (bien/service, TVA sur encaissement) ---
    const statutExig = exigibiliteParPiece.get(cle);
    if (statutExig && !statutExig.exigible) {
      exclues.push({ ledgerEntryId, compte, motif: statutExig.motif });
      continue;
    }
    // Absence de statut = pas concerné par le contrôle d'exigibilité pour cette
    // ligne (ex: compte hors config comptesVenteService/comptesChargeService) ->
    // traité comme exigible par défaut (comportement historique, avant ce contrôle).

    // --- Carburant : peut réduire le montant déductible, ou l'exclure si indéterminé ---
    const statutCarb = carburantParPiece.get(cle);
    let montantAjuste = montantAbsolu;
    if (statutCarb) {
      if (statutCarb.tauxDeductible === null) {
        if (politique === 'exclure') {
          exclues.push({ ledgerEntryId, compte, motif: `Carburant, taux déductible indéterminé : ${statutCarb.motif}` });
          continue;
        }
        // politique 'inclure' : on inclut au montant plein, à charge du
        // collaborateur de corriger après coup si l'anomalie est confirmée.
      } else {
        montantAjuste = montantAbsolu * (statutCarb.tauxDeductible / 100);
      }
    }

    if (estCollecte) {
      const tauxDossier = config.contexteDossier ? tauxHabituelPour(config.contexteDossier, compte) : null;
      const taux = tauxDossier ?? tauxNominalParCompte[compte];
      const categorie = taux !== undefined ? CATEGORIE_PAR_TAUX[taux] : undefined;
      if (!categorie) {
        exclues.push({
          ledgerEntryId,
          compte,
          motif: `Taux TVA collectée non résolu pour ce compte (ni convention dossier, ni table nationale) — exclu du calcul.`,
        });
        continue;
      }
      ajouter(categorie, montantAjuste, ledgerEntryId);
      continue;
    }

    ajouter(estDeductibleImmo ? 'deductible_immo' : 'deductible_abs', montantAjuste, ledgerEntryId);
  }

  const lignes: LigneCalculTva[] = [...accumulateur.entries()].map(([categorie, { montant, pieces }]) => ({
    categorie,
    montant: arrondir(montant),
    referencesPieces: [...pieces],
  }));

  const collecte = sommeCategories(lignes, ['collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1']);
  const deductible = sommeCategories(lignes, ['deductible_abs', 'deductible_immo']);
  const autoliquidationDue = sommeCategories(lignes, ['autoliquidation_due']);
  const autoliquidationDeductible = sommeCategories(lignes, ['autoliquidation_deductible']);

  // Autoliquidation : due et déductible s'annulent par construction si équilibrées
  // (déjà vérifié par verifierAutoliquidationEquilibree en amont) — mais on les
  // garde en lignes séparées dans la sortie pour la déclaration (CA3), et on ne
  // les mélange dans le net que parce que comptablement elles se neutralisent.
  const tvaNette = arrondir(collecte - deductible + autoliquidationDue - autoliquidationDeductible);

  return {
    lignes,
    tvaNette: Math.abs(tvaNette),
    sens: tvaNette >= 0 ? 'a_decaisser' : 'credit',
    ecrituresExclues: exclues,
  };
}

export function sommeCategories(lignes: LigneCalculTva[], categories: CategorieLigneCalcul[]): number {
  return lignes.filter((l) => categories.includes(l.categorie)).reduce((acc, l) => acc + l.montant, 0);
}

export function arrondir(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

// Encaissement en compte d'attente (471) qualifié manuellement par le
// comptable comme lié à une vente — cf. controles-module4/encaissementNonAffecte
// pour la détection, et le processus de qualification humaine côté API (pas
// de LLM/Module 5 pour trancher automatiquement à ce stade). Le montant reçu
// est TTC ; on en déduit la TVA collectée au taux retenu.
export interface RegularisationEncaissement {
  ledgerEntryId: number;
  montantTTC: number;
  taux: number; // 20, 10, 5.5 ou 2.1 — un des taux nationaux, cf. CATEGORIE_PAR_TAUX
}

// Fonction séparée de calculerTva plutôt qu'un paramètre de plus : ces
// régularisations ne viennent pas des `ecritures` Pennylane (calculerTva
// reste une fonction pure sur ce seul type d'entrée), mais d'une décision
// humaine stockée en base (anomalies.resolution) — une source de données
// fondamentalement différente, assemblée par l'orchestrateur (Module 9).
export function integrerRegularisations(
  resultat: ResultatCalculTva,
  regularisations: RegularisationEncaissement[]
): ResultatCalculTva {
  if (regularisations.length === 0) {
    return resultat;
  }

  const accumulateur = new Map<CategorieLigneCalcul, { montant: number; pieces: Set<number> }>();
  for (const ligne of resultat.lignes) {
    accumulateur.set(ligne.categorie, { montant: ligne.montant, pieces: new Set(ligne.referencesPieces) });
  }

  for (const r of regularisations) {
    const categorie = CATEGORIE_PAR_TAUX[r.taux];
    if (!categorie) {
      throw new Error(
        `Régularisation d'encaissement (pièce ${r.ledgerEntryId}) : taux ${r.taux}% non reconnu ` +
          `(attendu : 20, 10, 5.5 ou 2.1).`
      );
    }
    // TTC -> TVA : montant reçu = HT + TVA = HT * (1 + taux/100).
    const tva = r.montantTTC - r.montantTTC / (1 + r.taux / 100);
    const entree = accumulateur.get(categorie) ?? { montant: 0, pieces: new Set<number>() };
    entree.montant += tva;
    entree.pieces.add(r.ledgerEntryId);
    accumulateur.set(categorie, entree);
  }

  const lignes: LigneCalculTva[] = [...accumulateur.entries()].map(([categorie, { montant, pieces }]) => ({
    categorie,
    montant: arrondir(montant),
    referencesPieces: [...pieces],
  }));

  const collecte = sommeCategories(lignes, ['collectee_20', 'collectee_10', 'collectee_5_5', 'collectee_2_1']);
  const deductible = sommeCategories(lignes, ['deductible_abs', 'deductible_immo']);
  const autoliquidationDue = sommeCategories(lignes, ['autoliquidation_due']);
  const autoliquidationDeductible = sommeCategories(lignes, ['autoliquidation_deductible']);
  const tvaNette = arrondir(collecte - deductible + autoliquidationDue - autoliquidationDeductible);

  return {
    lignes,
    tvaNette: Math.abs(tvaNette),
    sens: tvaNette >= 0 ? 'a_decaisser' : 'credit',
    ecrituresExclues: resultat.ecrituresExclues,
  };
}
