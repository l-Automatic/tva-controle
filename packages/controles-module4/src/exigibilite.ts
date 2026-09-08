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
  // Comptes d'autoliquidation (10/08, bug réel corrigé — trouvé par Rami
  // en conditions réelles) : ces comptes étaient jusqu'ici entièrement
  // ignorés par ce contrôle (ni collecte ni déductible standard), donc
  // toujours inclus dans le calcul peu importe le paiement fournisseur —
  // fiscalement faux. Deux régimes différents, confirmés par Rami :
  // - BTP (Due/Deductible) : toujours des services, jamais d'option TVA
  //   sur les débits chez un sous-traitant -> exigibilité dépend du
  //   paiement, exactement comme un achat de service classique.
  // - Intracom (DueIntracom/DeductibleIntracom/DeductibleImmoIntracom) :
  //   l'exigibilité suit le fait générateur (approximé par la date de la
  //   pièce comptable, faute de mieux dans un FEC), PAS le paiement du
  //   fournisseur — différence structurante avec le régime domestique.
  //   Exigible par défaut, jamais de vérification de lettrage.
  //   Exception acompte anticipé (mouvement 401/512 antérieur à la
  //   facture) volontairement non traitée pour l'instant — chantier
  //   séparé, à faire plus tard.
  compteAutoliquidationDue?: string;
  compteAutoliquidationDeductible?: string;
  compteAutoliquidationDueIntracom?: string;
  compteAutoliquidationDeductibleIntracom?: string;
  compteAutoliquidationDeductibleImmoIntracom?: string;
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
  // calculé à partir des montants complets des lignes rapprochées entre
  // elles par Pennylane — fourni par l'appelant (pipeline.ts, réseau
  // requis pour le récupérer), cette fonction reste pure. Absent =
  // comportement binaire habituel (exigible=true -> montant complet,
  // false -> exclu).
  prorataExigible?: number;
}

const PREFIXE_COLLECTE = '44571';
const PREFIXES_DEDUCTIBLE = ['44566', '44562'];

// Comptes assimilés au bien (10/08, demande de Rami) : certains comptes de
// service sont si indissociables du bien vendu/acheté qu'ils restent
// TOUJOURS exigibles/déductibles dès facturation, jamais soumis au test de
// paiement — livraisons (624) et commissions/courtages (6222). Prend le
// dessus sur toute convention dossier (comptesVenteService/
// comptesChargeService) : même si le cabinet a classé un préfixe plus large
// comme service, ces comptes précis restent "bien".
const PREFIXES_ASSIMILES_BIEN = ['624', '6222'];

function estCompteService(compte: string, comptesService: string[]): boolean {
  if (PREFIXES_ASSIMILES_BIEN.some((prefixe) => compte.startsWith(prefixe))) return false;
  return comptesService.some((prefixe) => compte.startsWith(prefixe));
}

// Détail d'un prorata de paiement partiel réellement appliqué (10/08) —
// remplace l'ancienne anomalie paiement_partiel_calcule, jugée peu
// compréhensible côté utilisateur (demande de Rami). Porté séparément des
// anomalies pour que l'appelant (pipeline.ts) puisse l'afficher là où la
// décision a été prise : le popup de rapprochement côté achats, le
// panneau de calcul côté ventes — jamais dans le bucket générique
// "anomalies".
export interface ProrataApplique {
  ledgerEntryId: number;
  compte: string;
  compteTiers: string;
  prorata: number;
  sens: 'collecte' | 'deductible';
}

