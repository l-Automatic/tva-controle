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
  // Paiement partiel authentique (10/08) : fraction de la ligne réellement
  // exigible cette période (0 à 1), quand un vrai prorata a pu être
  // calculé à partir des montants complets du groupe de lettrage — fourni
  // par l'appelant (pipeline.ts, réseau requis pour le récupérer), cette
  // fonction reste pure. Absent = comportement binaire habituel
  // (exigible=true -> montant complet, false -> exclu).
  prorataExigible?: number;
}

const PREFIXE_COLLECTE = '44571';
const PREFIXES_DEDUCTIBLE = ['44566', '44562'];

function estCompteService(compte: string, comptesService: string[]): boolean {
  return comptesService.some((prefixe) => compte.startsWith(prefixe));
}

export function determinerExigibiliteTva(
  ecritures: EcritureTvaComplete[],
  config: ConfigExigibiliteTva,
  prorataParEcriture: Map<number, number> = new Map(),
  ledgerEntryIdsExceptionPaiementComptant: Set<number> = new Set()
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
    //
    // EXCEPTION (10/08, confirmée par Rami) : les hôtels sont un cas
    // particulier au sein du 625 (déplacements) — contrairement aux péages
    // et restaurants, systématiquement payés en une fois, un hôtel peut
    // être réglé en deux fois (acompte + solde). L'appelant identifie ces
    // écritures (détection déterministe sur le nom du fournisseur, ou
    // jugement LLM sur le libellé — cf. pipeline.ts) et les exclut de ce
    // court-circuit via ledgerEntryIdsExceptionPaiementComptant, pour
    // qu'elles suivent la logique normale de lettrage/prorata ci-dessous.
    const estPaiementComptant =
      !ledgerEntryIdsExceptionPaiementComptant.has(ledgerEntryId) &&
      ecriture.autresLignes.some((l) =>
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

    // Prorata calculé (10/08) : vérifié ICI, avant même la détermination
    // bien/service (pas seulement avant le lettrage) — bug réel trouvé en
    // testant l'exception hôtel : un compte comme 625 n'est jamais dans
    // comptes_charge_service (ce n'est pas sa fonction habituelle), donc
    // sans ce déplacement la ligne sortait déjà classée "bien" avant
    // d'atteindre le contrôle du prorata plus bas. Un prorata fourni par
    // l'appelant signifie que le lien service+paiement partiel a déjà été
    // établi (calcul pur pour les ventes, jugement LLM pour les achats) —
    // ça prévaut sur toute classification bien/service par convention.
    const prorataAnticipe = prorataParEcriture.get(ledgerEntryId);
    if (prorataAnticipe !== undefined) {
      const compteTiersProrata = ecriture.lignesTiers[0]?.compte ?? 'inconnu';
      const groupeIdsProrata = ecriture.lignesTiers[0]?.lettrage.groupeIds ?? [];
      anomalies.push({
        type: 'paiement_partiel_calcule',
        gravite: 'info',
        ledgerEntryId,
        compte,
        description: `Compte tiers ${compteTiersProrata} : paiement partiel détecté — prorata de ${(prorataAnticipe * 100).toFixed(0)}% appliqué automatiquement à partir des montants réels.`,
        details: { compteTiers: compteTiersProrata, groupeIds: groupeIdsProrata, prorata: prorataAnticipe },
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'service',
        exigible: prorataAnticipe > 0,
        prorataExigible: prorataAnticipe,
        motif: `Service : paiement partiel, ${(prorataAnticipe * 100).toFixed(0)}% exigible cette période (calculé sur les montants réels).`,
      });
      continue;
    }

    const comptesServiceApplicables = estCollecte ? config.comptesVenteService : config.comptesChargeService;

    // Aucune ligne produit/charge du tout (10/08, anomalie retirée après
    // discussion avec Rami) : en pratique, ce cas ne se présente quasiment
    // jamais sur une vraie transaction commerciale (même une immobilisation
    // a sa propre ligne de compte 21xx) — seulement une OD de régularisation
    // manuelle. Jamais utile à signaler, gardé silencieux mais toujours
    // avec la prudence inversée achats/ventes (jamais déduit par défaut).
    if (ecriture.autresLignes.length === 0) {
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'indetermine',
        exigible: estCollecte,
        motif: estCollecte
          ? 'Nature indéterminée : exigibilité supposée par défaut (facturation).'
          : 'Achat, nature indéterminée : pas de déduction sans lien clairement établi.',
      });
      continue;
    }

    const natures = new Set(
      ecriture.autresLignes.map((l) => (estCompteService(l.compte, comptesServiceApplicables) ? 'service' : 'bien'))
    );

    if (natures.size > 1) {
      // 10/08 — désormais calculé, plus seulement signalé. Possible
      // uniquement depuis que la catégorisation bien/service par compte
      // existe (conventions_dossier) : au moment où cette anomalie a été
      // construite, cette information n'existait pas encore. Prorata sur
      // les montants HT des lignes produit/charge — PAS un prorata de
      // paiement partiel (question distincte, jamais mélangée ici, comme
      // demandé par Rami) : uniquement payé/pas payé (lettré ou non), qui
      // détermine si la part service est exigible ou exclue cette période.
      // La part bien reste exigible dans tous les cas (exigibilité dès
      // facturation, jamais liée au paiement).
      const montantTotal = ecriture.autresLignes.reduce((s, l) => s + l.debit + l.credit, 0);
      const montantBien = ecriture.autresLignes
        .filter((l) => !estCompteService(l.compte, comptesServiceApplicables))
        .reduce((s, l) => s + l.debit + l.credit, 0);
      const prorataBien = montantTotal > 0 ? montantBien / montantTotal : 0;

      // Aucune ligne tiers = vente comptant, jamais de compte client à
      // lettrer (même raisonnement que plus bas dans cette fonction pour
      // le cas service pur) : la part service est alors considérée payée,
      // donc exigible elle aussi.
      const partServicePayee = ecriture.lignesTiers.length === 0 || (ecriture.lignesTiers[0]?.lettrage.estLettree ?? false);
      const prorataExigible = partServicePayee ? 1 : prorataBien;

      anomalies.push({
        type: 'nature_operation_mixte',
        gravite: 'info',
        ledgerEntryId,
        compte,
        description: partServicePayee
          ? `Pièce mêlant bien et service, mais payée : TVA exigible en totalité.`
          : `Pièce mêlant bien et service, non payée : ${(prorataBien * 100).toFixed(0)}% de la TVA (part bien) exigible immédiatement, le reste (part service) exclu tant que non payé.`,
        details: { libelle, prorataBien, partServicePayee },
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'indetermine',
        exigible: prorataExigible > 0,
        prorataExigible: prorataExigible < 1 ? prorataExigible : undefined,
        motif: partServicePayee
          ? 'Nature mixte, payée : TVA exigible en totalité.'
          : `Nature mixte, non payée : ${(prorataBien * 100).toFixed(0)}% exigible (part bien uniquement).`,
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

    // Service : l'exigibilité dépend du lettrage de la ligne tiers, pas de
    // la ligne TVA. Aucune ligne tiers du tout (10/08, retiré après
    // discussion avec Rami) : signe normal d'une vente comptant sans
    // compte client (caisse directement en banque, aucun crédit accordé)
    // — pas une vraie anomalie de données, plus besoin de la signaler.
    // Exigible par défaut reste correct : une vente comptant est par
    // nature déjà payée.
    if (ecriture.lignesTiers.length === 0) {
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'service',
        exigible: true,
        motif: 'Aucune ligne tiers (vente comptant sans compte client) : exigible par nature.',
      });
      continue;
    }

    const ligneTiers = ecriture.lignesTiers[0]!;
    const exigible = ligneTiers.lettrage.estLettree;

    // Plus de 2 id dans le groupe de lettrage = possible paiement partiel ou
    // rapprochement multi-factures, sans prorata disponible (déjà vérifié
    // ci-dessus) : signalé pour vérification manuelle.
    if (ligneTiers.lettrage.groupeIds.length > 2) {
      anomalies.push({
        type: 'paiement_partiel_a_verifier',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description: `Compte tiers ${ligneTiers.compte} : ce règlement est rapproché avec ${ligneTiers.lettrage.groupeIds.length} autres pièces à la fois (pas juste une facture et son paiement). Signe possible d'un paiement partiel dont le montant exigible n'est pas calculé automatiquement ici : à vérifier manuellement dans Pennylane.`,
        details: { compteTiers: ligneTiers.compte, groupeIds: ligneTiers.lettrage.groupeIds, libelle },
      });

      // Prudence INVERSÉE entre ventes et achats (10/08, confirmé par
      // Rami) : côté ventes, un groupe ambigu non résolu reste exigible
      // par prudence (l'État a droit à la collecte). Côté achats, c'est
      // l'inverse — jamais de déduction sans lien facture/paiement
      // clairement établi.
      if (estDeductible) {
        statuts.push({
          ledgerEntryId,
          compte,
          natureOperation: 'service',
          exigible: false,
          motif: 'Achat : paiement partiel non résolu (groupe de lettrage ambigu) — pas de déduction sans lien clairement établi avec la facture.',
        });
        continue;
      }
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
