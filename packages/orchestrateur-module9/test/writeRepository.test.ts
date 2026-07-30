import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { Anomalie } from '@tva-controle/core';
import type { ResultatCalculTva } from '@tva-controle/calcul-module7';
import {
  enregistrerAnomalies,
  enregistrerEvenementAudit,
  enregistrerPropositionsConventions,
  ajouterConventionManuelle,
  enregistrerPropositionsTaux,
  enregistrerCalcul,
  validerCalcul,
  rejeterCalcul,
  resoudreAnomalie,
  qualifierEncaissementNonAffecte,
  definirParametreCabinet,
  definirParametreDossier,
  synchroniserTiersReference,
  CalculDejaValideError,
  CalculPasEnBrouillonError,
  AnomalieNonQualifiableError,
} from '../src/db/writeRepository.js';
import {
  listerAnomalies,
  listerConventions,
  listerTauxHistorique,
  listerCalculs,
  listerLedgerEntryIdsQualifies,
  listerRegularisationsAIntegrer,
  listerParametresCabinet,
  parametreCabinetValeur,
  listerParametresDossier,
} from '../src/db/readRepository.js';

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const PROVISIONING_CONNECTION_STRING =
  process.env.DATABASE_URL_PROVISIONING ??
  'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
let cabinetId = '';
let dossierId = '';

async function avecClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
    const resultat = await fn(client);
    await client.query('COMMIT');
    return resultat;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const provisioningPool = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
  const client = await provisioningPool.connect();
  try {
    await client.query('BEGIN');
    const resCabinet = await client.query<{ id: string }>(`SELECT provisioning_create_cabinet($1) AS id`, [
      `Cabinet Test writeRepository ${Date.now()}`,
    ]);
    cabinetId = resCabinet.rows[0]!.id;
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);
    const resDossier = await client.query<{ id: string }>(
      `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
       VALUES ($1, 'Dossier Test Write', 'reel_normal', 'pennylane', 'sandbox-write', true) RETURNING id`,
      [cabinetId]
    );
    dossierId = resDossier.rows[0]!.id;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await provisioningPool.end();
  }
}, 20_000);

afterAll(async () => {
  await pool.end();
});

