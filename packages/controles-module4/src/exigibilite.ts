import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// Convention par compte de PRODUIT, propre à chaque dossier — aucun défaut
// national ne fait sens ici (contrairement au taux de TVA) : c'est le
// cabinet qui décide comment il subdivise ses comptes 706/etc. entre "bien"
// et "service". Doit venir de conventions_dossier à terme.
export interface ConfigExigibiliteTva {
  comptesVenteService: string[]; // ex: ['706', '704'] — côté collecte uniquement
}

export type NatureOperation = 'bien' | 'service' | 'indetermine';

export interface StatutExigibilite {
  ledgerEntryId: number;
  compte: string; // compte TVA (445711...)
  natureOperation: NatureOperation;
  // Ce que Module 7 doit savoir : peut-on inclure cette ligne dans le calcul
  // de la période en cours ? false = service non encore encaissé, à
  // exclure (ce n'est pas une erreur, c'est l'état normal d'une facture
  // impayée — d'où la séparation d'avec les anomalies).
  exigible: boolean;
  motif: string;
}

const PREFIXE_COLLECTE = '44571';

function estCompteService(compte: string, comptesService: string[]): boolean {
  return comptesService.some((prefixe) => compte.startsWith(prefixe));
}

// Ne traite QUE le côté collecte (TVA sur encaissement pour les ventes de
// service). Le côté déductible n'est plus vérifié ligne à ligne ici depuis
// le 04/08 — décision de Rami : en pratique, quasi toujours un seul taux
// (20%) et peu de fournisseurs de services, donc une correction en bloc sur
// le solde du compte fournisseur en fin de période (cf.
// soldeFournisseurService.ts + calcul-module7.corrigerDeductibleParSolde-
// FournisseurService) est suffisante et bien plus simple que le lettrage
// facture par facture. L'autoliquidation (4454/445664) reste hors de ce
// contrôle, comme avant (logique liée à l'achat lui-même, pas à un
// encaissement/décaissement).
export function determinerExigibiliteTva(
  ecritures: EcritureTvaComplete[],
  config: ConfigExigibiliteTva
): { statuts: StatutExigibilite[]; anomalies: Anomalie[] } {
  const statuts: StatutExigibilite[] = [];
  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId } = ecriture.ligneTva;
    if (!compte.startsWith(PREFIXE_COLLECTE)) continue;

    if (ecriture.autresLignes.length === 0) {
      anomalies.push({
        type: 'nature_operation_indeterminee',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description: 'Aucune ligne produit trouvée sur la pièce — nature bien/service non déterminable.',
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'indetermine',
        exigible: true,
        motif: 'Nature indéterminée — exigibilité supposée par défaut (facturation), à vérifier manuellement.',
      });
      continue;
    }

    const natures = new Set(
      ecriture.autresLignes.map((l) => (estCompteService(l.compte, config.comptesVenteService) ? 'service' : 'bien'))
    );

    if (natures.size > 1) {
      anomalies.push({
        type: 'nature_operation_mixte',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description:
          'Pièce mêlant des lignes de nature bien et service — exigibilité à vérifier ligne par ligne, non calculée automatiquement.',
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'indetermine',
        exigible: true,
        motif: 'Nature mixte — à vérifier manuellement.',
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
          'Prestation de service sans ligne tiers identifiée sur la pièce — exigibilité (TVA sur encaissement) non vérifiable.',
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'service',
        exigible: true,
        motif: 'Ligne tiers introuvable — exigibilité supposée par défaut, à vérifier.',
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
        description: `Compte tiers ${ligneTiers.compte} : groupe de lettrage à ${ligneTiers.lettrage.groupeIds.length} lignes — possible paiement partiel, montant exigible à vérifier manuellement (calcul extracomptable de la TVA non encore déductible/collectée).`,
        details: { compteTiers: ligneTiers.compte, groupeIds: ligneTiers.lettrage.groupeIds },
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
