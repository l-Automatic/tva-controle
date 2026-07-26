import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  avecContexteCabinet,
  resoudreAnomalie,
  justifierAnomalie,
  confirmerConvention,
  rejeterConvention,
  confirmerTauxHistorique,
  rejeterTauxHistorique,
  validerCalcul,
  listerAnomalies,
  listerConventions,
  listerTauxHistorique,
  listerCalculs,
} from '@tva-controle/orchestrateur-module9';

// Pas d'authentification construite à ce stade — le cabinet est identifié
// par un header explicite plutôt que deviné. Stand-in volontaire en
// attendant une vraie couche d'auth (hors scope de ce module).
const HEADER_CABINET = 'x-cabinet-id';

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

  app.post<{ Params: { id: string } }>('/conventions/:id/rejeter', async (request, reply) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    await avecContexteCabinet(pool, cabinetId, (client) => rejeterConvention(client, request.params.id));
    reply.code(204).send();
  });

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

  app.post<{ Params: { id: string } }>('/taux-historique/:id/rejeter', async (request, reply) => {
    const cabinetId = request.headers[HEADER_CABINET] as string;
    await avecContexteCabinet(pool, cabinetId, (client) => rejeterTauxHistorique(client, request.params.id));
    reply.code(204).send();
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
      await avecContexteCabinet(pool, cabinetId, (client) =>
        validerCalcul(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  return app;
}