describe('enregistrerAnomalies', () => {
  it('insère plusieurs anomalies en une fois, toutes en statut ouvert', async () => {
    const anomalies: Anomalie[] = [
      { type: 'taux_incoherent', gravite: 'bloquant', ledgerEntryId: 1, compte: '445711', description: 'a' },
      {
        type: 'paiement_partiel_a_verifier',
        gravite: 'signale',
        ledgerEntryId: 2,
        compte: '411000',
        description: 'b',
        details: { groupeIds: [10, 11, 12] },
      },
    ];

    const inserees = await avecClient((client) =>
      enregistrerAnomalies(client, dossierId, '2025-02-01', anomalies)
    );

    // Le pipeline (Module 9) a besoin de ces ids réels pour tracer les
    // anomalies bloquantes dans l'audit — la fonction ne doit plus renvoyer
    // void silencieusement.
    expect(inserees).toHaveLength(2);
    expect(inserees.every((a) => typeof a.id === 'string' && a.id.length > 0)).toBe(true);
    expect(inserees.map((a) => a.gravite).sort()).toEqual(['bloquant', 'signale']);

    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode: '2025-02-01' }));
    expect(liste).toHaveLength(2);
    expect(liste.every((a) => a.statut === 'ouvert')).toBe(true);

    // Bug corrigé : `compte` était calculé par le Module 4 pour chaque
    // anomalie mais jamais persisté (colonne absente + non repris dans
    // l'INSERT) — invisible pour le collaborateur qui traite l'anomalie.
    const tauxIncoherent = liste.find((a) => a.typeAnomalie === 'taux_incoherent');
    expect(tauxIncoherent?.compte).toBe('445711');

    // Idem pour `details` : stocké et renvoyé, mais jusqu'ici jamais affiché
    // côté frontend — on vérifie ici la couche donnée, pas l'affichage.
    const paiementPartiel = liste.find((a) => a.typeAnomalie === 'paiement_partiel_a_verifier');
    expect(paiementPartiel?.compte).toBe('411000');
    expect(paiementPartiel?.details).toEqual({ groupeIds: [10, 11, 12] });
  });

  it('relancer un cycle sur la même période remplace les anomalies ouvertes sans les accumuler, mais préserve celles déjà traitées', async () => {
    const periode = '2025-05-01';
    const premierLot: Anomalie[] = [
      { type: 'taux_incoherent', gravite: 'bloquant', ledgerEntryId: 100, compte: '445711', description: 'x' },
      { type: 'nouveau_tiers_a_verifier', gravite: 'signale', ledgerEntryId: 101, compte: '411000', description: 'y' },
    ];
    const premiereInsertion = await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, premierLot));

    // Un collaborateur traite une des deux anomalies avant la relance.
    const aTraitee = premiereInsertion.find((a) => a.type === 'nouveau_tiers_a_verifier')!;
    await avecClient((client) =>
      client.query(`UPDATE anomalies SET statut = 'resolu' WHERE id = $1`, [aTraitee.id])
    );

    // Relance du cycle sur la même période : cette fois une seule anomalie détectée.
    const secondLot: Anomalie[] = [
      { type: 'taux_incoherent', gravite: 'bloquant', ledgerEntryId: 100, compte: '445711', description: 'x2' },
    ];
    await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, secondLot));

    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode }));

    // Pas d'accumulation : l'ancienne anomalie 'ouvert' a été remplacée, pas
    // dupliquée à côté de la nouvelle.
    expect(liste.filter((a) => a.statut === 'ouvert')).toHaveLength(1);
    // L'anomalie déjà traitée par un humain reste en base, intacte.
    expect(liste.find((a) => a.id === aTraitee.id)?.statut).toBe('resolu');
  });
});

describe('enregistrerPropositionsConventions et enregistrerPropositionsTaux', () => {
  it('insère les propositions du Module 3 en statut candidate', async () => {
    await avecClient((client) =>
      enregistrerPropositionsConventions(client, dossierId, [
        {
          cle: 'compte_tva_due_autoliquidee',
          valeur: '4454',
          confidenceNote: 'Détecté sur 6 pièces',
          nbOccurrences: 6,
        },
      ])
    );
    await avecClient((client) =>
      enregistrerPropositionsTaux(client, dossierId, [
        { compteOuTiers: '445712', tauxHabituel: 10, nbOccurrences: 5 },
      ])
    );

    const conventions = await avecClient((client) => listerConventions(client, dossierId, 'candidate'));
    const taux = await avecClient((client) => listerTauxHistorique(client, dossierId, 'candidate'));

    expect(conventions.some((c) => c.cle === 'compte_tva_due_autoliquidee')).toBe(true);
    expect(taux.some((t) => t.compteProduitOuCharge === '445712' && t.tauxHabituel === 10)).toBe(true);
  });
});

describe('ajouterConventionManuelle', () => {
  it('insère une convention en candidate avec source saisie_manuelle et trace l’audit', async () => {
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U3', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u3-${Date.now()}@test.fr`]
      )
    );
    const utilisateurId = resUser.rows[0]!.id;

    const conventionId = await avecClient((client) =>
      ajouterConventionManuelle(client, dossierId, utilisateurId, 'comptes_vente_service', ['706'])
    );

    const conventions = await avecClient((client) => listerConventions(client, dossierId, 'candidate'));
    const creee = conventions.find((c) => c.id === conventionId);
    expect(creee).toMatchObject({ cle: 'comptes_vente_service', source: 'saisie_manuelle', valeur: ['706'] });

    const audit = await avecClient((client) =>
      client.query(
        `SELECT * FROM audit_log WHERE type_evenement = 'convention_ajoutee_manuellement' AND details->>'conventionId' = $1`,
        [conventionId]
      )
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].acteur).toBe('utilisateur');
    expect(audit.rows[0].acteur_utilisateur_id).toBe(utilisateurId);
  });

  it('une convention ajoutée manuellement reste candidate tant qu’elle n’est pas confirmée explicitement', async () => {
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U4', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u4-${Date.now()}@test.fr`]
      )
    );
    const utilisateurId = resUser.rows[0]!.id;

    const conventionId = await avecClient((client) =>
      ajouterConventionManuelle(client, dossierId, utilisateurId, 'comptes_carburant', ['6061'])
    );

    const confirmees = await avecClient((client) => listerConventions(client, dossierId, 'confirmed'));
    expect(confirmees.some((c) => c.id === conventionId)).toBe(false);
  });
});

