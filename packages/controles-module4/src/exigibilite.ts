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
  ledgerEntryIdsExceptionPaiementComptant: Set<number> = new Set()
): { statuts: StatutExigibilite[]; anomalies: Anomalie[]; prorataAppliques: ProrataApplique[] } {
  const statuts: StatutExigibilite[] = [];
  const anomalies: Anomalie[] = [];
  const prorataAppliques: ProrataApplique[] = [];

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId } = ecriture.ligneTva;
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
