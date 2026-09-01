import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { Anomalie } from '@tva-controle/core';
import type { ResultatCalculTva } from '@tva-controle/calcul-module7';
import {
  enregistrerAnomalies,
  enregistrerAnomaliesPartielles,
  enregistrerEvenementAudit,
  enregistrerPropositionsConventions,
  ajouterConventionManuelle,
  confirmerConvention,
  rejeterConvention,
  retirerCompteConvention,
  enregistrerPropositionsTaux,
  enregistrerPropositionsTauxTiers,
  confirmerTauxHistoriqueTiers,
  assignerTauxHistoriqueTiersManuel,
  rejeterTauxHistoriqueTiers,
  enregistrerCalcul,
  validerCalcul,
  rejeterCalcul,
  resoudreAnomalie,
  justifierAnomalie,
  resoudreAnomaliesEnMasse,
  qualifierEncaissementNonAffecte,
  definirParametreCabinet,
  definirParametreDossier,
  synchroniserTiersReference,
  corrigerNiveauConfianceTiers,
  assignerTauxCompte,
  CalculDejaValideError,
  CalculPasEnBrouillonError,
  AnomalieNonQualifiableError,
  ajusterMontantCalcul,
  retirerAjustementCalcul,
  CalculPlusEnBrouillonError,
  definirMotDePasse,
  desactiverUtilisateurCabinet,
  DernierAdminCabinetError,
  synchroniserDossiersCabinet,
  configurerDossierOnboarding,
  definirStatutDossier,
  mettreAJourInfosDossier,
  DossierIntrouvableError,
} from '../src/db/writeRepository.js';
import {
  listerAnomalies,
  listerConventions,
  listerTauxHistorique,
  listerTauxHistoriqueTiers,
  listerCalculs,
  listerLedgerEntryIdsQualifies,
  listerRegularisationsAIntegrer,
  listerParametresCabinet,
  listerElementsATraiter,
  listerAnomaliesTraiteesParTypeEtPiece,
  parametreCabinetValeur,
  listerParametresDossier,
  listerTauxAssignes,
  listerAjustementsCalcul,
  trouverUtilisateurPourConnexion,
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

  it('ne propose jamais deux fois pour le même compte, même si rappelée (relance de cycle)', async () => {
    const compte = `445714test${Date.now()}`;
    await avecClient((client) =>
      enregistrerPropositionsTaux(client, dossierId, [{ compteOuTiers: compte, tauxHabituel: 20, nbOccurrences: 5 }])
    );
    // Rappel avec un taux dominant différent (simule un recalcul sur un
    // cycle suivant) : ne doit PAS créer une seconde candidate.
    await avecClient((client) =>
      enregistrerPropositionsTaux(client, dossierId, [{ compteOuTiers: compte, tauxHabituel: 10, nbOccurrences: 8 }])
    );

    const taux = await avecClient((client) => listerTauxHistorique(client, dossierId, 'candidate'));
    const pourCeCompte = taux.filter((t) => t.compteProduitOuCharge === compte);
    expect(pourCeCompte).toHaveLength(1);
    expect(pourCeCompte[0]?.tauxHabituel).toBe(20); // la première proposition, pas la seconde
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

  it('ajouter un second lot de comptes séparément fusionne avec la liste déjà confirmée, ne l’écrase pas', async () => {
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U6', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u6-${Date.now()}@test.fr`]
      )
    );
    const utilisateurId = resUser.rows[0]!.id;
    const cle = `comptes_test_fusion_${Date.now()}`;

    const id1 = await avecClient((client) => ajouterConventionManuelle(client, dossierId, utilisateurId, cle, ['706']));
    await avecClient((client) => confirmerConvention(client, id1, utilisateurId));

    // Second lot, ajouté séparément (pas dans le même appel) — sans la
    // fusion, ceci écraserait '706' au lieu de donner ['706', '611'].
    const id2 = await avecClient((client) => ajouterConventionManuelle(client, dossierId, utilisateurId, cle, ['611']));

    const candidates = await avecClient((client) => listerConventions(client, dossierId, 'candidate'));
    const nouvelleCandidate = candidates.find((c) => c.id === id2);
    expect(nouvelleCandidate?.valeur).toEqual(['706', '611']);

    await avecClient((client) => confirmerConvention(client, id2, utilisateurId));

    const confirmees = await avecClient((client) => listerConventions(client, dossierId, 'confirmed'));
    const confirmee = confirmees.find((c) => c.cle === cle);
    expect(confirmee?.valeur).toEqual(['706', '611']);
    // Un seul confirmed pour cette clé, comme partout ailleurs.
    expect(confirmees.filter((c) => c.cle === cle)).toHaveLength(1);
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

  it('applique automatiquement un ajustement quand un calcul brouillon existe déjà pour la période (option A, 10/08)', async () => {
    const periode = '2025-11-10';
    const resultatInitial: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 1000, referencesPieces: [1] }],
      tvaNette: 1000,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, periode, '2025-11-30', resultatInitial)
    );

    const anomalieId = await creerAnomalieEncaissement(periode, 600, 8001);
    const utilisateurId = await creerUtilisateur('Q6');

    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, anomalieId, utilisateurId, { decision: 'vente', taux: 20 })
    );

    const ajustement = await avecClient((client) =>
      client.query(
        `SELECT montant_original, montant_ajuste FROM ajustements_calcul WHERE calcul_id = $1 AND type_montant = 'collectee_totale'`,
        [calculId]
      )
    );
    expect(ajustement.rows).toHaveLength(1);
    expect(Number.parseFloat(ajustement.rows[0].montant_original)).toBeCloseTo(1000);
    // 600 TTC à 20% -> 100 € de TVA -> 1000 + 100 = 1100
    expect(Number.parseFloat(ajustement.rows[0].montant_ajuste)).toBeCloseTo(1100);
  });

  it('ne fait rien de plus (jamais une erreur) si aucun calcul brouillon n’existe pour la période', async () => {
    const anomalieId = await creerAnomalieEncaissement('2025-11-11', 600, 8002);
    const utilisateurId = await creerUtilisateur('Q7');

    await expect(
      avecClient((client) =>
        qualifierEncaissementNonAffecte(client, anomalieId, utilisateurId, { decision: 'vente', taux: 20 })
      )
    ).resolves.not.toThrow();
  });

  it('un deuxième encaissement qualifié sur la même période s’additionne au premier ajustement', async () => {
    const periode = '2025-11-12';
    const resultatInitial: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 500, referencesPieces: [1] }],
      tvaNette: 500,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    const calculId = await avecClient((client) =>
      enregistrerCalcul(client, dossierId, periode, '2025-11-30', resultatInitial)
    );

    const [id1, id2] = await creerAnomaliesEncaissement(periode, [
      { montantTTC: 600, ledgerEntryId: 8003 },
      { montantTTC: 240, ledgerEntryId: 8004 },
    ]);
    const utilisateurId = await creerUtilisateur('Q8');

    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, id1!, utilisateurId, { decision: 'vente', taux: 20 })
    );
    await avecClient((client) =>
      qualifierEncaissementNonAffecte(client, id2!, utilisateurId, { decision: 'vente', taux: 20 })
    );

    const ajustement = await avecClient((client) =>
      client.query(
        `SELECT montant_original, montant_ajuste FROM ajustements_calcul WHERE calcul_id = $1 AND type_montant = 'collectee_totale'`,
        [calculId]
      )
    );
    // 500 (initial) + 100 (600 TTC a 20%) + 40 (240 TTC a 20%) = 640
    expect(Number.parseFloat(ajustement.rows[0].montant_original)).toBeCloseTo(500); // jamais écrasé par le 2e appel
    expect(Number.parseFloat(ajustement.rows[0].montant_ajuste)).toBeCloseTo(640);
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

