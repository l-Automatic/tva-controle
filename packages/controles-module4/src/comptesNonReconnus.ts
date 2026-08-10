import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

export interface ConfigComptesTva {
  compteAutoliquidationDue?: string;
  compteAutoliquidationDeductible?: string;
}

const PREFIXES_RECONNUS = ['44571', '44566', '44562'];

// Comptes de résultat/report légitimes (TVA à décaisser, crédit de TVA
// reporté) — un mouvement dessus reflète le paiement ou le report d'une
// période précédente, pas une donnée d'entrée pour le calcul en cours.
// Whitelistés explicitement : sans ça, tout dossier qui paie sa TVA
// déclencherait systématiquement l'alerte, noyant le signal utile.
const COMPTES_HORS_PERIMETRE_CONNUS = ['44551', '44567'];

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
  const groupesParCompte = new Map<string, number[]>();

  for (const ecriture of ecritures) {
    const { compte, ledgerEntryId } = ecriture.ligneTva;

    const estReconnu =
      PREFIXES_RECONNUS.some((p) => compte.startsWith(p)) ||
      compte === config.compteAutoliquidationDue ||
      compte === config.compteAutoliquidationDeductible ||
      COMPTES_HORS_PERIMETRE_CONNUS.includes(compte);

    if (estReconnu) continue;

    const liste = groupesParCompte.get(compte) ?? [];
    liste.push(ledgerEntryId);
    groupesParCompte.set(compte, liste);
  }

  const anomalies: Anomalie[] = [];
  for (const [compte, ledgerEntryIds] of groupesParCompte) {
    anomalies.push({
      type: 'compte_tva_non_reconnu',
      gravite: 'bloquant',
      ledgerEntryId: ledgerEntryIds[0]!,
      compte,
      description: `Compte de la famille TVA (${compte}) avec du mouvement mais non géré par cette version (ni collecte, ni déductible standard, ni autoliquidation configurée). Potentiellement hors périmètre actuel (ex: intracom) : calcul refusé tant que ce n'est pas vérifié manuellement.`,
      details: { nbEcritures: ledgerEntryIds.length, references: ledgerEntryIds },
    });
  }

  return anomalies;
}
