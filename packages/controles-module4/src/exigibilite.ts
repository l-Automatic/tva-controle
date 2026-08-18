import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// Convention par compte de PRODUIT/CHARGE, propre à chaque dossier — aucun
// défaut national ne fait sens ici (contrairement au taux de TVA) : c'est le
// cabinet qui décide comment il subdivise ses comptes 604/706/etc. entre
// "bien" et "service". Doit venir de conventions_dossier à terme.
export interface ConfigExigibiliteTva {
  comptesVenteService: string[]; // ex: ['706', '704'] — côté collecte
  comptesChargeService: string[]; // ex: ['611'] — côté déductible
  // Comptes systématiquement payés au comptant (péages, restaurants, frais
  // postaux, frais bancaires...) — demande de Rami (10/08) : pour ces
  // comptes, ne JAMAIS regarder le lettrage, même si c'est un service. Le
  // paiement étant simultané à la facturation par nature de la dépense, le
  // lettrage n'a rien à apporter et peut même induire une exclusion à tort
  // (ex: une pièce mal lettrée dans Pennylane alors que payée en réalité).
  comptesPaiementComptant?: string[];
}

export type NatureOperation = 'bien' | 'service' | 'indetermine';

export interface StatutExigibilite {
  ledgerEntryId: number;
  compte: string; // compte TVA (445711, 44566...)
  natureOperation: NatureOperation;
  // Ce que Module 7 doit savoir : peut-on inclure cette ligne dans le calcul
  // de la période en cours ? false = service non encore encaissé/payé, à
  // exclure (ce n'est pas une erreur, c'est l'état normal d'une facture
  // impayée — d'où la séparation d'avec les anomalies).
  exigible: boolean;
  motif: string;
}

const PREFIXE_COLLECTE = '44571';
const PREFIXES_DEDUCTIBLE = ['44566', '44562'];

function estCompteService(compte: string, comptesService: string[]): boolean {
  return comptesService.some((prefixe) => compte.startsWith(prefixe));
}

export function determinerExigibiliteTva(
  ecritures: EcritureTvaComplete[],
  config: ConfigExigibiliteTva
): { statuts: StatutExigibilite[]; anomalies: Anomalie[] } {
  const statuts: StatutExigibilite[] = [];
  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId, libelle } = ecriture.ligneTva;
    const estCollecte = compte.startsWith(PREFIXE_COLLECTE);
    const estDeductible = PREFIXES_DEDUCTIBLE.some((p) => compte.startsWith(p));

    // Comptes d'autoliquidation (4454/445664...) : logique d'exigibilité
    // différente (liée à l'achat lui-même, pas à un encaissement client) —
    // hors scope de ce contrôle, couverte par verifierAutoliquidationEquilibree.
    if (!estCollecte && !estDeductible) continue;

    // Comptes "toujours payé comptant" (10/08) : court-circuite tout le
    // reste de la logique, y compris la détection bien/service — le
    // lettrage n'a rien à apporter ici, ne jamais l'examiner.
    const estPaiementComptant = ecriture.autresLignes.some((l) =>
      (config.comptesPaiementComptant ?? []).some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (estPaiementComptant) {
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'service',
        exigible: true,
        motif: 'Compte systématiquement payé au comptant (frais de déplacement, postaux, bancaires...) : exigible sans vérification de lettrage.',
      });
      continue;
    }

    const comptesServiceApplicables = estCollecte ? config.comptesVenteService : config.comptesChargeService;

    if (ecriture.autresLignes.length === 0) {
      anomalies.push({
        type: 'nature_operation_indeterminee',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description: 'Aucune ligne produit/charge trouvée sur la pièce : nature bien/service non déterminable.',
        details: { libelle },
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'indetermine',
        exigible: true,
        motif: 'Nature indéterminée : exigibilité supposée par défaut (facturation), à vérifier manuellement.',
      });
      continue;
    }

    const natures = new Set(
      ecriture.autresLignes.map((l) => (estCompteService(l.compte, comptesServiceApplicables) ? 'service' : 'bien'))
    );

    if (natures.size > 1) {
      anomalies.push({
        type: 'nature_operation_mixte',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description:
          'Pièce mêlant des lignes de nature bien et service : exigibilité à vérifier ligne par ligne, non calculée automatiquement.',
        details: { libelle },
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'indetermine',
        exigible: true,
        motif: 'Nature mixte : à vérifier manuellement.',
      });
      continue;
    }

    const nature = [...natures][0] as 'bien' | 'service';

    if (nature === 'bien') {
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'bien',
        exigible: true,
        motif: 'Bien : TVA exigible dès facturation, lettrage sans incidence.',
      });
      continue;
    }

    // Service : l'exigibilité dépend du lettrage de la ligne tiers, pas de la ligne TVA.
    if (ecriture.lignesTiers.length === 0) {
      anomalies.push({
        type: 'ligne_tiers_introuvable',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description:
          'Prestation de service sans ligne tiers identifiée sur la pièce : exigibilité (TVA sur encaissement) non vérifiable.',
        details: { libelle },
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'service',
        exigible: true,
        motif: 'Ligne tiers introuvable : exigibilité supposée par défaut, à vérifier.',
      });
      continue;
    }

    const ligneTiers = ecriture.lignesTiers[0]!;
    const exigible = ligneTiers.lettrage.estLettree;

    // Plus de 2 id dans le groupe de lettrage = possible paiement partiel ou
    // rapprochement multi-factures. On ne calcule PAS le prorata ici : ça
    // demanderait les montants des autres lignes du groupe (pas encore
    // récupérés par le connecteur) — signalé pour calcul extracomptable
    // manuel, comme convenu.
    if (ligneTiers.lettrage.groupeIds.length > 2) {
      anomalies.push({
        type: 'paiement_partiel_a_verifier',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description: `Compte tiers ${ligneTiers.compte} : ce règlement est rapproché avec ${ligneTiers.lettrage.groupeIds.length} autres pièces à la fois (pas juste une facture et son paiement). Signe possible d'un paiement partiel dont le montant exigible n'est pas calculé automatiquement ici : à vérifier manuellement dans Pennylane.`,
        details: { compteTiers: ligneTiers.compte, groupeIds: ligneTiers.lettrage.groupeIds, libelle },
      });
    }

    statuts.push({
      ledgerEntryId,
      compte,
      natureOperation: 'service',
      exigible,
      motif: exigible
        ? 'Service : ligne tiers lettrée -> TVA exigible (encaissée/payée).'
        : 'Service : ligne tiers non lettrée -> TVA pas encore exigible, à exclure du calcul de la période.',
    });
  }

  return { statuts, anomalies };
}