describe('taux_historique_tiers (chantier B)', () => {
  it('propose, confirme, et ne double-propose jamais pour le même compte tiers', async () => {
    const compteTiers = `411test${Date.now()}`;
    const utilisateurId = (
      await avecClient((client) =>
        client.query<{ id: string }>(
          `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'UTaux', $2, 'collaborateur') RETURNING id`,
          [cabinetId, `utaux-${Date.now()}@test.fr`]
        )
      )
    ).rows[0]!.id;

    await avecClient((client) =>
      enregistrerPropositionsTauxTiers(client, dossierId, [
        { numeroCompteTiers: compteTiers, tauxHabituel: 10, nbOccurrences: 4 },
      ])
    );
    // Rappel (simule une relance de cycle) : ne doit pas créer de doublon.
    await avecClient((client) =>
      enregistrerPropositionsTauxTiers(client, dossierId, [
        { numeroCompteTiers: compteTiers, tauxHabituel: 20, nbOccurrences: 9 },
      ])
    );

    const candidates = await avecClient((client) => listerTauxHistoriqueTiers(client, dossierId, 'candidate'));
    const pourCeCompte = candidates.filter((c) => c.numeroCompteTiers === compteTiers);
    expect(pourCeCompte).toHaveLength(1);
    expect(pourCeCompte[0]?.tauxHabituel).toBe(10);

    await avecClient((client) => confirmerTauxHistoriqueTiers(client, pourCeCompte[0]!.id, utilisateurId));

    const confirmees = await avecClient((client) => listerTauxHistoriqueTiers(client, dossierId, 'confirmed'));
    expect(confirmees.some((c) => c.numeroCompteTiers === compteTiers && c.tauxHabituel === 10)).toBe(true);
  });

  it('rejeterTauxHistoriqueTiers passe la proposition en rejected', async () => {
    const compteTiers = `411reject${Date.now()}`;
    const utilisateurId = (
      await avecClient((client) =>
        client.query<{ id: string }>(
          `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'UTaux2', $2, 'collaborateur') RETURNING id`,
          [cabinetId, `utaux2-${Date.now()}@test.fr`]
        )
      )
    ).rows[0]!.id;

    await avecClient((client) =>
      enregistrerPropositionsTauxTiers(client, dossierId, [
        { numeroCompteTiers: compteTiers, tauxHabituel: 5.5, nbOccurrences: 3 },
      ])
    );
    const candidates = await avecClient((client) => listerTauxHistoriqueTiers(client, dossierId, 'candidate'));
    const proposition = candidates.find((c) => c.numeroCompteTiers === compteTiers)!;

    await avecClient((client) => rejeterTauxHistoriqueTiers(client, proposition.id, utilisateurId));

    const rejetees = await avecClient((client) => listerTauxHistoriqueTiers(client, dossierId, 'rejected'));
    expect(rejetees.some((c) => c.numeroCompteTiers === compteTiers)).toBe(true);
  });
});

describe('listerElementsATraiter', () => {
  it('agrège une anomalie bloquante ouverte et un calcul brouillon pour le même dossier', async () => {
    const anomalie: Anomalie = {
      type: 'compte_tva_non_reconnu',
      gravite: 'bloquant',
      ledgerEntryId: 9001,
      compte: '4459',
      description: 'Compte de test à traiter',
    };
    await avecClient((client) => enregistrerAnomalies(client, dossierId, '2025-12-01', [anomalie]));

    const resultat: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 10, referencesPieces: [1] }],
      tvaNette: 10,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    await avecClient((client) => enregistrerCalcul(client, dossierId, '2025-12-01', '2025-12-31', resultat));

    const elements = await avecClient((client) => listerElementsATraiter(client, dossierId));

    expect(elements.some((e) => e.type === 'anomalie_bloquante' && e.resume === 'Compte de test à traiter')).toBe(
      true
    );
    expect(elements.some((e) => e.type === 'calcul_brouillon')).toBe(true);
  });

  it('n’inclut pas une anomalie signalée (non bloquante) ni un calcul déjà validé', async () => {
    const anomalieSignalee: Anomalie = {
      type: 'avoir_a_verifier',
      gravite: 'signale',
      ledgerEntryId: 9002,
      compte: '445711',
      description: 'Anomalie signalée, ne doit pas apparaître',
    };
    await avecClient((client) => enregistrerAnomalies(client, dossierId, '2025-11-01', [anomalieSignalee]));

    const elements = await avecClient((client) => listerElementsATraiter(client, dossierId));
    expect(elements.some((e) => e.resume === 'Anomalie signalée, ne doit pas apparaître')).toBe(false);
  });
});