export function determinerExigibiliteTva(
  ecritures: EcritureTvaComplete[],
  config: ConfigExigibiliteTva,
  prorataParEcriture: Map<number, number> = new Map(),
  ledgerEntryIdsExceptionPaiementComptant: Set<number> = new Set(),
  // Fournisseurs ayant opté eux-mêmes pour la TVA sur les débits (10/08,
  // demande de Rami) — jamais déduit automatiquement, coché manuellement
  // par le collaborateur (numeros de compte tiers, ex: ['401123']). Ne
  // s'applique QU'au côté déductible (achats) : le fait qu'un fournisseur
  // ait fait ce choix fiscal n'a aucun rapport avec notre propre collecte.
  comptesTiersOptantDebits: Set<string> = new Set()
): { statuts: StatutExigibilite[]; anomalies: Anomalie[]; prorataAppliques: ProrataApplique[] } {
  const statuts: StatutExigibilite[] = [];
  const anomalies: Anomalie[] = [];
  const prorataAppliques: ProrataApplique[] = [];

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId } = ecriture.ligneTva;
    const estCollecte = compte.startsWith(PREFIXE_COLLECTE);
    const estDeductible = PREFIXES_DEDUCTIBLE.some((p) => compte.startsWith(p));

    // Comptes d'autoliquidation (10/08, bug réel corrigé) : deux régimes
    // distincts, cf. commentaire sur ConfigExigibiliteTva. Traité AVANT
    // le reste (paiement comptant, TVA sur les débits...) qui suppose
    // tous estCollecte/estDeductible sur un compte 44571/44566 standard,
    // jamais pertinent ici.
    const estAutoliquidationBtp = compte === config.compteAutoliquidationDue || compte === config.compteAutoliquidationDeductible;
    const estAutoliquidationIntracom =
      compte === config.compteAutoliquidationDueIntracom ||
      compte === config.compteAutoliquidationDeductibleIntracom ||
      compte === config.compteAutoliquidationDeductibleImmoIntracom;

    if (estAutoliquidationIntracom) {
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'service',
        exigible: true,
        motif: 'Acquisition intracommunautaire : exigible au fait générateur (date de la pièce comptable), indépendamment du paiement fournisseur.',
      });
      continue;
    }

    if (estAutoliquidationBtp) {
      // Toujours des services (confirmé par Rami), jamais d'option TVA
      // sur les débits chez un sous-traitant — comportement identique au
      // service classique plus bas dans cette fonction, dupliqué ici
      // volontairement plutôt que factorisé : la condition de sortie
      // (autoliquidation vs standard) doit rester lisible d'un coup
      // d'œil, pas noyée dans un chemin partagé à plusieurs branches.
      if (ecriture.lignesTiers.length === 0) {
        statuts.push({
          ledgerEntryId,
          compte,
          natureOperation: 'service',
          exigible: false,
          motif: 'Autoliquidation BTP sans ligne fournisseur (cas qui ne devrait jamais se produire en pratique) : jamais exigible par prudence.',
        });
        continue;
      }
      const ligneTiersBtp = ecriture.lignesTiers[0]!;
      const exigibleBtp = ligneTiersBtp.lettrage.estLettree;
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'service',
        exigible: exigibleBtp,
        motif: exigibleBtp
          ? 'Autoliquidation BTP : fournisseur payé (ligne lettrée) -> exigible.'
          : 'Autoliquidation BTP : fournisseur pas encore payé -> pas exigible, à exclure du calcul de la période.',
      });
      continue;
    }

    // Comptes d'autoliquidation non identifiés par une convention
    // confirmée (4454/445664... sans configuration) : hors scope de ce
    // contrôle, couverte par verifierAutoliquidationEquilibree/
    // detecterComptesTvaNonReconnus.
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

    // Fournisseur ayant opté pour la TVA sur les débits (10/08) — court-
    // circuite la vérification de lettrage habituelle pour un service : ce
    // fournisseur facture sa propre TVA dès facturation, donc on peut la
    // déduire dès facturation nous aussi, peu importe si SON paiement a
    // déjà eu lieu de notre côté. Uniquement côté déductible (achats) —
    // le choix fiscal d'un fournisseur ne concerne jamais notre collecte.
    const compteTiersEcriture = ecriture.lignesTiers[0]?.compte;
    if (estDeductible && compteTiersEcriture && comptesTiersOptantDebits.has(compteTiersEcriture)) {
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'service',
        exigible: true,
        motif: 'Fournisseur ayant opté pour la TVA sur les débits : déductible dès facturation, sans attendre le paiement.',
      });
      continue;
    }

    const comptesServiceApplicables = estCollecte ? config.comptesVenteService : config.comptesChargeService;

    // natures calculé ICI, avant le contrôle du prorata anticipé
    // ci-dessous (10/08, bug réel corrigé) : sans ça, une facture MIXTE
    // (bien + service) avec un rapprochement déjà validé se faisait
    // intercepter par le chemin simple ci-dessous, qui applique le
    // prorata brut tel quel — jamais la formule mélangée bien/service de
    // la branche nature_operation_mixte plus bas, jamais atteinte dans ce
    // cas. Trouvé en testant : le résultat obtenu était exactement le
    // prorata brut de paiement (0.6, ou 0), jamais le mélange attendu.
    const natures = new Set(
      ecriture.autresLignes.map((l) => (estCompteService(l.compte, comptesServiceApplicables) ? 'service' : 'bien'))
    );

    // Prorata calculé (10/08) : vérifié ICI, avant même la détermination
    // bien/service (pas seulement avant le lettrage) — bug réel trouvé en
    // testant l'exception hôtel : un compte comme 625 n'est jamais dans
    // comptes_charge_service (ce n'est pas sa fonction habituelle), donc
    // sans ce déplacement la ligne sortait déjà classée "bien" avant
    // d'atteindre le contrôle du prorata plus bas. Un prorata fourni par
    // l'appelant signifie que le lien service+paiement partiel a déjà été
    // établi (calcul pur pour les ventes, jugement LLM pour les achats) —
    // ça prévaut sur toute classification bien/service par convention.
    // RESTREINT à natures.size <= 1 (pas mixte) — une facture mixte avec
    // un prorata déjà validé doit passer par la formule mélangée de la
    // branche nature_operation_mixte plus bas, jamais ce chemin simple.
    const prorataAnticipe = natures.size <= 1 ? prorataParEcriture.get(ledgerEntryId) : undefined;
    if (prorataAnticipe !== undefined) {
      const compteTiersProrata = ecriture.lignesTiers[0]?.compte ?? 'inconnu';
      prorataAppliques.push({
        ledgerEntryId,
        compte,
        compteTiers: compteTiersProrata,
        prorata: prorataAnticipe,
        sens: estCollecte ? 'collecte' : 'deductible',
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

    if (natures.size > 1) {
      // 10/08 — désormais calculé, plus seulement signalé. Prorata sur
      // les montants HT des lignes produit/charge pour déterminer la part
      // bien (toujours exigible) vs la part service. Pour la part
      // service : un vrai prorata de PAIEMENT PARTIEL, réutilisant
      // exactement le même mécanisme que le rapprochement paiement achats
      // (rapprochements_paiement_achat, via prorataParEcriture), plutôt
      // que le simple binaire payé/pas payé d'avant — extension confirmée
      // par Rami le même jour, une fois le mécanisme de rapprochement
      // posé. Hypothèse assumée (aucune indication contraire possible) :
      // le montant payé couvre le bien et le service proportionnellement
      // à leur part respective dans le total de la facture.
      const montantTotal = ecriture.autresLignes.reduce((s, l) => s + l.debit + l.credit, 0);
      const montantBien = ecriture.autresLignes
        .filter((l) => !estCompteService(l.compte, comptesServiceApplicables))
        .reduce((s, l) => s + l.debit + l.credit, 0);
      const prorataBien = montantTotal > 0 ? montantBien / montantTotal : 0;

      const prorataPaiementConfirme = prorataParEcriture.get(ledgerEntryId);

      let prorataExigible: number;
      let motif: string;

      if (prorataPaiementConfirme !== undefined) {
        // Un rapprochement a été validé pour cette facture précise (popup
        // achats) — la part service suit le paiement réel, pas juste
        // payé/pas payé.
        prorataExigible = prorataBien + (1 - prorataBien) * prorataPaiementConfirme;
        motif = `Nature mixte, prorata de paiement validé : ${(prorataExigible * 100).toFixed(0)}% exigible.`;
      } else {
        // Pas de rapprochement (facture clairement lettrée en 1-pour-1,
        // ou vente comptant sans ligne tiers) : repli sur le binaire
        // payé/pas payé, comme avant cette extension.
        const partServicePayee = ecriture.lignesTiers.length === 0 || (ecriture.lignesTiers[0]?.lettrage.estLettree ?? false);
        prorataExigible = partServicePayee ? 1 : prorataBien;
        motif = partServicePayee
          ? 'Nature mixte, payée : TVA exigible en totalité.'
          : `Nature mixte, non payée : ${(prorataBien * 100).toFixed(0)}% exigible (part bien uniquement).`;
      }

      // 10/08 — plus une anomalie (retirée après discussion avec Rami :
      // le paiement s'apprécie forcément contre la facture entière,
      // jamais contre une de ses lignes précises — il n'existe aucun
      // autre mécanisme par lequel un paiement pourrait viser
      // spécifiquement la part bien plutôt que la part service. La
      // proportionnalité n'est donc pas "l'hypothèse la plus
      // défendable parmi d'autres", c'est la seule cohérente possible —
      // rien à vérifier, même traitement que paiement_partiel_calcule).
      // Portée séparément via prorataAppliques, comme pour ce dernier.
      const compteTiersProrata = ecriture.lignesTiers[0]?.compte ?? 'inconnu';
      prorataAppliques.push({
        ledgerEntryId,
        compte,
        compteTiers: compteTiersProrata,
        prorata: prorataExigible,
        sens: estCollecte ? 'collecte' : 'deductible',
      });
      statuts.push({
        ledgerEntryId,
        compte,
        natureOperation: 'indetermine',
        exigible: prorataExigible > 0,
        prorataExigible: prorataExigible < 1 ? prorataExigible : undefined,
        motif,
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
    // Le lettrage chez Pennylane est tout ou rien (confirmé par Rami,
    // 10/08) : un groupe lettré équilibre forcément à zéro, quelle que
    // soit sa taille — jamais besoin de traiter un groupe à plus de 2
    // pièces différemment. Ancienne distinction retirée le même jour,
    // après une correction de Rami sur un raisonnement erroné de ma part
    // (cf. facturesCandidatesAcompte.ts pour le même correctif côté
    // détection des factures candidates au rapprochement).
    const exigible = ligneTiers.lettrage.estLettree;

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

  return { statuts, anomalies, prorataAppliques };
}