describe('enregistrerCalcul et validerCalcul', () => {
  it('enregistre un calcul brouillon puis le valide, et l’immuabilité bloque ensuite toute modification', async () => {
    const resultat: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 711.03, referencesPieces: [22495307276288] }],
      tvaNette: 711.03,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };

    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-03-01', '2025-03-31', resultat)
    );

    let calculs = await avecClient((client) => listerCalculs(client, dossierId));
    let calcul = calculs.find((c) => c.id === calculId);
    expect(calcul).toMatchObject({ statut: 'brouillon', tvaNette: 711.03, sens: 'a_decaisser' });

    // Récupérer un utilisateur pour la validation
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u-${Date.now()}@test.fr`]
      )
    );
    const utilisateurId = resUser.rows[0]!.id;

    await avecClient((client) => validerCalcul(client, calculId, utilisateurId));

    calculs = await avecClient((client) => listerCalculs(client, dossierId));
    calcul = calculs.find((c) => c.id === calculId);
    expect(calcul?.statut).toBe('valide');

    // Le trigger d'immuabilité (002) doit maintenant bloquer toute tentative
    // de modification du montant — même avec les fonctions de ce module.
    await expect(
      avecClient((client) =>
        client.query(`UPDATE calculs_tva SET tva_nette = 999 WHERE id = $1`, [calculId])
      )
    ).rejects.toThrow();

    // Le Module 10 doit avoir tracé la validation, avec le bon acteur et le
    // bon utilisateur — pas juste que le statut a changé en base.
    const audit = await avecClient((client) =>
      client.query(
        `SELECT * FROM audit_log WHERE type_evenement = 'calcul_valide' AND details->>'calculId' = $1`,
        [calculId]
      )
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].acteur).toBe('utilisateur');
    expect(audit.rows[0].acteur_utilisateur_id).toBe(utilisateurId);
    expect(audit.rows[0].dossier_id).toBe(dossierId);
  });

  it('relancer un cycle sur un calcul encore en brouillon le remplace au lieu de violer la contrainte unique', async () => {
    const premier: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 100, referencesPieces: [1] }],
      tvaNette: 100,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const premierCalculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-06-01', '2025-06-30', premier)
    );

    const second: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 250, referencesPieces: [2] }],
      tvaNette: 250,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const secondCalculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-06-01', '2025-06-30', second)
    );

    // Même ligne mise à jour en place (pas de DELETE possible sur
    // calculs_tva) : même id, mais valeurs de la relance.
    expect(secondCalculId).toBe(premierCalculId);

    const calculs = await avecClient((client) => listerCalculs(client, dossierId));
    const surCettePeriode = calculs.filter((c) => c.id === premierCalculId);
    expect(surCettePeriode).toHaveLength(1);
    expect(surCettePeriode[0]).toMatchObject({ tvaNette: 250 });
  });

  it('refuse de relancer un cycle sur une période déjà validée plutôt que de laisser remonter une erreur de contrainte brute', async () => {
    const resultat: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 50, referencesPieces: [3] }],
      tvaNette: 50,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-07-01', '2025-07-31', resultat)
    );
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u2-${Date.now()}@test.fr`]
      )
    );
    await avecClient((client) => validerCalcul(client, calculId, resUser.rows[0]!.id));

    await expect(
      avecClient((client) => enregistrerCalcul(client, dossierId, '2025-07-01', '2025-07-31', resultat))
    ).rejects.toThrow(CalculDejaValideError);
  });

  it('rejette un calcul en brouillon (erreur de saisie) sans le supprimer', async () => {
    const resultat: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 10, referencesPieces: [4] }],
      tvaNette: 10,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-08-01', '2025-07-31', resultat)
    );
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U3', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u3-${Date.now()}@test.fr`]
      )
    );

    await avecClient((client) =>
      rejeterCalcul(client, calculId, resUser.rows[0]!.id, 'periode inversee, erreur de saisie')
    );

    const calculs = await avecClient((client) => listerCalculs(client, dossierId));
    expect(calculs.find((c) => c.id === calculId)).toMatchObject({ statut: 'rejete' });
  });

  it('refuse de rejeter un calcul qui n’est plus en brouillon', async () => {
    const resultat: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 15, referencesPieces: [5] }],
      tvaNette: 15,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-09-01', '2025-09-30', resultat)
    );
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U4', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u4-${Date.now()}@test.fr`]
      )
    );
    const uid = resUser.rows[0]!.id;
    await avecClient((client) => validerCalcul(client, calculId, uid));

    await expect(
      avecClient((client) => rejeterCalcul(client, calculId, uid, 'tentative apres validation'))
    ).rejects.toThrow(CalculPasEnBrouillonError);
  });

  it('relancer un cycle sur un calcul rejeté le repasse en brouillon avec les nouvelles valeurs', async () => {
    const errone: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 999, referencesPieces: [6] }],
      tvaNette: 999,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-10-01', '2025-10-31', errone)
    );
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U5', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u5-${Date.now()}@test.fr`]
      )
    );
    await avecClient((client) => rejeterCalcul(client, calculId, resUser.rows[0]!.id, 'mauvais parametrage'));

    const corrige: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 42, referencesPieces: [7] }],
      tvaNette: 42,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const relanceId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, '2025-10-01', '2025-10-31', corrige)
    );

    expect(relanceId).toBe(calculId);
    const calculs = await avecClient((client) => listerCalculs(client, dossierId));
    expect(calculs.find((c) => c.id === calculId)).toMatchObject({ statut: 'brouillon', tvaNette: 42 });
  });
});

