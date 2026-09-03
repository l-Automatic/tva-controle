import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// N'importe quel débit sur un compte de TVA collectée, ou crédit sur un
// compte de TVA déductible, doit correspondre à un avoir (client ou
// fournisseur) ou à une OD de régularisation post-déclaration — jamais
// autre chose. Ce contrôle ne peut pas confirmer que c'est bien le cas
// (il faudrait la pièce jointe / OCR), donc il signale plutôt que de
// bloquer : but différent des contrôles arithmétiques précédents, qui
// eux bloquent.
//
// Étendu aux achats le 10/08 (confirmé par Rami — aucune raison de
// laisser ce contrôle limité aux ventes) : renommée de
// verifierAvoirsCollecte à verifierAvoirs, plus précis vu qu'elle couvre
// désormais les deux sens.
export function verifierAvoirs(
  ecritures: EcritureTvaComplete[],
  prefixesCollecte: string[] = ['44571'],
  prefixesDeductible: string[] = ['44566', '44562']
): Anomalie[] {
  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    const { compte, debit, credit, ledgerEntryId, libelle } = ecriture.ligneTva;
    const estCompteCollecte = prefixesCollecte.some((p) => compte.startsWith(p));
    const estCompteDeductible = prefixesDeductible.some((p) => compte.startsWith(p));

    if (estCompteCollecte && debit > 0) {
      anomalies.push({
        type: 'avoir_a_verifier',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description: `Débit de ${debit} sur le compte de TVA collectée ${compte} : à confirmer qu'il s'agit bien d'un avoir client ou d'une OD de régularisation.`,
        details: { debit, credit, libelle, sens: 'collecte' },
      });
    } else if (estCompteDeductible && credit > 0) {
      anomalies.push({
        type: 'avoir_a_verifier',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description: `Crédit de ${credit} sur le compte de TVA déductible ${compte} : à confirmer qu'il s'agit bien d'un avoir fournisseur ou d'une OD de régularisation.`,
        details: { debit, credit, libelle, sens: 'deductible' },
      });
    }
  }

  return anomalies;
}
