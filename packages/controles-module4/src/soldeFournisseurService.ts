import type { EcritureTvaComplete } from '@tva-controle/core';

export interface ConfigSoldeFournisseurService {
  comptesChargeService: string[]; // ex: ['611', '604'] — comptes de charge, pas comptes fournisseurs
}

// Identifie les comptes fournisseurs (401xxx) concernés par au moins un
// achat de service déductible (44566) dans la période — ce sont ces comptes
// dont le solde impayé en fin de période sert à corriger la TVA déductible
// en bloc (cf. calcul-module7.corrigerDeductibleParSoldeFournisseurService),
// plutôt que de vérifier le lettrage facture par facture comme avant le
// 04/08. Décision de Rami : en pratique, quasi toujours un seul taux (20%)
// et peu de fournisseurs de services, donc une correction par solde est
// suffisante et bien plus simple ; les comptes mixtes (biens ET services)
// restent volontairement hors scope de cette v1, jugés trop rares pour
// justifier la complexité d'un prorata par nature de ligne.
//
// Le lien entre le compte TVA (44566) et le compte fournisseur (401xxx) se
// fait via la même pièce : on ne regarde le compte fournisseur QUE si la
// pièce touche aussi un compte de charge listé dans comptesChargeService
// (ex: 611, 604) — ça évite de traiter un fournisseur de biens comme un
// fournisseur de services simplement parce qu'une de ses factures est
// passée par le compte 44566 (qui couvre les DEUX en pratique comptable).
export function identifierFournisseursService(
  ecritures: EcritureTvaComplete[],
  config: ConfigSoldeFournisseurService
): string[] {
  const comptes = new Set<string>();

  for (const ecriture of ecritures) {
    if (!ecriture.ligneTva.compte.startsWith('44566')) continue;

    const estService = ecriture.autresLignes.some((l) => config.comptesChargeService.includes(l.compte));
    if (!estService) continue;

    for (const ligneTiers of ecriture.lignesTiers) {
      comptes.add(ligneTiers.compte);
    }
  }

  return [...comptes];
}