describe('retirerCompteConvention', () => {
  async function creerUtilisateur(label: string) {
    const res = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, $2, $3, 'collaborateur') RETURNING id`,
        [cabinetId, label, `${label}-${Date.now()}@test.fr`]
      )
    );
    return res.rows[0]!.id;
  }

  it('retire un compte d’une liste confirmée sans créer de nouvelle ligne ni de rejet', async () => {
    const utilisateurId = await creerUtilisateur('Retrait1');
    const cle = `comptes_test_retrait_${Date.now()}`;

    const id = await avecClient((client) =>
      ajouterConventionManuelle(client, dossierId, utilisateurId, cle, ['706', '611', '604'])
    );
    await avecClient((client) => confirmerConvention(client, id, utilisateurId));

    await avecClient((client) => retirerCompteConvention(client, dossierId, cle, '611', utilisateurId));

    const confirmees = await avecClient((client) => listerConventions(client, dossierId, 'confirmed'));
    const ligne = confirmees.find((c) => c.cle === cle);
    expect(ligne?.valeur).toEqual(['706', '604']);
    expect(ligne?.id).toBe(id); // même ligne, pas une nouvelle

    // Aucune ligne rejetée créée par cette opération.
    const rejetees = await avecClient((client) => listerConventions(client, dossierId, 'rejected'));
    expect(rejetees.some((c) => c.cle === cle)).toBe(false);
  });

  it('échoue proprement si la clé n’a pas de convention confirmée', async () => {
    const utilisateurId = await creerUtilisateur('Retrait2');
    await expect(
      avecClient((client) => retirerCompteConvention(client, dossierId, 'cle_inexistante_xyz', '706', utilisateurId))
    ).rejects.toThrow(/Aucune convention confirmée/);
  });

  it('passe la convention à "rejected" quand le dernier compte est retiré (10/08, bug réel corrigé)', async () => {
    const utilisateurId = await creerUtilisateur('Retrait3');
    const cle = `comptes_test_vide_${Date.now()}`;

    const id = await avecClient((client) =>
      ajouterConventionManuelle(client, dossierId, utilisateurId, cle, ['706'])
    );
    await avecClient((client) => confirmerConvention(client, id, utilisateurId));

    await avecClient((client) => retirerCompteConvention(client, dossierId, cle, '706', utilisateurId));

    const confirmees = await avecClient((client) => listerConventions(client, dossierId, 'confirmed'));
    expect(confirmees.some((c) => c.cle === cle)).toBe(false); // plus "confirmed"

    const rejetees = await avecClient((client) => listerConventions(client, dossierId, 'rejected'));
    const ligneRejetee = rejetees.find((c) => c.cle === cle);
    expect(ligneRejetee).toBeDefined();
    expect(ligneRejetee?.valeur).toEqual([]);
  });
});

describe('listerConventions et listerTauxHistorique — rejected masqué par défaut', () => {
  it('n’inclut pas les conventions rejetées quand aucun statut n’est demandé explicitement', async () => {
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'RejMasque', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `rejmasque-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);
    const cle = `cle_rejetee_${Date.now()}`;

    const id = await avecClient((client) =>
      ajouterConventionManuelle(client, dossierId, utilisateurId, cle, 'valeur_test')
    );
    await avecClient((client) => rejeterConvention(client, id, utilisateurId));

    const sansFiltre = await avecClient((client) => listerConventions(client, dossierId));
    expect(sansFiltre.some((c) => c.id === id)).toBe(false);

    const avecFiltreExplicite = await avecClient((client) => listerConventions(client, dossierId, 'rejected'));
    expect(avecFiltreExplicite.some((c) => c.id === id)).toBe(true);
  });
});

describe('corrigerNiveauConfianceTiers', () => {
  it('modifie directement le niveau de confiance d’un tiers déjà connu', async () => {
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'CorrTiers', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `corrtiers-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);
    const compte = `401correction${Date.now()}`;

    await avecClient((client) =>
      synchroniserTiersReference(
        client,
        dossierId,
        [{ numeroCompteTiers: compte, nomTiers: 'Test correction', estNouveau: true }],
        '2025-01-31'
      )
    );

    await avecClient((client) => corrigerNiveauConfianceTiers(client, dossierId, compte, 'confiance', utilisateurId));

    const res = await avecClient((client) =>
      client.query(`SELECT niveau_confiance FROM tiers_reference WHERE dossier_id = $1 AND numero_compte_tiers = $2`, [
        dossierId,
        compte,
      ])
    );
    expect(res.rows[0].niveau_confiance).toBe('confiance');
  });

  it('échoue proprement pour un tiers introuvable', async () => {
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'CorrTiers2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `corrtiers2-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);

    await expect(
      avecClient((client) =>
        corrigerNiveauConfianceTiers(client, dossierId, '401NexistePas999', 'confiance', utilisateurId)
      )
    ).rejects.toThrow(/introuvable/);
  });
});

describe('assignerTauxCompte', () => {
  it('assigne puis remplace le taux d’un compte (upsert, une seule ligne)', async () => {
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'TauxAssigne', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `tauxassigne-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);
    const compte = `706test${Date.now()}`;

    await avecClient((client) => assignerTauxCompte(client, dossierId, compte, '20', utilisateurId));
    let taux = await avecClient((client) => listerTauxAssignes(client, dossierId));
    expect(taux.find((t) => t.compte === compte)?.tauxAssigne).toBe('20');

    // Réassignation : remplace, ne duplique pas.
    await avecClient((client) => assignerTauxCompte(client, dossierId, compte, 'autoliquide_20', utilisateurId));
    taux = await avecClient((client) => listerTauxAssignes(client, dossierId));
    const pourCeCompte = taux.filter((t) => t.compte === compte);
    expect(pourCeCompte).toHaveLength(1);
    expect(pourCeCompte[0]?.tauxAssigne).toBe('autoliquide_20');
  });

  it('refuse une valeur de taux hors de l’ensemble autorisé (contrainte SQL)', async () => {
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'TauxAssigne2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `tauxassigne2-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);

    await expect(
      avecClient((client) =>
        // @ts-expect-error valeur volontairement invalide pour tester la contrainte SQL
        assignerTauxCompte(client, dossierId, `706invalide${Date.now()}`, '15', utilisateurId)
      )
    ).rejects.toThrow();
  });
});