describe('enregistrerEvenementAudit (Module 10)', () => {
  it('insère une ligne dans audit_log rattachée au cabinet du contexte transactionnel courant', async () => {
    await avecClient((client) =>
      enregistrerEvenementAudit(client, {
        dossierId,
        typeEvenement: 'evenement_test',
        moduleSource: 'test_suite',
        acteur: 'systeme',
        details: { exemple: 'valeur' },
      })
    );

    const res = await avecClient((client) =>
      client.query(`SELECT * FROM audit_log WHERE type_evenement = 'evenement_test'`)
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].cabinet_id).toBe(cabinetId);
    expect(res.rows[0].dossier_id).toBe(dossierId);
    expect(res.rows[0].acteur).toBe('systeme');
    expect(res.rows[0].acteur_utilisateur_id).toBeNull();
    expect(res.rows[0].details).toEqual({ exemple: 'valeur' });
  });

  it('resoudreAnomalie trace un événement anomalie_resolue avec l’utilisateur qui a résolu', async () => {
    const inserees = await avecClient((client) =>
      enregistrerAnomalies(client, dossierId, '2025-04-01', [
        { type: 'avoir_a_verifier', gravite: 'signale', ledgerEntryId: 42, compte: '445711', description: 'test' },
      ])
    );
    const anomalieId = inserees[0]!.id;

    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u2-${Date.now()}@test.fr`]
      )
    );
    const utilisateurId = resUser.rows[0]!.id;

    await avecClient((client) => resoudreAnomalie(client, anomalieId, utilisateurId, 'traitée'));

    const audit = await avecClient((client) =>
      client.query(
        `SELECT * FROM audit_log WHERE type_evenement = 'anomalie_resolue' AND details->>'anomalieId' = $1`,
        [anomalieId]
      )
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].acteur).toBe('utilisateur');
    expect(audit.rows[0].acteur_utilisateur_id).toBe(utilisateurId);
  });
});

describe('qualifierEncaissementNonAffecte (compte 471)', () => {
  async function creerAnomalieEncaissement(periode: string, montantTTC: number, ledgerEntryId: number) {
    const anomalie: Anomalie = {
      type: 'encaissement_non_affecte',
      gravite: 'bloquant',
      ledgerEntryId,
      compte: '471000',
      description: 'test',
      details: { montantTTC, libelle: 'Virement', date: periode },
    };
    const [inseree] = await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, [anomalie]));
    return inseree!.id;
  }

  // Plusieurs anomalies sur la MÊME période doivent être insérées en un seul
  // appel : enregistrerAnomalies marque les anomalies 'ouvert' existantes de
  // la période comme 'obsolete' avant d'insérer (dédup, cf. commentaire de
  // la fonction) — les insérer une par une via creerAnomalieEncaissement se
  // ferait donc obsoléter les précédentes à chaque nouvel appel.
  async function creerAnomaliesEncaissement(
    periode: string,
    specs: { montantTTC: number; ledgerEntryId: number }[]
  ) {
    const anomalies: Anomalie[] = specs.map((s) => ({
      type: 'encaissement_non_affecte',
      gravite: 'bloquant',
      ledgerEntryId: s.ledgerEntryId,
      compte: '471000',
      description: 'test',
      details: { montantTTC: s.montantTTC, libelle: 'Virement', date: periode },
    }));
    const inserees = await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, anomalies));
    return inserees.map((a) => a.id);
  }

  async function creerUtilisateur(label: string) {
    const res = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, $2, $3, 'collaborateur') RETURNING id`,
        [cabinetId, label, `${label}-${Date.now()}@test.fr`]
      )
    );
    return res.rows[0]!.id;
  }

  it('qualification "vente" : passe en resolu, stocke le taux dans resolution', async () => {
    const anomalieId = await creerAnomalieEncaissement('2025-11-01', 1200, 5001);
    const utilisateurId = await creerUtilisateur('Q1');

    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, anomalieId, utilisateurId, { decision: 'vente', taux: 20 })
    );

    const anomalies = await avecClient((client) => listerAnomalies(client, dossierId, { periode: '2025-11-01' }));
    const ligne = anomalies.find((a) => a.id === anomalieId);
    expect(ligne?.statut).toBe('resolu');
    expect(ligne?.resolution).toEqual({ taux: 20 });
  });

  it('qualification "hors_vente" : passe en justifie, resolution reste vide', async () => {
    const anomalieId = await creerAnomalieEncaissement('2025-11-02', 300, 5002);
    const utilisateurId = await creerUtilisateur('Q2');

    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, anomalieId, utilisateurId, {
        decision: 'hors_vente',
        motif: 'Remboursement assurance dégât des eaux',
      })
    );

    const anomalies = await avecClient((client) => listerAnomalies(client, dossierId, { periode: '2025-11-02' }));
    const ligne = anomalies.find((a) => a.id === anomalieId);
    expect(ligne?.statut).toBe('justifie');
    expect(ligne?.resolution).toBeNull();
  });

  it('refuse de qualifier une anomalie qui n’est pas de type encaissement_non_affecte', async () => {
    const autre: Anomalie = {
      type: 'taux_incoherent',
      gravite: 'bloquant',
      ledgerEntryId: 5003,
      compte: '445711',
      description: 'test',
    };
    const [inseree] = await avecClient((client) => enregistrerAnomalies(client, dossierId, '2025-11-03', [autre]));
    const utilisateurId = await creerUtilisateur('Q3');

    await expect(
      avecClient((client) =>
        qualifierEncaissementNonAffecte(client, inseree!.id, utilisateurId, { decision: 'vente', taux: 20 })
      )
    ).rejects.toThrow(/encaissement_non_affecte/);
  });

  it('refuse de re-qualifier une anomalie déjà traitée plutôt que d’écraser silencieusement la première décision', async () => {
    const anomalieId = await creerAnomalieEncaissement('2025-11-06', 800, 5010);
    const utilisateurId = await creerUtilisateur('Q6');

    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, anomalieId, utilisateurId, { decision: 'vente', taux: 20 })
    );

    // Un collègue (ou un second clic) tente de qualifier la même anomalie
    // différemment — doit être rejeté, pas silencieusement accepté.
    await expect(
      avecClient((client) =>
        qualifierEncaissementNonAffecte(client, anomalieId, utilisateurId, {
          decision: 'hors_vente',
          motif: 'remboursement',
        })
      )
    ).rejects.toThrow(AnomalieNonQualifiableError);

    // La première décision doit être intacte, pas écrasée par la tentative refusée.
    const anomalies = await avecClient((client) => listerAnomalies(client, dossierId, { periode: '2025-11-06' }));
    const ligne = anomalies.find((a) => a.id === anomalieId);
    expect(ligne?.statut).toBe('resolu');
    expect(ligne?.resolution).toEqual({ taux: 20 });
  });

  it('listerLedgerEntryIdsQualifies retourne les pièces déjà résolues ou justifiées, pas les ouvertes', async () => {
    const [idVente, idHorsVente] = await creerAnomaliesEncaissement('2025-11-04', [
      { montantTTC: 100, ledgerEntryId: 6001 },
      { montantTTC: 200, ledgerEntryId: 6002 },
      { montantTTC: 300, ledgerEntryId: 6003 }, // reste ouverte, volontairement
    ]);
    const utilisateurId = await creerUtilisateur('Q4');

    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, idVente, utilisateurId, { decision: 'vente', taux: 10 })
    );
    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, idHorsVente, utilisateurId, {
        decision: 'hors_vente',
        motif: 'remboursement',
      })
    );

    const qualifies = await avecClient((client) => listerLedgerEntryIdsQualifies(client, dossierId));

    expect(qualifies.has(6001)).toBe(true);
    expect(qualifies.has(6002)).toBe(true);
    expect(qualifies.has(6003)).toBe(false);
  });

  it('listerRegularisationsAIntegrer ne retourne que les qualifications "vente" de la période demandée', async () => {
    const [idVente, idHorsVente] = await creerAnomaliesEncaissement('2025-11-05', [
      { montantTTC: 1200, ledgerEntryId: 7001 },
      { montantTTC: 500, ledgerEntryId: 7002 },
    ]);
    const idAutrePeriode = await creerAnomalieEncaissement('2025-12-01', 600, 7003);
    const utilisateurId = await creerUtilisateur('Q5');

    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, idVente, utilisateurId, { decision: 'vente', taux: 20 })
    );
    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, idHorsVente, utilisateurId, {
        decision: 'hors_vente',
        motif: 'remboursement',
      })
    );
    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, idAutrePeriode, utilisateurId, { decision: 'vente', taux: 10 })
    );

    const regularisations = await avecClient((client) =>
      listerRegularisationsAIntegrer(client, dossierId, '2025-11-05')
    );

    expect(regularisations).toEqual([{ ledgerEntryId: 7001, montantTTC: 1200, taux: 20 }]);
  });
});

