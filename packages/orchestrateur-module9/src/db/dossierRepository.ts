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

export interface DossierListe {
  id: string;
  nom: string;
  siren: string | null;
  statut: 'onboarding' | 'actif' | 'inactif';
  regimeTva: string;
  motifDesactivation: string | null;
}

// Recherche simple par nom (ILIKE) — pas de pagination pour l'instant, un
// cabinet a rarement plus de quelques dizaines de dossiers actifs. À revoir
// si un cabinet en gère des centaines.
export async function listerDossiers(
  client: PoolClient,
  cabinetId: string,
  recherche?: string,
  statut?: string
): Promise<DossierListe[]> {
  const params: unknown[] = [cabinetId];
  let condition = 'cabinet_id = $1';
  if (recherche) {
    params.push(`%${recherche}%`);
    condition += ` AND nom ILIKE $${params.length}`;
  }
  if (statut) {
    params.push(statut);
    condition += ` AND statut = $${params.length}`;
  }

  const res = await client.query(
    `SELECT id, nom, siren, statut, regime_tva, motif_desactivation FROM dossiers WHERE ${condition} ORDER BY nom ASC`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    nom: r.nom,
    siren: r.siren,
    statut: r.statut,
    regimeTva: r.regime_tva,
    motifDesactivation: r.motif_desactivation,
  }));
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

export interface DossierComplet {
  id: string;
  nom: string;
  nomCommercial: string | null;
  siren: string | null;
  siret: string | null;
  formeJuridique: string | null;
  fiscalite: 'is' | 'ir' | null;
  comptabilite: 'engagement' | 'tresorerie' | null;
  dateDebutExercice: string | null;
  dateFinExercice: string | null;
  regimeTva: string;
  periodiciteDeclaration: string;
  tvaEncaissement: boolean;
  numeroTvaIntracom: string | null;
  adresse: string | null;
  ville: string | null;
  codePostal: string | null;
  codeNaf: string | null;
  emailContact: string | null;
  contactNom: string | null;
  contactTelephone: string | null;
  logicielSource: string;
  statut: 'onboarding' | 'actif' | 'inactif';
  motifDesactivation: string | null;
}

// Vue complète d'un dossier — toutes les infos d'identité (10/08), utilisée
// par l'écran de détail/édition dossier. Distincte de chargerDossier
// ci-dessus (champs minimaux, pour la résolution du client Pennylane
// uniquement) et de listerDossiers (champs minimaux pour l'affichage en
// liste) — trois besoins différents, trois formes différentes.
export async function chargerDossierComplet(client: PoolClient, dossierId: string): Promise<DossierComplet | null> {
  const res = await client.query(
    `SELECT id, nom, nom_commercial, siren, siret, forme_juridique, fiscalite, comptabilite,
            date_debut_exercice, date_fin_exercice, regime_tva, periodicite_declaration,
            tva_encaissement, numero_tva_intracom, adresse, ville, code_postal, code_naf,
            email_contact, contact_nom, contact_telephone, logiciel_source, statut, motif_desactivation
     FROM dossiers WHERE id = $1`,
    [dossierId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    nom: r.nom,
    nomCommercial: r.nom_commercial,
    siren: r.siren,
    siret: r.siret,
    formeJuridique: r.forme_juridique,
    fiscalite: r.fiscalite,
    comptabilite: r.comptabilite,
    dateDebutExercice: r.date_debut_exercice,
    dateFinExercice: r.date_fin_exercice,
    regimeTva: r.regime_tva,
    periodiciteDeclaration: r.periodicite_declaration,
    tvaEncaissement: r.tva_encaissement,
    numeroTvaIntracom: r.numero_tva_intracom,
    adresse: r.adresse,
    ville: r.ville,
    codePostal: r.code_postal,
    codeNaf: r.code_naf,
    emailContact: r.email_contact,
    contactNom: r.contact_nom,
    contactTelephone: r.contact_telephone,
    logicielSource: r.logiciel_source,
    statut: r.statut,
    motifDesactivation: r.motif_desactivation,
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
  // Chantier B : taux historique par compte CLIENT (411xxx), table séparée
  // (cf. migration 009) mais fusionnée ici dans le même tauxHistorique[]
  // que les taux par compte produit/charge — TauxHistorique.compteOuTiers
  // est un nom générique depuis l'origine, précisément pour ce cas : les
  // deux espaces de numérotation (445xxx vs 411xxx) ne se chevauchent
  // jamais, donc tauxHabituelPour() fonctionne sans ambiguïté pour les deux
  // usages sans code de lookup séparé.
  const tauxTiersRes = await client.query(
    `SELECT numero_compte_tiers, taux_habituel, nb_occurrences
     FROM taux_historique_tiers WHERE dossier_id = $1 AND statut = 'confirmed'`,
    [dossierId]
  );

  const tauxHistorique: TauxHistorique[] = [
    ...tauxRes.rows.map(
      (r: { compte_produit_ou_charge: string; taux_habituel: string; nb_occurrences: number }) => ({
        compteOuTiers: r.compte_produit_ou_charge,
        tauxHabituel: Number.parseFloat(r.taux_habituel),
        nbOccurrences: r.nb_occurrences,
      })
    ),
    // 'mixte' (10/08) : stocké comme NULL en base (migration 011) — exclu
    // ici volontairement, jamais ajouté à tauxHistorique[]. Conséquence
    // directe : tauxHabituelPour() retourne null pour ce tiers, exactement
    // comme si aucun taux n'avait jamais été confirmé — le chantier B
    // retombe sur sa prudence habituelle (20%) sans code spécifique à
    // écrire ici ni dans encaissementClientNonAffecte.ts.
    ...tauxTiersRes.rows
      .filter((r: { taux_habituel: string | null }) => r.taux_habituel !== null)
      .map((r: { numero_compte_tiers: string; taux_habituel: string; nb_occurrences: number }) => ({
        compteOuTiers: r.numero_compte_tiers,
        tauxHabituel: Number.parseFloat(r.taux_habituel),
        nbOccurrences: r.nb_occurrences,
      })),
  ];

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

// Symétrique de conventionValeur, pour les conventions dont la valeur est un
// objet structuré (ex: motif de numérotation {prefixe, suffixe,
// nombreChiffres}) plutôt qu'une chaîne unique ou une liste. Bug réel
// trouvé le 10/08 : le motif de numérotation utilisait conventionValeur par
// erreur, qui ne retourne jamais rien pour une valeur objet — le contrôle
// de trou de numérotation ne s'est donc jamais exécuté, quel que soit
// l'état de la convention en base.
export function conventionObjet(contexte: ContexteDossier, cle: string): Record<string, unknown> | undefined {
  const trouve = contexte.conventions.find((c) => c.cle === cle);
  if (typeof trouve?.valeur !== 'object' || trouve.valeur === null || Array.isArray(trouve.valeur)) {
    return undefined;
  }
  return trouve.valeur as Record<string, unknown>;
}

// Symétrique de conventionValeur, pour les conventions dont la valeur est une
// liste de comptes (ex: comptes_vente_service) plutôt qu'une chaîne unique.
export function conventionListe(contexte: ContexteDossier, cle: string): string[] | undefined {
  const trouve = contexte.conventions.find((c) => c.cle === cle);
  if (!Array.isArray(trouve?.valeur)) return undefined;
  return trouve.valeur.every((v) => typeof v === 'string') ? (trouve.valeur as string[]) : undefined;
}