describe('resoudreAnomaliesEnMasse', () => {
  it('résout plusieurs anomalies ouvertes en une fois avec un commentaire partagé', async () => {
    const anomalies: Anomalie[] = [
      { type: 'avoir_a_verifier', gravite: 'signale', ledgerEntryId: 8001, compte: '445711', description: 'A' },
      { type: 'avoir_a_verifier', gravite: 'signale', ledgerEntryId: 8002, compte: '445712', description: 'B' },
    ];
    const inserees = await avecClient((client) => enregistrerAnomalies(client, dossierId, '2025-10-01', anomalies));
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'Masse1', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `masse1-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);

    const resultat = await avecClient((client) =>
      resoudreAnomaliesEnMasse(
        client,
        inserees.map((a) => a.id),
        utilisateurId,
        'Vérifié en lot, tous des avoirs légitimes'
      )
    );

    expect(resultat.nombreResolues).toBe(2);
    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode: '2025-10-01' }));
    expect(liste.filter((a) => a.statut === 'resolu')).toHaveLength(2);
  });

  it('ignore silencieusement les ids déjà traités, ne compte que ceux réellement résolus', async () => {
    const anomalie: Anomalie = {
      type: 'avoir_a_verifier',
      gravite: 'signale',
      ledgerEntryId: 8003,
      compte: '445711',
      description: 'C',
    };
    const [inseree] = await avecClient((client) => enregistrerAnomalies(client, dossierId, '2025-10-02', [anomalie]));
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'Masse2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `masse2-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);

    await avecClient((client) => resoudreAnomalie(client, inseree!.id, utilisateurId, 'déjà traitée individuellement'));

    const resultat = await avecClient((client) =>
      resoudreAnomaliesEnMasse(client, [inseree!.id], utilisateurId, 'tentative en masse sur du déjà traité')
    );
    expect(resultat.nombreResolues).toBe(0);
  });

  it('liste vide : ne fait rien, ne plante pas', async () => {
    const resultat = await avecClient((client) => resoudreAnomaliesEnMasse(client, [], 'peu-importe', 'x'));
    expect(resultat).toEqual({ dossierId: null, nombreResolues: 0 });
  });
});

describe('assignerTauxHistoriqueTiersManuel', () => {
  it('confirme directement, sans passer par candidate', async () => {
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'TauxTiersManuel', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `tauxtiersmanuel-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);
    const compte = `411manuel${Date.now()}`;

    await avecClient((client) =>
      assignerTauxHistoriqueTiersManuel(client, dossierId, compte, 10, utilisateurId)
    );

    const confirmes = await avecClient((client) => listerTauxHistoriqueTiers(client, dossierId, 'confirmed'));
    const ligne = confirmes.find((c) => c.numeroCompteTiers === compte);
    expect(ligne?.tauxHabituel).toBe(10);
    expect(ligne?.source).toBe('saisie_manuelle');
  });

  it('remplace une assignation manuelle précédente pour le même compte plutôt que d’en créer une seconde', async () => {
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'TauxTiersManuel2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `tauxtiersmanuel2-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);
    const compte = `411manuel2${Date.now()}`;

    await avecClient((client) => assignerTauxHistoriqueTiersManuel(client, dossierId, compte, 20, utilisateurId));
    await avecClient((client) => assignerTauxHistoriqueTiersManuel(client, dossierId, compte, 5.5, utilisateurId));

    const confirmes = await avecClient((client) => listerTauxHistoriqueTiers(client, dossierId, 'confirmed'));
    const pourCeCompte = confirmes.filter((c) => c.numeroCompteTiers === compte);
    expect(pourCeCompte).toHaveLength(1);
    expect(pourCeCompte[0]?.tauxHabituel).toBe(5.5);
  });
});