describe('paramétrage cabinet et dossier', () => {
  async function creerUtilisateur(label: string) {
    const res = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, $2, $3, 'collaborateur') RETURNING id`,
        [cabinetId, label, `${label}-${Date.now()}@test.fr`]
      )
    );
    return res.rows[0]!.id;
  }

  it('définit puis relit un paramètre cabinet non secret en clair', async () => {
    const utilisateurId = await creerUtilisateur('P1');

    await avecClient((client) =>
      definirParametreCabinet(client, cabinetId, 'unite_devise', 'EUR', utilisateurId)
    );

    const parametres = await avecClient((client) => listerParametresCabinet(client, cabinetId));
    expect(parametres.find((p) => p.cle === 'unite_devise')?.valeur).toBe('EUR');
  });

  it('masque la valeur d’un paramètre secret (mistral_api_key) dans listerParametresCabinet, mais parametreCabinetValeur la retourne en clair', async () => {
    const utilisateurId = await creerUtilisateur('P2');

    await avecClient((client) =>
      definirParametreCabinet(client, cabinetId, 'mistral_api_key', 'sk-test-abc123', utilisateurId)
    );

    const parametres = await avecClient((client) => listerParametresCabinet(client, cabinetId));
    const cle = parametres.find((p) => p.cle === 'mistral_api_key');
    expect(cle?.valeur).toBe('••••••••');
    expect(cle?.valeur).not.toContain('sk-test-abc123');

    // Usage interne serveur (résolution pour un appel LLM) : valeur en clair.
    const valeurReelle = await avecClient((client) => parametreCabinetValeur(client, cabinetId, 'mistral_api_key'));
    expect(valeurReelle).toBe('sk-test-abc123');
  });

  it('ne trace jamais la valeur d’un paramètre secret dans l’audit, seulement son nom', async () => {
    const utilisateurId = await creerUtilisateur('P3');

    await avecClient((client) =>
      definirParametreCabinet(client, cabinetId, 'mistral_api_key', 'sk-secret-xyz', utilisateurId)
    );

    const audit = await avecClient((client) =>
      client.query(
        `SELECT details FROM audit_log WHERE type_evenement = 'parametre_cabinet_modifie' AND acteur_utilisateur_id = $1`,
        [utilisateurId]
      )
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0].details)).not.toContain('sk-secret-xyz');
    expect(audit.rows[0].details).toEqual({ cle: 'mistral_api_key', secret: true });
  });

  it('redéfinir la même clé met à jour la valeur plutôt que d’en créer une seconde (upsert)', async () => {
    const utilisateurId = await creerUtilisateur('P4');

    await avecClient((client) => definirParametreCabinet(client, cabinetId, 'test_upsert', 'v1', utilisateurId));
    await avecClient((client) => definirParametreCabinet(client, cabinetId, 'test_upsert', 'v2', utilisateurId));

    const parametres = await avecClient((client) => listerParametresCabinet(client, cabinetId));
    expect(parametres.filter((p) => p.cle === 'test_upsert')).toHaveLength(1);
    expect(parametres.find((p) => p.cle === 'test_upsert')?.valeur).toBe('v2');
  });

  it('paramètre dossier : indépendant du paramètre cabinet de même nom', async () => {
    const utilisateurId = await creerUtilisateur('P5');

    await avecClient((client) =>
      definirParametreDossier(client, dossierId, 'controle_carburant_actif', false, utilisateurId)
    );

    const parametresDossier = await avecClient((client) => listerParametresDossier(client, dossierId));
    expect(parametresDossier.find((p) => p.cle === 'controle_carburant_actif')?.valeur).toBe(false);

    const parametresCabinet = await avecClient((client) => listerParametresCabinet(client, cabinetId));
    expect(parametresCabinet.find((p) => p.cle === 'controle_carburant_actif')).toBeUndefined();
  });
});

describe('synchroniserTiersReference', () => {
  it('un tiers nouveau est inséré en statut nouveau', async () => {
    const compte = `401NOUVEAU${Date.now()}`;
    await avecClient((client) =>
      synchroniserTiersReference(
        client,
        dossierId,
        [{ numeroCompteTiers: compte, nomTiers: 'Fournisseur Neuf', estNouveau: true }],
        '2025-06-30'
      )
    );

    const res = await avecClient((client) =>
      client.query(`SELECT * FROM tiers_reference WHERE dossier_id = $1 AND numero_compte_tiers = $2`, [
        dossierId,
        compte,
      ])
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      niveau_confiance: 'nouveau',
      nb_controles_sans_anomalie: 0,
      nom_tiers: 'Fournisseur Neuf',
    });
  });

  it('un tiers déjà nouveau : la relance n’écrase pas la ligne existante (ON CONFLICT DO NOTHING)', async () => {
    const compte = `401DEJA${Date.now()}`;
    await avecClient((client) =>
      synchroniserTiersReference(
        client,
        dossierId,
        [{ numeroCompteTiers: compte, nomTiers: 'Premier nom', estNouveau: true }],
        '2025-06-30'
      )
    );
    await avecClient((client) =>
      synchroniserTiersReference(
        client,
        dossierId,
        [{ numeroCompteTiers: compte, nomTiers: 'Autre nom', estNouveau: true }],
        '2025-07-31'
      )
    );

    const res = await avecClient((client) =>
      client.query(`SELECT * FROM tiers_reference WHERE dossier_id = $1 AND numero_compte_tiers = $2`, [
        dossierId,
        compte,
      ])
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].nom_tiers).toBe('Premier nom');
  });

  it('un tiers déjà connu progresse : compteur incrémenté, niveau_confiance avance aux seuils', async () => {
    const compte = `401PROGRESSE${Date.now()}`;
    // D'abord un cycle où il est nouveau.
    await avecClient((client) =>
      synchroniserTiersReference(
        client,
        dossierId,
        [{ numeroCompteTiers: compte, nomTiers: 'Test Progression', estNouveau: true }],
        '2025-01-31'
      )
    );

    // Puis 3 cycles où il n'est plus nouveau -> doit atteindre 'a_surveiller' (seuil 3).
    for (const periode of ['2025-02-28', '2025-03-31', '2025-04-30']) {
      await avecClient((client) =>
        synchroniserTiersReference(
          client,
          dossierId,
          [{ numeroCompteTiers: compte, nomTiers: null, estNouveau: false }],
          periode
        )
      );
    }

    let res = await avecClient((client) =>
      client.query(`SELECT * FROM tiers_reference WHERE dossier_id = $1 AND numero_compte_tiers = $2`, [
        dossierId,
        compte,
      ])
    );
    expect(res.rows[0]).toMatchObject({ nb_controles_sans_anomalie: 3, niveau_confiance: 'a_surveiller' });

    // 3 cycles de plus -> 6 au total -> 'confiance' (seuil 6).
    for (const periode of ['2025-05-31', '2025-06-30', '2025-07-31']) {
      await avecClient((client) =>
        synchroniserTiersReference(
          client,
          dossierId,
          [{ numeroCompteTiers: compte, nomTiers: null, estNouveau: false }],
          periode
        )
      );
    }

    res = await avecClient((client) =>
      client.query(`SELECT * FROM tiers_reference WHERE dossier_id = $1 AND numero_compte_tiers = $2`, [
        dossierId,
        compte,
      ])
    );
    expect(res.rows[0]).toMatchObject({ nb_controles_sans_anomalie: 6, niveau_confiance: 'confiance' });
  });

  it('ne remplace jamais un nom déjà connu par null (COALESCE)', async () => {
    const compte = `401NOMPRESERVE${Date.now()}`;
    await avecClient((client) =>
      synchroniserTiersReference(
        client,
        dossierId,
        [{ numeroCompteTiers: compte, nomTiers: 'Nom Original', estNouveau: true }],
        '2025-01-31'
      )
    );
    await avecClient((client) =>
      synchroniserTiersReference(
        client,
        dossierId,
        [{ numeroCompteTiers: compte, nomTiers: null, estNouveau: false }],
        '2025-02-28'
      )
    );

    const res = await avecClient((client) =>
      client.query(`SELECT nom_tiers FROM tiers_reference WHERE dossier_id = $1 AND numero_compte_tiers = $2`, [
        dossierId,
        compte,
      ])
    );
    expect(res.rows[0].nom_tiers).toBe('Nom Original');
  });
});
