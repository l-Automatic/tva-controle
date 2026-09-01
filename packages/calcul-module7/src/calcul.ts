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
  // Ajoutés le 08/08 : sans ça, une écriture exclue n'était identifiable
  // que par un ledgerEntryId Pennylane brut et le compte TVA (445711...) —
  // jamais le compte client/fournisseur réellement concerné ni une date,
  // impossible à retrouver dans le grand livre sans ça.
  compteTiers?: string | undefined;
  date?: string | undefined;
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
  // TVA intracom (10/08) — deuxième paire d'autoliquidation, réutilise les
  // mêmes catégories 'autoliquidation_due'/'autoliquidation_deductible'
  // que le BTP (les deux s'annulent identiquement dans le calcul final,
  // pas besoin de catégories séparées) — seule la reconnaissance du compte
  // change.
  compteAutoliquidationDueIntracom?: string;
  compteAutoliquidationDeductibleIntracom?: string;
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
  // Cadeaux clients : conditionné au seuil de 73€ HT — sous ou égal, TVA
  // déductible normalement ; au-delà, 0% déductible. Appliqué par ligne
  // (pas cumulé par bénéficiaire/an, donnée non disponible à ce niveau) —
  // correction du 09/08, la première version excluait à tort 100% du
  // compte sans condition de montant.
  comptesCadeaux?: string[];
}

const TAUX_NATIONAL_PAR_DEFAUT: Record<string, number> = {
  '445711': 20,
  '445712': 10,
  '445713': 5.5,
  '445714': 2.1,
};

