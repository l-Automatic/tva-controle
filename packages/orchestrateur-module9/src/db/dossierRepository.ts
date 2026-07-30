import type { PoolClient } from 'pg';
import type {
  ContexteDossier,
  Vehicule,
  TauxHistorique,
  ConventionDossier,
  TypeVehicule,
} from '@tva-controle/core';

export interface DossierInfo {
  id: string;
  regimeTva: string;
  tvaEncaissement: boolean;
  logicielSource: string;
  externalCompanyId: string;
}

export async function chargerDossier(client: PoolClient, dossierId: string): Promise<DossierInfo | null> {
  const res = await client.query(
    `SELECT id, regime_tva, tva_encaissement, logiciel_source, external_company_id
     FROM dossiers WHERE id = $1`,
    [dossierId]
  );
  const row = res.rows[0] as
    | {
        id: string;
        regime_tva: string;
        tva_encaissement: boolean;
        logiciel_source: string;
        external_company_id: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    regimeTva: row.regime_tva,
    tvaEncaissement: row.tva_encaissement,
    logicielSource: row.logiciel_source,
    externalCompanyId: row.external_company_id,
  };
}

// Ne charge QUE les entrées confirmed — les candidate en attente de validation
// (Module 6, pas construit) ne doivent jamais influencer un contrôle ou un
// calcul réel.
export async function chargerContexteDossier(client: PoolClient, dossierId: string): Promise<ContexteDossier> {
  const tauxRes = await client.query(
    `SELECT compte_produit_ou_charge, taux_habituel, nb_occurrences
     FROM taux_historique WHERE dossier_id = $1 AND statut = 'confirmed'`,
    [dossierId]
  );
  const conventionsRes = await client.query(
    `SELECT cle, valeur, statut FROM conventions_dossier
     WHERE dossier_id = $1 AND statut = 'confirmed'`,
    [dossierId]
  );
  const immoRes = await client.query(
    `SELECT type_bien FROM immobilisations
     WHERE dossier_id = $1 AND statut = 'confirmed' AND type_bien IS NOT NULL`,
    [dossierId]
  );
  const tiersRes = await client.query(`SELECT numero_compte_tiers FROM tiers_reference WHERE dossier_id = $1`, [
    dossierId,
  ]);

  const tauxHistorique: TauxHistorique[] = tauxRes.rows.map(
    (r: { compte_produit_ou_charge: string; taux_habituel: string; nb_occurrences: number }) => ({
      compteOuTiers: r.compte_produit_ou_charge,
      tauxHabituel: Number.parseFloat(r.taux_habituel),
      nbOccurrences: r.nb_occurrences,
    })
  );

  const conventions: ConventionDossier[] = conventionsRes.rows.map(
    (r: { cle: string; valeur: unknown; statut: 'candidate' | 'confirmed' | 'rejected' }) => ({
      cle: r.cle,
      valeur: r.valeur,
      statut: r.statut,
    })
  );

  const parcVehicules: Vehicule[] = immoRes.rows.map((r: { type_bien: string }) => ({
    type: r.type_bien as TypeVehicule,
  }));

  const tiersConnus: string[] = tiersRes.rows.map((r: { numero_compte_tiers: string }) => r.numero_compte_tiers);

  return { tauxHistorique, conventions, parcVehicules, tiersConnus };
}

// Convention confirmée dont la valeur est une simple chaîne (ex: numéro de
// compte d'autoliquidation) — évite de fouiller le tableau à chaque usage.
export function conventionValeur(contexte: ContexteDossier, cle: string): string | undefined {
  const trouve = contexte.conventions.find((c) => c.cle === cle);
  return typeof trouve?.valeur === 'string' ? trouve.valeur : undefined;
}

// Symétrique de conventionValeur, pour les conventions dont la valeur est une
// liste de comptes (ex: comptes_vente_service) plutôt qu'une chaîne unique.
export function conventionListe(contexte: ContexteDossier, cle: string): string[] | undefined {
  const trouve = contexte.conventions.find((c) => c.cle === cle);
  if (!Array.isArray(trouve?.valeur)) return undefined;
  return trouve.valeur.every((v) => typeof v === 'string') ? (trouve.valeur as string[]) : undefined;
}
