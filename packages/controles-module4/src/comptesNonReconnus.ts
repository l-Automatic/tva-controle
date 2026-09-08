import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

export interface ConfigComptesTva {
  compteAutoliquidationDue?: string;
  compteAutoliquidationDeductible?: string;
  // TVA intracom (10/08) — deuxième paire d'autoliquidation, structurellement
  // parallèle à celle du BTP ci-dessus mais confirmée séparément (comptes
  // dédiés propres au dossier, jamais les mêmes que le BTP).
  compteAutoliquidationDueIntracom?: string;
  compteAutoliquidationDeductibleIntracom?: string;
  // Immo intracom (10/08, demande de Rami, option 1 retenue explicitement)
  // — 445622 est volontairement RETIRÉ de la reconnaissance générique par
  // préfixe "44562" (cf. PREFIXE_IMMO_INTRACOM ci-dessous) : sans ce
  // carve-out, un dossier ayant ce cas de figure ne serait jamais invité à
  // confirmer cette convention, et retomberait silencieusement dans le
  // traitement générique du 44562 (montant pris tel quel, sans extraction
  // TVA/TTC-équivalent) — exactement le bug déjà corrigé dans calcul.ts,
  // mais ici jamais détecté ni bloqué. Reconnu UNIQUEMENT par
  // correspondance exacte avec ce compte confirmé, jamais par préfixe.
  compteAutoliquidationDeductibleImmoIntracom?: string;
}

const PREFIXES_RECONNUS = ['44571', '44566'];
// Retiré de PREFIXES_RECONNUS (10/08) : la sous-famille 445622 (immo
// intracom) a besoin d'une confirmation explicite, cf. ConfigComptesTva
// ci-dessus — un compte 44562 "normal" (immo classique, pas
// d'autoliquidation) reste reconnu par ce préfixe précisément, seule la
// sous-famille 445622 en est exclue.
const PREFIXE_IMMO_STANDARD = '44562';
const PREFIXE_IMMO_INTRACOM = '445622';

// Comptes de résultat/report légitimes (TVA à décaisser, crédit de TVA
// reporté) — un mouvement dessus reflète le paiement ou le report d'une
// période précédente, pas une donnée d'entrée pour le calcul en cours.
// Whitelistés explicitement : sans ça, tout dossier qui paie sa TVA
// déclencherait systématiquement l'alerte, noyant le signal utile.
const COMPTES_HORS_PERIMETRE_CONNUS = [
  '44551', // TVA à décaisser
  '44567', // crédit de TVA reporté
  '44583', // remboursement de TVA demandé
  '44586', // TVA sur factures non parvenues (FNP)
  '44587', // TVA sur factures à établir (FAE)
];

// Gravité 'bloquant', pas 'signale' — décision volontaire. calculerTva
// ignore déjà silencieusement tout compte qu'il ne reconnaît pas (voir son
// commentaire "ni inclus ni tracé comme exclusion volontaire"). Laisser ce
// contrôle en simple signalement permettrait à un dossier avec de la vraie
// activité sur un compte non géré (ex: intracom, jamais implémenté) de
// produire un calcul silencieusement faux — exactement ce que ce projet
// cherche à éviter partout ailleurs. Plus bruyant sur des dossiers aux
// comptes atypiques, mais cohérent avec le principe tenu depuis le début :
// arrêter plutôt que produire un chiffre faux.
export function detecterComptesTvaNonReconnus(
  ecritures: EcritureTvaComplete[],
  config: ConfigComptesTva
): Anomalie[] {
  const groupesParCompte = new Map<string, { ledgerEntryIds: number[]; libelles: Set<string> }>();

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId, libelle } = ecriture.ligneTva;

    const estImmoIntracom = compte.startsWith(PREFIXE_IMMO_INTRACOM);
    const estImmoStandard = !estImmoIntracom && compte.startsWith(PREFIXE_IMMO_STANDARD);

    const estReconnu =
      PREFIXES_RECONNUS.some((p) => compte.startsWith(p)) ||
      estImmoStandard ||
      (estImmoIntracom && compte === config.compteAutoliquidationDeductibleImmoIntracom) ||
      compte === config.compteAutoliquidationDue ||
      compte === config.compteAutoliquidationDeductible ||
      compte === config.compteAutoliquidationDueIntracom ||
      compte === config.compteAutoliquidationDeductibleIntracom ||
      COMPTES_HORS_PERIMETRE_CONNUS.includes(compte);

    if (estReconnu) continue;

    const groupe = groupesParCompte.get(compte) ?? { ledgerEntryIds: [], libelles: new Set<string>() };
    groupe.ledgerEntryIds.push(ledgerEntryId);
    if (libelle && groupe.libelles.size < 3) groupe.libelles.add(libelle);
    groupesParCompte.set(compte, groupe);
  }

  const anomalies: Anomalie[] = [];
  for (const [compte, { ledgerEntryIds, libelles }] of groupesParCompte) {
    anomalies.push({
      type: 'compte_tva_non_reconnu',
      gravite: 'bloquant',
      ledgerEntryId: ledgerEntryIds[0]!,
      compte,
      description: `Compte de la famille TVA (${compte}) avec du mouvement mais non géré par cette version (ni collecte, ni déductible standard, ni autoliquidation configurée). Potentiellement hors périmètre actuel (ex: intracom) : calcul refusé tant que ce n'est pas vérifié manuellement.`,
      // L'id Pennylane brut (ledgerEntryId) ne correspond à rien de
      // recherchable dans l'interface Pennylane elle-même — les libellés
      // d'exemple sont la seule info réellement exploitable pour retrouver
      // la pièce sans passer par un accès API direct.
      details: { nbEcritures: ledgerEntryIds.length, references: ledgerEntryIds, exemplesLibelle: [...libelles] },
    });
  }

  return anomalies;
}