describe('listerAnomaliesTraiteesParTypeEtPiece', () => {
  it('inclut les anomalies résolues et justifiées, exclut les ouvertes', async () => {
    const periode = '2025-09-01';
    const anomalies: Anomalie[] = [
      { type: 'avoir_a_verifier', gravite: 'signale', ledgerEntryId: 9101, compte: '445711', description: 'A' },
      { type: 'parc_vehicules_non_renseigne', gravite: 'signale', ledgerEntryId: 9102, compte: '6061', description: 'B' },
      { type: 'avoir_a_verifier', gravite: 'signale', ledgerEntryId: 9103, compte: '445711', description: 'C' },
    ];
    const inserees = await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, anomalies));
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'Dedup1', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `dedup1-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);

    const [resolu, justifie] = inserees.filter((a) => a.type === 'avoir_a_verifier');
    await avecClient((client) => resoudreAnomalie(client, resolu!.id, utilisateurId, 'traité'));
    await avecClient((client) => justifierAnomalie(client, justifie!.id, utilisateurId, 'confirmé normal'));
    // La 3e (parc_vehicules_non_renseigne) reste 'ouvert', volontairement.

    const traitees = await avecClient((client) => listerAnomaliesTraiteesParTypeEtPiece(client, dossierId));

    expect(traitees.has('avoir_a_verifier:9101')).toBe(true);
    expect(traitees.has('avoir_a_verifier:9103')).toBe(true);
    expect(traitees.has('parc_vehicules_non_renseigne:9102')).toBe(false);
  });

  it('ne mélange pas deux types différents sur le même numéro de pièce', async () => {
    const periode = '2025-09-02';
    // Deux anomalies de types différents mais avec le même ledgerEntryId
    // (arrive en pratique : plusieurs contrôles peuvent viser la même pièce).
    const anomalies: Anomalie[] = [
      { type: 'avoir_a_verifier', gravite: 'signale', ledgerEntryId: 9200, compte: '445711', description: 'A' },
      { type: 'paiement_partiel_a_verifier', gravite: 'signale', ledgerEntryId: 9200, compte: '445711', description: 'B' },
    ];
    const inserees = await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, anomalies));
    const utilisateurId = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'Dedup2', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `dedup2-${Date.now()}@test.fr`]
      )
    ).then((r) => r.rows[0]!.id);

    const avoir = inserees.find((a) => a.type === 'avoir_a_verifier')!;
    await avecClient((client) => resoudreAnomalie(client, avoir.id, utilisateurId, 'traité'));
    // paiement_partiel_a_verifier reste ouvert, volontairement.

    const traitees = await avecClient((client) => listerAnomaliesTraiteesParTypeEtPiece(client, dossierId));

    expect(traitees.has('avoir_a_verifier:9200')).toBe(true);
    expect(traitees.has('paiement_partiel_a_verifier:9200')).toBe(false);
  });
});

describe('ajusterMontantCalcul et retirerAjustementCalcul', () => {
  // Périodes générées dynamiquement (année très éloignée + compteur), pas de
  // dates fixes — cette base de test partagée a accumulé des dizaines de
  // calculs 'valide' au fil de la session, une date fixe comme '2025-07-01'
  // finit tôt ou tard par entrer en collision avec un test antérieur.
  let compteurPeriode = 0;
  function periodeUnique(): [string, string] {
    compteurPeriode += 1;
    const annee = 2600 + compteurPeriode; // jamais utilisée ailleurs dans ce fichier
    return [`${annee}-01-01`, `${annee}-01-31`];
  }

  async function creerCalculBrouillon(periodeDebut: string, periodeFin: string): Promise<string> {
    const resultat: ResultatCalculTva = {
      lignes: [{ categorie: 'collectee_20', montant: 1000, referencesPieces: [1] }],
      tvaNette: 1000,
      sens: 'a_decaisser',
      ecrituresExclues: [],
    };
    return avecClient((client) => enregistrerCalcul(client, dossierId, periodeDebut, periodeFin, resultat));
  }

  async function creerUtilisateurAjust(): Promise<string> {
    const res = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U Ajust', $2, 'collaborateur') RETURNING id`,
        [cabinetId, `u-ajust-${Date.now()}@test.fr`]
      )
    );
    return res.rows[0]!.id;
  }

  it('ajuste un montant sur un calcul en brouillon, trace l’audit', async () => {
    const calculId = await creerCalculBrouillon(...periodeUnique());
    const utilisateurId = await creerUtilisateurAjust();

    await avecClient((client) =>
      ajusterMontantCalcul(client, calculId, 'collectee_totale', 1000, 1100, 'Facture oubliée', utilisateurId)
    );

    const ajustements = await avecClient((client) => listerAjustementsCalcul(client, calculId));
    expect(ajustements).toEqual([
      {
        typeMontant: 'collectee_totale',
        montantOriginal: 1000,
        montantAjuste: 1100,
        justification: 'Facture oubliée',
        createdAt: expect.any(Date),
      },
    ]);

    const audit = await avecClient((client) =>
      client.query(`SELECT * FROM audit_log WHERE type_evenement = 'montant_calcul_ajuste' AND details->>'calculId' = $1`, [
        calculId,
      ])
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('un ré-ajustement garde le montant_original du tout premier appel', async () => {
    const calculId = await creerCalculBrouillon(...periodeUnique());
    const utilisateurId = await creerUtilisateurAjust();

    await avecClient((client) =>
      ajusterMontantCalcul(client, calculId, 'collectee_totale', 1000, 1100, 'Premier ajustement', utilisateurId)
    );
    await avecClient((client) =>
      ajusterMontantCalcul(client, calculId, 'collectee_totale', 1000, 1200, 'Deuxième ajustement', utilisateurId)
    );

    const ajustements = await avecClient((client) => listerAjustementsCalcul(client, calculId));
    expect(ajustements).toHaveLength(1);
    expect(ajustements[0]).toMatchObject({
      montantOriginal: 1000, // toujours le tout premier, pas 1100
      montantAjuste: 1200,
      justification: 'Deuxième ajustement',
    });
  });

  it('refuse un ajustement sur un calcul déjà validé', async () => {
    const calculId = await creerCalculBrouillon(...periodeUnique());
    const utilisateurId = await creerUtilisateurAjust();
    await avecClient((client) => validerCalcul(client, calculId, utilisateurId));

    await expect(
      avecClient((client) =>
        ajusterMontantCalcul(client, calculId, 'collectee_totale', 1000, 1100, 'Trop tard', utilisateurId)
      )
    ).rejects.toThrow(CalculPlusEnBrouillonError);
  });

  it('retire un ajustement existant, refuse aussi sur un calcul validé', async () => {
    const calculId = await creerCalculBrouillon(...periodeUnique());
    const utilisateurId = await creerUtilisateurAjust();

    await avecClient((client) =>
      ajusterMontantCalcul(client, calculId, 'deductible_totale', 500, 450, 'Correction', utilisateurId)
    );
    await avecClient((client) => retirerAjustementCalcul(client, calculId, 'deductible_totale', utilisateurId));

    const ajustements = await avecClient((client) => listerAjustementsCalcul(client, calculId));
    expect(ajustements).toEqual([]);

    await avecClient((client) => validerCalcul(client, calculId, utilisateurId));
    await expect(
      avecClient((client) => retirerAjustementCalcul(client, calculId, 'deductible_totale', utilisateurId))
    ).rejects.toThrow(CalculPlusEnBrouillonError);
  });
});

describe('definirMotDePasse et trouverUtilisateurPourConnexion', () => {
  it('définit un mot de passe, retrouvable ensuite via authentifier_par_email (RLS contourné exprès)', async () => {
    const emailUnique = `u-auth-${Date.now()}@test.fr`;
    const resUser = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, 'U Auth', $2, 'collaborateur') RETURNING id`,
        [cabinetId, emailUnique]
      )
    );
    const utilisateurId = resUser.rows[0]!.id;

    await avecClient((client) => definirMotDePasse(client, utilisateurId, 'un-hash-quelconque'));

    // trouverUtilisateurPourConnexion doit fonctionner via un client SANS
    // contexte cabinet fixé — c'est exactement le point de cette fonction.
    const provisioningPoolLocal = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
    const clientBrut = await provisioningPoolLocal.connect();
    let trouve;
    try {
      trouve = await trouverUtilisateurPourConnexion(clientBrut, emailUnique);
    } finally {
      clientBrut.release();
      await provisioningPoolLocal.end();
    }

    expect(trouve).toMatchObject({
      id: utilisateurId,
      cabinetId,
      role: 'collaborateur',
      motDePasseHash: 'un-hash-quelconque',
      statut: 'actif',
    });
  });

  it('retourne null pour un email inconnu', async () => {
    const provisioningPoolLocal = new pg.Pool({ connectionString: PROVISIONING_CONNECTION_STRING });
    const clientBrut = await provisioningPoolLocal.connect();
    let trouve;
    try {
      trouve = await trouverUtilisateurPourConnexion(clientBrut, `inconnu-${Date.now()}@test.fr`);
    } finally {
      clientBrut.release();
      await provisioningPoolLocal.end();
    }
    expect(trouve).toBeNull();
  });

  it('définir un mot de passe pour un id inexistant échoue proprement', async () => {
    await expect(
      avecClient((client) => definirMotDePasse(client, '00000000-0000-0000-0000-000000000000', 'x'))
    ).rejects.toThrow(/introuvable/);
  });
});

describe('desactiverUtilisateurCabinet', () => {
  async function creerAdmin(nom: string): Promise<string> {
    const res = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, $2, $3, 'admin_cabinet') RETURNING id`,
        [cabinetId, nom, `${nom.toLowerCase()}-${Date.now()}@test.fr`]
      )
    );
    return res.rows[0]!.id;
  }

  async function creerCollab(nom: string): Promise<string> {
    const res = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO utilisateurs (cabinet_id, nom, email, role) VALUES ($1, $2, $3, 'collaborateur') RETURNING id`,
        [cabinetId, nom, `${nom.toLowerCase()}-${Date.now()}@test.fr`]
      )
    );
    return res.rows[0]!.id;
  }

  it('désactive un collaborateur normalement (statut -> inactif, pas supprimé)', async () => {
    const collabId = await creerCollab('DesactiverCollab');
    await avecClient((client) => desactiverUtilisateurCabinet(client, cabinetId, collabId));

    const res = await avecClient((client) =>
      client.query<{ statut: string }>(`SELECT statut FROM utilisateurs WHERE id = $1`, [collabId])
    );
    expect(res.rows[0]?.statut).toBe('inactif');
  });

  it('refuse de désactiver le dernier admin_cabinet actif du cabinet', async () => {
    // Compte le nombre d'admin déjà actifs, désactive tous sauf le dernier
    const admin1 = await creerAdmin('DernierAdmin1');
    await expect(
      (async () => {
        // Désactive tous les AUTRES admins actifs pour isoler le cas "il n'en reste qu'un"
        const autresAdmins = await avecClient((client) =>
          client.query<{ id: string }>(
            `SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND role = 'admin_cabinet' AND statut = 'actif' AND id != $2`,
            [cabinetId, admin1]
          )
        );
        for (const row of autresAdmins.rows) {
          await avecClient((client) => desactiverUtilisateurCabinet(client, cabinetId, row.id));
        }
        // À ce stade, admin1 est le seul admin actif restant
        await avecClient((client) => desactiverUtilisateurCabinet(client, cabinetId, admin1));
      })()
    ).rejects.toThrow(DernierAdminCabinetError);
  });

  it('permet de désactiver un admin_cabinet s’il en reste un autre actif', async () => {
    const admin1 = await creerAdmin('AutreAdmin1');
    const admin2 = await creerAdmin('AutreAdmin2');
    await avecClient((client) => desactiverUtilisateurCabinet(client, cabinetId, admin1));

    const res = await avecClient((client) =>
      client.query<{ statut: string }>(`SELECT statut FROM utilisateurs WHERE id = $1`, [admin1])
    );
    expect(res.rows[0]?.statut).toBe('inactif');

    // admin2 reste actif, non affecté
    const res2 = await avecClient((client) =>
      client.query<{ statut: string }>(`SELECT statut FROM utilisateurs WHERE id = $1`, [admin2])
    );
    expect(res2.rows[0]?.statut).toBe('actif');
  });

  it('échoue proprement pour un id inexistant', async () => {
    await expect(
      avecClient((client) =>
        desactiverUtilisateurCabinet(client, cabinetId, '00000000-0000-0000-0000-000000000000')
      )
    ).rejects.toThrow(/introuvable/);
  });
});

describe('synchroniserDossiersCabinet', () => {
  it('crée un nouveau dossier avec statut onboarding et regime_tva par défaut', async () => {
    const idExterne = `pennylane-sync-${Date.now()}`;
    const resultat = await avecClient((client) =>
      synchroniserDossiersCabinet(client, cabinetId, [{ id: idExterne, nom: 'Nouveau Dossier Sync', siren: '111222333' }])
    );

    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.nouveau).toBe(true);
    expect(resultat[0]?.nom).toBe('Nouveau Dossier Sync');

    const ligne = await avecClient((client) =>
      client.query(`SELECT statut, regime_tva, siren FROM dossiers WHERE id = $1`, [resultat[0]!.id])
    );
    expect(ligne.rows[0]?.statut).toBe('onboarding');
    expect(ligne.rows[0]?.regime_tva).toBe('reel_normal');
    expect(ligne.rows[0]?.siren).toBe('111222333');
  });

  it('met à jour nom/siren d’un dossier déjà connu, sans jamais toucher regime_tva/statut', async () => {
    const idExterne = `pennylane-sync-existant-${Date.now()}`;

    const premiereSync = await avecClient((client) =>
      synchroniserDossiersCabinet(client, cabinetId, [{ id: idExterne, nom: 'Nom Initial', siren: null }])
    );
    expect(premiereSync[0]?.nouveau).toBe(true);

    // Simule une configuration humaine faite entre-temps : régime réel simplifié, dossier passé actif
    await avecClient((client) =>
      client.query(`UPDATE dossiers SET regime_tva = 'reel_simplifie', statut = 'actif' WHERE id = $1`, [
        premiereSync[0]!.id,
      ])
    );

    const secondeSync = await avecClient((client) =>
      synchroniserDossiersCabinet(client, cabinetId, [{ id: idExterne, nom: 'Nom Mis À Jour', siren: '999888777' }])
    );
    expect(secondeSync[0]?.nouveau).toBe(false);
    expect(secondeSync[0]?.id).toBe(premiereSync[0]?.id); // même dossier, pas un doublon

    const ligne = await avecClient((client) =>
      client.query(`SELECT nom, siren, regime_tva, statut FROM dossiers WHERE id = $1`, [premiereSync[0]!.id])
    );
    expect(ligne.rows[0]?.nom).toBe('Nom Mis À Jour');
    expect(ligne.rows[0]?.siren).toBe('999888777');
    // Jamais écrasés par la synchronisation, malgré le defaut different envoye a l'insertion initiale
    expect(ligne.rows[0]?.regime_tva).toBe('reel_simplifie');
    expect(ligne.rows[0]?.statut).toBe('actif');
  });

  it('traite plusieurs dossiers en un seul appel', async () => {
    const suffixe = Date.now();
    const resultat = await avecClient((client) =>
      synchroniserDossiersCabinet(client, cabinetId, [
        { id: `multi-a-${suffixe}`, nom: 'A', siren: null },
        { id: `multi-b-${suffixe}`, nom: 'B', siren: null },
      ])
    );
    expect(resultat).toHaveLength(2);
    expect(resultat.every((r) => r.nouveau)).toBe(true);
  });
});

describe('configurerDossierOnboarding', () => {
  async function creerDossierOnboarding(nom: string): Promise<string> {
    const res = await avecClient((client) =>
      client.query<{ id: string }>(
        `INSERT INTO dossiers (cabinet_id, nom, regime_tva, logiciel_source, external_company_id, tva_encaissement)
         VALUES ($1, $2, 'reel_normal', 'pennylane', $3, false)
         RETURNING id`,
        [cabinetId, nom, `onboarding-test-${Date.now()}-${Math.random()}`]
      )
    );
    return res.rows[0]!.id;
  }

  it('configure un dossier onboarding et le passe à actif', async () => {
    const dossierOnboardingId = await creerDossierOnboarding('Dossier Onboarding Test');

    await avecClient((client) =>
      configurerDossierOnboarding(client, dossierOnboardingId, 'reel_simplifie', 'trimestrielle', true)
    );

    const ligne = await avecClient((client) =>
      client.query(
        `SELECT statut, regime_tva, periodicite_declaration, tva_encaissement, date_onboarding FROM dossiers WHERE id = $1`,
        [dossierOnboardingId]
      )
    );
    expect(ligne.rows[0]?.statut).toBe('actif');
    expect(ligne.rows[0]?.regime_tva).toBe('reel_simplifie');
    expect(ligne.rows[0]?.periodicite_declaration).toBe('trimestrielle');
    expect(ligne.rows[0]?.tva_encaissement).toBe(true);
    expect(ligne.rows[0]?.date_onboarding).not.toBeNull();
  });

  it('échoue proprement pour un dossier inexistant', async () => {
    await expect(
      avecClient((client) =>
        configurerDossierOnboarding(client, '00000000-0000-0000-0000-000000000000', 'reel_normal', 'mensuelle', false)
      )
    ).rejects.toThrow(DossierIntrouvableError);
  });

  it('peut aussi corriger un dossier déjà actif, sans écraser date_onboarding déjà fixée', async () => {
    const dossierId2 = await creerDossierOnboarding('Dossier Deja Actif');
    await avecClient((client) =>
      configurerDossierOnboarding(client, dossierId2, 'reel_normal', 'mensuelle', false)
    );
    const premiereDate = (
      await avecClient((client) => client.query(`SELECT date_onboarding FROM dossiers WHERE id = $1`, [dossierId2]))
    ).rows[0]?.date_onboarding;

    await avecClient((client) =>
      configurerDossierOnboarding(client, dossierId2, 'franchise', 'mensuelle', false)
    );
    const ligne = await avecClient((client) =>
      client.query(`SELECT regime_tva, date_onboarding FROM dossiers WHERE id = $1`, [dossierId2])
    );
    expect(ligne.rows[0]?.regime_tva).toBe('franchise');
    expect(new Date(ligne.rows[0]?.date_onboarding).getTime()).toBe(new Date(premiereDate).getTime());
  });
});

describe('definirStatutDossier', () => {
  it('désactive un dossier avec un motif', async () => {
    await avecClient((client) =>
      definirStatutDossier(client, dossierId, 'inactif', 'Régime spécial, hors périmètre TVA Contrôle')
    );
    const ligne = await avecClient((client) =>
      client.query(`SELECT statut, motif_desactivation FROM dossiers WHERE id = $1`, [dossierId])
    );
    expect(ligne.rows[0]?.statut).toBe('inactif');
    expect(ligne.rows[0]?.motif_desactivation).toBe('Régime spécial, hors périmètre TVA Contrôle');

    // Remet dans l'état d'avant pour ne pas casser les autres tests du fichier
    await avecClient((client) => definirStatutDossier(client, dossierId, 'actif'));
  });

  it('réactiver efface le motif de désactivation', async () => {
    await avecClient((client) => definirStatutDossier(client, dossierId, 'inactif', 'Test temporaire'));
    await avecClient((client) => definirStatutDossier(client, dossierId, 'actif'));

    const ligne = await avecClient((client) =>
      client.query(`SELECT statut, motif_desactivation FROM dossiers WHERE id = $1`, [dossierId])
    );
    expect(ligne.rows[0]?.statut).toBe('actif');
    expect(ligne.rows[0]?.motif_desactivation).toBeNull();
  });

  it('échoue proprement pour un dossier inexistant', async () => {
    await expect(
      avecClient((client) =>
        definirStatutDossier(client, '00000000-0000-0000-0000-000000000000', 'inactif')
      )
    ).rejects.toThrow(DossierIntrouvableError);
  });
});

describe('mettreAJourInfosDossier', () => {
  it('met à jour uniquement les champs fournis, sans effacer le reste', async () => {
    await avecClient((client) =>
      mettreAJourInfosDossier(client, dossierId, {
        siret: '36252187900012',
        formeJuridique: 'SASU',
        fiscalite: 'is',
      })
    );

    let ligne = await avecClient((client) =>
      client.query(`SELECT siret, forme_juridique, fiscalite, comptabilite FROM dossiers WHERE id = $1`, [
        dossierId,
      ])
    );
    expect(ligne.rows[0]?.siret).toBe('36252187900012');
    expect(ligne.rows[0]?.forme_juridique).toBe('SASU');
    expect(ligne.rows[0]?.fiscalite).toBe('is');
    expect(ligne.rows[0]?.comptabilite).toBeNull();

    // Deuxième appel, un seul champ différent : le reste doit rester intact
    await avecClient((client) => mettreAJourInfosDossier(client, dossierId, { comptabilite: 'engagement' }));

    ligne = await avecClient((client) =>
      client.query(`SELECT siret, forme_juridique, comptabilite FROM dossiers WHERE id = $1`, [dossierId])
    );
    expect(ligne.rows[0]?.siret).toBe('36252187900012'); // toujours là
    expect(ligne.rows[0]?.comptabilite).toBe('engagement');
  });

  it('ne fait rien (jamais une erreur) si aucun champ fourni', async () => {
    await expect(avecClient((client) => mettreAJourInfosDossier(client, dossierId, {}))).resolves.not.toThrow();
  });

  it('échoue proprement pour un dossier inexistant', async () => {
    await expect(
      avecClient((client) =>
        mettreAJourInfosDossier(client, '00000000-0000-0000-0000-000000000000', { siret: 'x' })
      )
    ).rejects.toThrow(DossierIntrouvableError);
  });
});

describe('enregistrerAnomaliesPartielles', () => {
  it('ne touche JAMAIS les anomalies ouvertes d’un autre type — le vrai risque à couvrir', async () => {
    const periode = '2025-06-01';
    // Simule un cycle complet initial avec deux types d'anomalies différents
    const lotComplet: Anomalie[] = [
      { type: 'compte_tva_non_reconnu', gravite: 'bloquant', ledgerEntryId: 200, compte: '4452', description: 'x' },
      {
        type: 'nouveau_tiers_a_verifier',
        gravite: 'signale',
        ledgerEntryId: 201,
        compte: '411AUTRE',
        description: 'jamais réexaminé par la vérification ciblée',
      },
    ];
    await avecClient((client) => enregistrerAnomalies(client, dossierId, periode, lotComplet));

    // Vérification ciblée : le compte 4452 est maintenant reconnu (0
    // nouvelle anomalie de ce type), mais on ne réexamine QUE ce type.
    await avecClient((client) =>
      enregistrerAnomaliesPartielles(client, dossierId, periode, ['compte_tva_non_reconnu'], [])
    );

    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode }));
    const listeAvecObsoletes = await avecClient((client) =>
      listerAnomalies(client, dossierId, { periode, statut: 'obsolete' })
    );
    const compteNonReconnu = listeAvecObsoletes.find((a) => a.typeAnomalie === 'compte_tva_non_reconnu');
    const nouveauTiers = liste.find((a) => a.typeAnomalie === 'nouveau_tiers_a_verifier');

    expect(compteNonReconnu?.statut).toBe('obsolete'); // résolu, remplacé par rien (liste vide) — exclu par défaut, demandé explicitement ici
    expect(nouveauTiers?.statut).toBe('ouvert'); // jamais touché, toujours valable
  });

  it('insère les nouvelles anomalies du type vérifié normalement', async () => {
    const periode = '2025-06-02';
    const nouvellesAnomalies: Anomalie[] = [
      { type: 'compte_tva_non_reconnu', gravite: 'bloquant', ledgerEntryId: 300, compte: '4453', description: 'z' },
    ];

    const inserees = await avecClient((client) =>
      enregistrerAnomaliesPartielles(client, dossierId, periode, ['compte_tva_non_reconnu'], nouvellesAnomalies)
    );

    expect(inserees).toHaveLength(1);
    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode }));
    expect(liste.some((a) => a.typeAnomalie === 'compte_tva_non_reconnu' && a.statut === 'ouvert')).toBe(true);
  });

  it('préserve une anomalie déjà résolue/justifiée du même type, comme enregistrerAnomalies', async () => {
    const periode = '2025-06-03';
    const premierLot: Anomalie[] = [
      { type: 'compte_tva_non_reconnu', gravite: 'bloquant', ledgerEntryId: 400, compte: '4454', description: 'a' },
    ];
    const inserees = await avecClient((client) =>
      enregistrerAnomaliesPartielles(client, dossierId, periode, ['compte_tva_non_reconnu'], premierLot)
    );
    await avecClient((client) =>
      client.query(`UPDATE anomalies SET statut = 'resolu' WHERE id = $1`, [inserees[0]!.id])
    );

    await avecClient((client) =>
      enregistrerAnomaliesPartielles(client, dossierId, periode, ['compte_tva_non_reconnu'], [])
    );

    const liste = await avecClient((client) => listerAnomalies(client, dossierId, { periode }));
    expect(liste.find((a) => a.id === inserees[0]!.id)?.statut).toBe('resolu'); // jamais repassée a obsolete
  });
});