const SEUIL_CADEAUX_TTC = 73;

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
  // 10/08 — changement de fond décidé avec Rami : une anomalie bloquante ne
  // bloque plus le calcul lui-même, seulement sa VALIDATION (cf.
  // validerCalcul, orchestrateur-module9). Ce contrôle refusait jusqu'ici
  // de calculer quoi que ce soit dès qu'une anomalie bloquante existait —
  // second niveau de blocage indépendant de celui de pipeline.ts, découvert
  // en retirant le premier. Retiré pour la même raison : produire un
  // brouillon dès le premier cycle, même incomplet sur un point précis,
  // plutôt que de ne rien produire du tout.

  const politique = config.politiqueIndetermine ?? 'exclure';
  const compteDue = config.compteAutoliquidationDue ?? '4454';
  const compteDeductible = config.compteAutoliquidationDeductible ?? '445664';
  const compteDueIntracom = config.compteAutoliquidationDueIntracom;
  const compteDeductibleIntracom = config.compteAutoliquidationDeductibleIntracom;
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
    const { compte, ledgerEntryId, debit, credit, date } = ecriture.ligneTva;
    const compteTiers = ecriture.lignesTiers[0]?.compte;
    // Deux nets signés, un par sens normal de compte. PAS de Math.abs()
    // unique en amont : un avoir (qui inverse le sens habituel d'un compte)
    // doit RETRANCHER du total de sa catégorie, pas s'y additionner. Prendre
    // la valeur absolue avant d'accumuler détruisait cette information de
    // signe — bug réel trouvé le 02/08 en conditions réelles (avoirs
    // comptés comme des ventes normales au lieu de les compenser).
    //   - netSensCredit : sens normal des comptes à sens crédit (TVA
    //     collectée, TVA due en autoliquidation) — une vente crédite, un
    //     avoir débite et doit donc réduire le total.
    //   - netSensDebit : sens normal des comptes à sens débit (TVA
    //     déductible, TVA déductible en autoliquidation) — un achat débite,
    //     un avoir reçu du fournisseur crédite et doit réduire le total.
    const netSensCredit = credit - debit;
    const netSensDebit = debit - credit;
    const cle = `${ledgerEntryId}:${compte}`;

    // --- Autoliquidation : hors bucketing par taux, hors question d'exigibilité ---
    // Le montant porté sur ces comptes est le TTC-équivalent de la
    // prestation (ce que le fournisseur étranger a facturé, sans TVA
    // française dessus), pas la TVA elle-même — contrairement à une lecture
    // naïve du compte. Il faut donc en extraire la TVA au taux applicable,
    // exactement comme pour une régularisation d'encaissement (cf.
    // integrerRegularisations) : montant - montant/(1+taux/100). La formule
    // est linéaire, donc s'applique correctement même à un net négatif
    // (régularisation) sans traitement particulier.
    if (compte === compteDue || compte === compteDueIntracom) {
      const tva = netSensCredit - netSensCredit / (1 + tauxAutoliquidation / 100);
      ajouter('autoliquidation_due', tva, ledgerEntryId);
      continue;
    }
    if (compte === compteDeductible || compte === compteDeductibleIntracom) {
      const tva = netSensDebit - netSensDebit / (1 + tauxAutoliquidation / 100);
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

    let montantSigne = estCollecte ? netSensCredit : netSensDebit;

    // --- Exigibilité (bien/service, TVA sur encaissement) ---
    const statutExig = exigibiliteParPiece.get(cle);
    if (statutExig && !statutExig.exigible) {
      exclues.push({ ledgerEntryId, compte, motif: statutExig.motif, compteTiers, date });
      continue;
    }
    // Paiement partiel authentique (10/08) : le montant réellement exigible
    // cette période n'est qu'une fraction du montant de la ligne — ajuste
    // AVANT toute catégorisation par taux, le reste de la logique
    // s'applique ensuite normalement sur le montant réduit.
    if (statutExig?.prorataExigible !== undefined) {
      montantSigne = montantSigne * statutExig.prorataExigible;
    }
    // Absence de statut = pas concerné par le contrôle d'exigibilité pour cette
    // ligne (ex: compte hors config comptesVenteService/comptesChargeService) ->
    // traité comme exigible par défaut (comportement historique, avant ce contrôle).

    // --- Cadeaux clients : 0% déductible au-delà de 73€ TTC, normal en dessous ---
    // Bug réel corrigé le 10/08 : comparait le HT au seuil, alors que la
    // règle officielle est 73€ TTC (confirmé deux fois indépendamment par
    // Rami, dont une reprise de notes du tout début du projet).
    if (!estCollecte && config.comptesCadeaux?.length) {
      const ligneCadeau = ecriture.autresLignes.find((l) =>
        config.comptesCadeaux!.some((prefixe) => l.compte.startsWith(prefixe))
      );
      if (ligneCadeau) {
        const montantHtCadeau = Math.abs(ligneCadeau.debit - ligneCadeau.credit);
        const montantTvaCadeau = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
        const montantTtcCadeau = montantHtCadeau + montantTvaCadeau;
        if (montantTtcCadeau > SEUIL_CADEAUX_TTC) {
          exclues.push({
            ledgerEntryId,
            compte,
            motif: `Cadeau client de ${montantTtcCadeau.toFixed(2)}€ TTC, au-delà du seuil de ${SEUIL_CADEAUX_TTC}€ TTC : 0% déductible.`,
            compteTiers,
            date,
          });
          continue;
        }
        // Sous le seuil : déductible normalement, on continue le traitement standard.
      }
    }

    // --- Carburant : peut réduire le montant déductible, ou l'exclure si indéterminé ---
    const statutCarb = carburantParPiece.get(cle);
    let montantAjuste = montantSigne;
    if (statutCarb) {
      if (statutCarb.tauxDeductible === null) {
        if (politique === 'exclure') {
          exclues.push({
            ledgerEntryId,
            compte,
            motif: `Carburant, taux déductible indéterminé : ${statutCarb.motif}`,
            compteTiers,
            date,
          });
          continue;
        }
        // politique 'inclure' : on inclut au montant plein, à charge du
        // collaborateur de corriger après coup si l'anomalie est confirmée.
      } else {
        montantAjuste = montantSigne * (statutCarb.tauxDeductible / 100);
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
          compteTiers,
          date,
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
