import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { PennylaneClient } from '@tva-controle/connector-pennylane';
import {
  avecContexteCabinet,
  executerCycleTva,
  resoudreAnomalie,
  justifierAnomalie,
  qualifierEncaissementNonAffecte,
  AnomalieNonQualifiableError,
  ajouterConventionManuelle,
  confirmerConvention,
  rejeterConvention,
  retirerCompteConvention,
  confirmerTauxHistorique,
  rejeterTauxHistorique,
  listerTauxHistoriqueTiers,
  confirmerTauxHistoriqueTiers,
  rejeterTauxHistoriqueTiers,
  listerTiersReference,
  corrigerNiveauConfianceTiers,
  validerCalcul,
  rejeterCalcul,
  listerAnomalies,
  listerConventions,
  listerTauxHistorique,
  listerCalculs,
  listerAuditLog,
  listerAuditLogPourExport,
  CalculDejaValideError,
  CalculPasEnBrouillonError,
  definirParametreCabinet,
  definirParametreDossier,
  listerDossiers,
  listerElementsATraiter,
  listerParametresCabinet,
  listerParametresDossier,
  type AuditEvenementDb,
} from '@tva-controle/orchestrateur-module9';

// Pas d'authentification construite à ce stade — le cabinet est identifié
// par un header explicite plutôt que deviné. Stand-in volontaire en
// attendant une vraie couche d'auth (hors scope de ce module).
const HEADER_CABINET = 'x-cabinet-id';

