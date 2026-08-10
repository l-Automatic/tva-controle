import type { EcritureTvaComplete, Anomalie } from '@tva-controle/core';

// N'importe quel débit sur un compte de TVA collectée doit correspondre à un
// avoir client ou à une OD de régularisation post-déclaration — jamais autre
// chose. Ce contrôle ne peut pas confirmer que c'est bien le cas (il
// faudrait la pièce jointe / OCR), donc il signale plutôt que de bloquer :
// but différent des contrôles arithmétiques précédents, qui eux bloquent.
export function verifierAvoirsCollecte(
  ecritures: EcritureTvaComplete[],
  prefixesCollecte: string[] = ['44571']
): Anomalie[] {
  const anomalies: Anomalie[] = [];

  for (const ecriture of ecritures) {
    const { compte, debit, ledgerEntryId } = ecriture.ligneTva;
    const estCompteCollecte = prefixesCollecte.some((p) => compte.startsWith(p));
    if (estCompteCollecte && debit > 0) {
      anomalies.push({
        type: 'avoir_a_verifier',
        gravite: 'signale',
        ledgerEntryId,
        compte,
        description: `Débit de ${debit} sur le compte de TVA collectée ${compte} : à confirmer qu'il s'agit bien d'un avoir ou d'une OD de régularisation.`,
        details: { debit },
      });
    }
  }

  return anomalies;
}
