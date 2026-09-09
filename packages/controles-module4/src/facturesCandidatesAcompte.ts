import type { EcritureTvaComplete } from '@tva-controle/core';

export interface FactureCandidateAcompte {
  ledgerEntryId: number;
  compteTva: string;
  compteTiers: string;
  compteTiersId: number;
  date: string;
  libelle: string | null;
  montantTva: number;
  montantFactureTotal: number; // montant TTC dû au fournisseur (ligneTiers.credit)
}

// Chantier rapprochement paiement achats (10/08, refonte complète demandée
// par Rami) : identifie toute facture de service JAMAIS lettrée — le
// lettrage chez Pennylane est tout ou rien (confirmé par Rami), un
// groupe lettré équilibre forcément à zéro quelle que soit sa taille,
// donc jamais ambigu une fois lettré. Seule une facture non lettrée
// reste une vraie question ouverte : soit vraiment pas encore payée,
// soit payée mais jamais rapprochée par erreur dans Pennylane. Remplace
// complètement l'ancien jugement automatique — terme "groupe de
// lettrage" volontairement absent d'ici — par une résolution manuelle
// (popup, coche par candidat, précochage IA) avant qu'un cycle puisse
// être lancé.
//
// Pré-filtre déterministe, avant tout appel LLM (coûteux s'il fallait
// l'appliquer à chaque facture non lettrée) : SEULEMENT les factures de
// SERVICE (comptes_charge_service confirmé) — un bien n'a jamais de TVA
// sur acompte à traiter (art. 269-2-a CGI, acompte sur bien = 0% de TVA
// due, la question ne se pose même pas).
//
// Étendu (10/08, bug réel corrigé, confirmé par Rami) à
// comptesChargeAutoliquidation (sous-traitance BTP) : ces charges sont
// aussi des services, et leur exigibilité dépend bien du paiement
// (contrairement à l'intracom, cf. exigibilite.ts) — sans cette
// extension, un sous-traitant BTP payé partiellement n'apparaissait
// jamais dans ce popup, la question restant silencieusement sans
// réponse. compteTvaExclus (intracom) EXPLICITEMENT écarté : 445662
// commence par le même préfixe "44566" que le déductible standard, mais
// son exigibilité ne dépend jamais du paiement — ne doit donc jamais
// apparaître ici, quel que soit son statut de lettrage.
//
// Exception "hôtel" retirée (10/08, demande explicite de Rami) : elle
// forçait un compte 625 (paiement comptant) à devenir candidat même
// sans être confirmé comptes_charge_service, en s'appuyant sur une
// détection LLM dédiée (identifierCandidatsJugementHotel/jugerLibellesHotel,
// chantier séparé). Retirée par cohérence — un hôtel payé en plusieurs
// fois devient candidat comme n'importe quel autre fournisseur, en
// confirmant simplement son compte de charge dans comptes_charge_service,
// sans mécanisme spécial. Les fonctions de détection LLM associées
// restent en place (utilisées ailleurs, cf. tva_hotel_a_verifier), seul
// le court-circuit ici est retiré.
export function identifierFacturesCandidatesAcompte(
  ecritures: EcritureTvaComplete[],
  comptesChargeService: string[],
  comptesChargeAutoliquidation: string[] = [],
  comptesTvaExclus: string[] = []
): FactureCandidateAcompte[] {
  const candidates: FactureCandidateAcompte[] = [];

  for (const ecriture of ecritures) {
    if (comptesTvaExclus.includes(ecriture.ligneTva.compte)) continue;
    if (!ecriture.ligneTva.compte.startsWith('44566')) continue;

    const ligneTiers = ecriture.lignesTiers[0];
    if (!ligneTiers) continue;
    // Correctif (10/08) : ma première extension de cette fonction (le
    // 10/08, plus tôt le même jour) traitait des lignes rapprochées à
    // plus de 2 pièces comme ambiguës, par analogie avec l'ancien
    // mécanisme retiré — erreur de raisonnement, corrigée immédiatement
    // après que Rami l'ait relevée. Le lettrage chez Pennylane est tout
    // ou rien (confirmé par Rami plus tôt dans le projet) : des lignes
    // rapprochées ensemble équilibrent forcément à zéro, quel que soit
    // leur nombre — tout ce qu'elles contiennent est donc réglé. Seule une
    // facture JAMAIS lettrée reste une vraie ambiguïté (le cas d'acompte
    // sans lettrage décrit à l'origine par Rami).
    if (ligneTiers.lettrage.estLettree) continue;

    const comptesChargeApplicables = [...comptesChargeService, ...comptesChargeAutoliquidation];
    const toucheChargeService = ecriture.autresLignes.some((l) =>
      comptesChargeApplicables.some((prefixe) => l.compte.startsWith(prefixe))
    );
    if (!toucheChargeService) continue; // jamais un bien, aucune exception

    const montantTva = Math.abs(ecriture.ligneTva.debit - ecriture.ligneTva.credit);
    if (montantTva === 0) continue;

    candidates.push({
      ledgerEntryId: ecriture.ligneTva.ledgerEntryId,
      compteTva: ecriture.ligneTva.compte,
      compteTiers: ligneTiers.compte,
      compteTiersId: ligneTiers.compteId,
      date: ecriture.ligneTva.date,
      libelle: ecriture.ligneTva.libelle,
      montantTva,
      montantFactureTotal: Math.abs(ligneTiers.debit - ligneTiers.credit),
    });
  }

  return candidates;
}