// Échappement CSV minimal (RFC 4180) : entoure de guillemets et double les
// guillemets internes dès qu'une valeur contient une virgule, un guillemet
// ou un retour à la ligne — sinon la valeur brute suffit.
function celluleCsv(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  const texte = typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
  if (/[",\n]/.test(texte)) {
    return `"${texte.replace(/"/g, '""')}"`;
  }
  return texte;
}

function versCsv(evenements: AuditEvenementDb[]): string {
  const entetes = [
    'horodatage',
    'type_evenement',
    'module_source',
    'acteur',
    'acteur_nom',
    'acteur_utilisateur_id',
    'details',
  ];
  const lignes = evenements.map((e) =>
    [e.horodatage, e.typeEvenement, e.moduleSource, e.acteur, e.acteurNom, e.acteurUtilisateurId, e.details]
      .map(celluleCsv)
      .join(',')
  );
  return [entetes.join(','), ...lignes].join('\n');
}

export function buildApp(pool: Pool): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health') return;
    const cabinetId = request.headers[HEADER_CABINET];
    if (!cabinetId || typeof cabinetId !== 'string') {
      return reply.code(400).send({ erreur: `Header ${HEADER_CABINET} requis` });
    }
  });

  app.get('/health', async () => ({ statut: 'ok' }));

  // --- Anomalies ---
  app.get<{ Params: { dossierId: string }; Querystring: { statut?: string; periode?: string } }>(
    '/dossiers/:dossierId/anomalies',
    async (request) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      return avecContexteCabinet(pool, cabinetId, (client) =>
        listerAnomalies(client, request.params.dossierId, request.query)
      );
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string; commentaire?: string } }>(
    '/anomalies/:id/resoudre',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        resoudreAnomalie(client, request.params.id, request.body.utilisateurId, request.body.commentaire)
      );
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string; commentaire: string } }>(
    '/anomalies/:id/justifier',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        justifierAnomalie(client, request.params.id, request.body.utilisateurId, request.body.commentaire)
      );
      reply.code(204).send();
    }
  );

  // Qualification spécifique aux anomalies 'encaissement_non_affecte'
  // (compte d'attente 471) : décision structurée (vente+taux, ou hors
  // vente+motif), pas juste un commentaire libre — cf. qualifierEncaissementNonAffecte.
  app.post<{
    Params: { id: string };
    Body: { utilisateurId: string } & (
      | { decision: 'vente'; taux: number }
      | { decision: 'hors_vente'; motif: string }
    );
  }>('/anomalies/:id/qualifier', async (request, reply) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    const { utilisateurId, ...qualification } = request.body;
    if (qualification.decision === 'vente' && typeof qualification.taux !== 'number') {
      return reply.code(400).send({ erreur: 'taux (nombre) requis pour une qualification "vente"' });
    }
    if (qualification.decision === 'hors_vente' && !qualification.motif) {
      return reply.code(400).send({ erreur: 'motif requis pour une qualification "hors_vente"' });
    }
    try {
      await avecContexteCabinet(pool, cabinetId, (client) =>
        qualifierEncaissementNonAffecte(client, request.params.id, utilisateurId, qualification)
      );
      reply.code(204).send();
    } catch (err) {
      if (err instanceof AnomalieNonQualifiableError) {
        return reply.code(409).send({ erreur: err.message });
      }
      throw err;
    }
  });

  // --- Conventions dossier ---
  app.get<{ Params: { dossierId: string }; Querystring: { statut?: string } }>(
    '/dossiers/:dossierId/conventions',
    async (request) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      return avecContexteCabinet(pool, cabinetId, (client) =>
        listerConventions(client, request.params.dossierId, request.query.statut)
      );
    }
  );

  // Saisie manuelle d'une convention (typiquement une des 4 conventions de
  // comptes non couvertes par la découverte automatique du Module 3 :
  // comptes_vente_service, comptes_charge_service, comptes_equipement,
  // comptes_carburant). Reste 'candidate' — voir ajouterConventionManuelle.
  app.post<{ Params: { dossierId: string }; Body: { utilisateurId: string; cle: string; valeur: unknown } }>(
    '/dossiers/:dossierId/conventions',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      const { utilisateurId, cle, valeur } = request.body;
      if (!utilisateurId || !cle || valeur === undefined) {
        return reply.code(400).send({ erreur: 'utilisateurId, cle et valeur sont requis' });
      }
      const id = await avecContexteCabinet(pool, cabinetId, (client) =>
        ajouterConventionManuelle(client, request.params.dossierId, utilisateurId, cle, valeur)
      );
      reply.code(201).send({ id });
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/conventions/:id/confirmer',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        confirmerConvention(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/conventions/:id/rejeter',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        rejeterConvention(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  // Retire un compte d'une convention de type liste déjà confirmée (ex:
  // comptes_charge_service) — pas de nouveau cycle candidate/confirmed,
  // UPDATE direct. dossierId + cle dans le corps car ce n'est pas une
  // ligne précise qu'on cible mais une clé de convention pour ce dossier.
  app.post<{ Body: { dossierId: string; cle: string; compte: string; utilisateurId: string } }>(
    '/conventions/retirer-compte',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      const { dossierId, cle, compte, utilisateurId } = request.body;
      try {
        await avecContexteCabinet(pool, cabinetId, (client) =>
          retirerCompteConvention(client, dossierId, cle, compte, utilisateurId)
        );
        reply.code(204).send();
      } catch (err) {
        if (err instanceof Error && err.message.includes('Aucune convention confirmée')) {
          return reply.code(404).send({ erreur: err.message });
        }
        throw err;
      }
    }
  );

  // --- Taux historique ---
  app.get<{ Params: { dossierId: string }; Querystring: { statut?: string } }>(
    '/dossiers/:dossierId/taux-historique',
    async (request) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      return avecContexteCabinet(pool, cabinetId, (client) =>
        listerTauxHistorique(client, request.params.dossierId, request.query.statut)
      );
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/taux-historique/:id/confirmer',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        confirmerTauxHistorique(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/taux-historique/:id/rejeter',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        rejeterTauxHistorique(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  // --- Taux historique tiers (chantier B — compte client 411xxx, table
  // séparée de taux_historique mais même écran côté frontend : le typage
  // compte/tiers ne se chevauche jamais, cf. dossierRepository.ts) ---
  app.get<{ Params: { dossierId: string }; Querystring: { statut?: string } }>(
    '/dossiers/:dossierId/taux-historique-tiers',
    async (request) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      return avecContexteCabinet(pool, cabinetId, (client) =>
        listerTauxHistoriqueTiers(client, request.params.dossierId, request.query.statut)
      );
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/taux-historique-tiers/:id/confirmer',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        confirmerTauxHistoriqueTiers(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/taux-historique-tiers/:id/rejeter',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        rejeterTauxHistoriqueTiers(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  // --- Tiers de référence (mémoire de confiance — Module 9) ---
  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/tiers', async (request) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    return avecContexteCabinet(pool, cabinetId, (client) => listerTiersReference(client, request.params.dossierId));
  });

  // Correction manuelle du niveau de confiance : la progression automatique
  // reste la voie normale, ceci est l'exception pour une information directe
  // du collaborateur.
  app.post<{
    Params: { dossierId: string };
    Body: { numeroCompteTiers: string; niveauConfiance: 'nouveau' | 'a_surveiller' | 'confiance'; utilisateurId: string };
  }>('/dossiers/:dossierId/tiers/corriger', async (request, reply) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    const { numeroCompteTiers, niveauConfiance, utilisateurId } = request.body;
    try {
      await avecContexteCabinet(pool, cabinetId, (client) =>
        corrigerNiveauConfianceTiers(client, request.params.dossierId, numeroCompteTiers, niveauConfiance, utilisateurId)
      );
      reply.code(204).send();
    } catch (err) {
      if (err instanceof Error && err.message.includes('introuvable')) {
        return reply.code(404).send({ erreur: err.message });
      }
      throw err;
    }
  });

  // --- Calculs ---
  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/calculs', async (request) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    return avecContexteCabinet(pool, cabinetId, (client) => listerCalculs(client, request.params.dossierId));
  });

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/calculs/:id/valider',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      try {
        await avecContexteCabinet(pool, cabinetId, (client) =>
          validerCalcul(client, request.params.id, request.body.utilisateurId)
        );
        reply.code(204).send();
      } catch (err) {
        if (err instanceof CalculPasEnBrouillonError) {
          return reply.code(409).send({ erreur: err.message });
        }
        throw err;
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string; motif: string } }>(
    '/calculs/:id/rejeter',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      if (!request.body.motif) {
        return reply.code(400).send({ erreur: 'motif requis pour rejeter un calcul' });
      }
      try {
        await avecContexteCabinet(pool, cabinetId, (client) =>
          rejeterCalcul(client, request.params.id, request.body.utilisateurId, request.body.motif)
        );
        reply.code(204).send();
      } catch (err) {
        if (err instanceof CalculPasEnBrouillonError) {
          return reply.code(409).send({ erreur: err.message });
        }
        throw err;
      }
    }
  );

  // --- Audit (Module 10) ---
  app.get<{
    Params: { dossierId: string };
    Querystring: { typeEvenement?: string; acteur?: string; depuis?: string; jusqua?: string; limite?: string };
  }>('/dossiers/:dossierId/audit', async (request) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    const { typeEvenement, acteur, depuis, jusqua, limite } = request.query;
    return avecContexteCabinet(pool, cabinetId, (client) =>
      listerAuditLog(client, request.params.dossierId, {
        ...(typeEvenement ? { typeEvenement } : {}),
        ...(acteur ? { acteur } : {}),
        ...(depuis ? { depuis } : {}),
        ...(jusqua ? { jusqua } : {}),
        ...(limite ? { limite: Number.parseInt(limite, 10) } : {}),
      })
    );
  });

  app.get<{
    Params: { dossierId: string };
    Querystring: { typeEvenement?: string; acteur?: string; depuis?: string; jusqua?: string };
  }>('/dossiers/:dossierId/audit/export', async (request, reply) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    const { typeEvenement, acteur, depuis, jusqua } = request.query;
    const evenements = await avecContexteCabinet(pool, cabinetId, (client) =>
      listerAuditLogPourExport(client, request.params.dossierId, {
        ...(typeEvenement ? { typeEvenement } : {}),
        ...(acteur ? { acteur } : {}),
        ...(depuis ? { depuis } : {}),
        ...(jusqua ? { jusqua } : {}),
      })
    );
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="audit-${request.params.dossierId}.csv"`)
      .send(versCsv(evenements));
  });

  // --- Déclenchement d'un cycle réel (Module 9) ---
  // Simplification v1 assumée : le token Pennylane est passé directement
  // dans le corps de la requête, faute de résolution via connexions_api /
  // secret manager (pas construit). Ne pas reproduire ce pattern une fois
  // qu'une vraie gestion de secrets existera.
  app.post<{
    Params: { dossierId: string };
    Body: {
      periodeDebut: string;
      periodeFin: string;
      pennylaneToken: string;
      comptesVenteService?: string[];
      comptesChargeService?: string[];
      comptesEquipement?: string[];
      comptesCarburant?: string[];
    };
  }>('/dossiers/:dossierId/cycles', async (request, reply) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    const { periodeDebut, periodeFin, pennylaneToken, ...overrides } = request.body;

    if (!periodeDebut || !periodeFin || !pennylaneToken) {
      return reply.code(400).send({ erreur: 'periodeDebut, periodeFin et pennylaneToken sont requis' });
    }
    if (periodeFin < periodeDebut) {
      return reply.code(400).send({ erreur: 'periodeFin ne peut pas être antérieure à periodeDebut' });
    }

    const pennylaneClient = new PennylaneClient({ token: pennylaneToken });

    try {
      const resultat = await executerCycleTva(pool, {
        cabinetId,
        dossierId: request.params.dossierId,
        periodeDebut,
        periodeFin,
        client: pennylaneClient,
        ...(overrides.comptesVenteService ? { comptesVenteServiceOverride: overrides.comptesVenteService } : {}),
        ...(overrides.comptesChargeService
          ? { comptesChargeServiceOverride: overrides.comptesChargeService }
          : {}),
        ...(overrides.comptesEquipement ? { comptesEquipementOverride: overrides.comptesEquipement } : {}),
        ...(overrides.comptesCarburant ? { comptesCarburantOverride: overrides.comptesCarburant } : {}),
      });

      return resultat;
    } catch (err) {
      if (err instanceof CalculDejaValideError) {
        return reply.code(409).send({ erreur: err.message });
      }
      throw err;
    }
  });

  // --- Paramétrage cabinet (ex: clé API Mistral — présence = LLM activé) ---
  app.get('/parametres-cabinet', async (request) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    // listerParametresCabinet masque déjà les valeurs secrètes (ex:
    // mistral_api_key) avant de sortir de la couche DB — jamais de valeur en
    // clair à masquer ici, la garantie vient d'une seule source.
    return avecContexteCabinet(pool, cabinetId, (client) => listerParametresCabinet(client, cabinetId));
  });

  app.put<{ Body: { utilisateurId: string; cle: string; valeur: unknown } }>(
    '/parametres-cabinet',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      const { utilisateurId, cle, valeur } = request.body;
      if (!cle) {
        return reply.code(400).send({ erreur: 'cle requise' });
      }
      await avecContexteCabinet(pool, cabinetId, (client) =>
        definirParametreCabinet(client, cabinetId, cle, valeur, utilisateurId)
      );
      reply.code(204).send();
    }
  );

  // --- Paramétrage dossier (ex: désactivation d'un contrôle pour ce dossier) ---
  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/parametres', async (request) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    return avecContexteCabinet(pool, cabinetId, (client) =>
      listerParametresDossier(client, request.params.dossierId)
    );
  });

  app.put<{ Params: { dossierId: string }; Body: { utilisateurId: string; cle: string; valeur: unknown } }>(
    '/dossiers/:dossierId/parametres',
    async (request, reply) => {
      const cabinetId = request.headers[HEADER_CABINET] as string;
      const { utilisateurId, cle, valeur } = request.body;
      if (!cle) {
        return reply.code(400).send({ erreur: 'cle requise' });
      }
      await avecContexteCabinet(pool, cabinetId, (client) =>
        definirParametreDossier(client, request.params.dossierId, cle, valeur, utilisateurId)
      );
      reply.code(204).send();
    }
  );

  // --- Liste/recherche de dossiers pour un cabinet ---
  app.get<{ Querystring: { q?: string } }>('/dossiers', async (request) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    return avecContexteCabinet(pool, cabinetId, (client) => listerDossiers(client, cabinetId, request.query.q));
  });

  // --- Tout ce qui attend une décision humaine sur ce dossier ---
  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/a-traiter', async (request) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    return avecContexteCabinet(pool, cabinetId, (client) =>
      listerElementsATraiter(client, request.params.dossierId)
    );
  });

  return app;
}
