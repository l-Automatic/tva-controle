import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  FirmApiClient,
  fetchDossiersCabinet,
  type IPennylaneApiClient,
} from '@tva-controle/connector-pennylane';
import {
  avecContexteCabinet,
  executerCycleTva,
  analyserMotifNumerotationFacture,
  ClefMistralAbsenteError,
  resoudreAnomalie,
  resoudreAnomaliesEnMasse,
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
  assignerTauxHistoriqueTiersManuel,
  rejeterTauxHistoriqueTiers,
  listerTiersReference,
  corrigerNiveauConfianceTiers,
  ajouterVehiculeManuel,
  retirerVehicule,
  listerVehicules,
  type VehiculeManuel,
  assignerTauxCompte,
  listerTauxAssignes,
  type TauxAssigne,
  validerCalcul,
  rejeterCalcul,
  listerAnomalies,
  listerConventions,
  listerTauxHistorique,
  listerCalculs,
  listerAuditLog,
  listerAuditLogPourExport,
  CalculDejaValideError,
  ajusterMontantCalcul,
  retirerAjustementCalcul,
  listerAjustementsCalcul,
  CalculPlusEnBrouillonError,
  CalculPasEnBrouillonError,
  definirParametreCabinet,
  definirParametreDossier,
  listerDossiers,
  listerElementsATraiter,
  listerParametresCabinet,
  listerParametresDossier,
  type AuditEvenementDb,
  trouverUtilisateurPourConnexion,
  definirMotDePasse,
  creerUtilisateurCabinet,
  EmailDejaUtiliseError,
  desactiverUtilisateurCabinet,
  DernierAdminCabinetError,
  listerUtilisateursCabinet,
  parametreCabinetValeur,
  synchroniserDossiersCabinet,
  hasherMotDePasse,
  verifierMotDePasse,
  creerJeton,
  verifierJeton,
  type PayloadJeton,
  chargerDossier,
} from '@tva-controle/orchestrateur-module9';

// Authentification (10/08) — remplace l'ancien stand-in (header cabinet non
// vérifié, jamais une vraie preuve d'identité). Décision explicite de Rami :
// aller vite, sans dépendance externe, un secret HMAC suffit — pas de
// bibliothèque JWT, cf. auth.ts (orchestrateur-module9).
const JWT_SECRET = process.env.JWT_SECRET ?? 'CHANGE_ME_JWT_SECRET_EN_PRODUCTION';
if (JWT_SECRET === 'CHANGE_ME_JWT_SECRET_EN_PRODUCTION') {
  console.warn(
    '[AVERTISSEMENT] JWT_SECRET non défini — secret par défaut utilisé, ' +
      'à ne JAMAIS utiliser en production. Définir la variable d\'environnement JWT_SECRET.'
  );
}

declare module 'fastify' {
  interface FastifyRequest {
    // Renseigné par le middleware d'authentification global (preHandler
    // ci-dessous) une fois le jeton vérifié — jamais avant, jamais par le
    // client lui-même.
    utilisateur?: PayloadJeton;
  }
}

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

  // Routes publiques : la connexion elle-même, et le contrôle de vie du
  // service. Tout le reste exige un jeton valide.
  const ROUTES_PUBLIQUES = new Set(['/health', '/auth/login']);

  app.addHook('preHandler', async (request, reply) => {
    if (ROUTES_PUBLIQUES.has(request.url.split('?')[0]!)) return;

    const enTete = request.headers['authorization'];
    if (!enTete || !enTete.startsWith('Bearer ')) {
      return reply.code(401).send({ erreur: 'Authentification requise (en-tête Authorization manquant).' });
    }

    const jeton = enTete.slice('Bearer '.length);
    const payload = verifierJeton(jeton, JWT_SECRET);
    if (!payload) {
      return reply.code(401).send({ erreur: 'Jeton invalide ou expiré.' });
    }

    request.utilisateur = payload;
  });

  // --- Résolution du client Pennylane pour un dossier (10/08) ---
  // Cœur du chantier API Cabinet : le jeton n'est plus jamais fourni
  // manuellement dans une requête — il vient du paramètre cabinet
  // (pennylane_firm_api_key), et le dossier ciblé de son propre
  // external_company_id. Grâce à IPennylaneApiClient (interface partagée),
  // le FirmApiClient retourné ici fonctionne dans exactement les mêmes
  // fonctions connecteur que l'ancien PennylaneClient, sans aucune
  // adaptation nécessaire côté pipeline.ts.
  class LogicielSourceNonPrisEnChargeError extends Error {}
  class JetonCabinetManquantError extends Error {}
  class DossierIntrouvableError extends Error {}

  async function resoudreClientPennylane(cabinetId: string, dossierId: string): Promise<IPennylaneApiClient> {
    const dossier = await avecContexteCabinet(pool, cabinetId, (client) => chargerDossier(client, dossierId));
    if (!dossier) {
      throw new DossierIntrouvableError(`Dossier ${dossierId} introuvable, ou hors du cabinet courant.`);
    }

    if (dossier.logicielSource !== 'pennylane') {
      throw new LogicielSourceNonPrisEnChargeError(
        `Logiciel source '${dossier.logicielSource}' non pris en charge pour l'instant — seul Pennylane l'est aujourd'hui.`
      );
    }

    const jetonCabinet = await avecContexteCabinet(pool, cabinetId, (client) =>
      parametreCabinetValeur(client, cabinetId, 'pennylane_firm_api_key')
    );
    if (typeof jetonCabinet !== 'string' || jetonCabinet.length === 0) {
      throw new JetonCabinetManquantError(
        "Aucun jeton d'API Cabinet Pennylane configuré pour ce cabinet — définir la clé pennylane_firm_api_key dans les paramètres du cabinet."
      );
    }

    return new FirmApiClient({ token: jetonCabinet, companyId: dossier.externalCompanyId });
  }

  // --- Authentification ---
  app.post<{ Body: { email: string; motDePasse: string } }>('/auth/login', async (request, reply) => {
    const { email, motDePasse } = request.body;
    if (!email || !motDePasse) {
      return reply.code(400).send({ erreur: 'email et motDePasse requis' });
    }

    // Cabinet inconnu à ce stade (c'est justement ce qu'on cherche) —
    // client obtenu directement, jamais via avecContexteCabinet.
    const client = await pool.connect();
    let utilisateur;
    try {
      utilisateur = await trouverUtilisateurPourConnexion(client, email);
    } finally {
      client.release();
    }

    // Même message d'erreur, que l'email soit inconnu, le mot de passe pas
    // encore défini, le compte inactif, ou le mot de passe incorrect — ne
    // jamais laisser un attaquant distinguer "email inconnu" de "mauvais
    // mot de passe".
    const messageEchec = 'Identifiants invalides.';
    if (!utilisateur || !utilisateur.motDePasseHash || utilisateur.statut !== 'actif') {
      return reply.code(401).send({ erreur: messageEchec });
    }

    const valide = await verifierMotDePasse(motDePasse, utilisateur.motDePasseHash);
    if (!valide) {
      return reply.code(401).send({ erreur: messageEchec });
    }

    const jeton = creerJeton(
      { utilisateurId: utilisateur.id, cabinetId: utilisateur.cabinetId, role: utilisateur.role },
      JWT_SECRET
    );
    reply.code(200).send({
      jeton,
      utilisateur: { id: utilisateur.id, cabinetId: utilisateur.cabinetId, role: utilisateur.role },
    });
  });

  // Réservé aux admin_cabinet, restreint à leur propre cabinet (RLS sur
  // utilisateurs, cf. definirMotDePasse) — pas de flux "mot de passe
  // oublié" par email pour cette première version (décision explicite de
  // Rami, éviter la brique email pour aller vite).
  app.post<{ Params: { id: string }; Body: { motDePasse: string } }>(
    '/utilisateurs/:id/mot-de-passe',
    async (request, reply) => {
      if (request.utilisateur?.role !== 'admin_cabinet') {
        return reply.code(403).send({ erreur: 'Réservé aux administrateurs de cabinet.' });
      }
      const { motDePasse } = request.body;
      if (!motDePasse || motDePasse.length < 8) {
        return reply.code(400).send({ erreur: 'Mot de passe requis (au moins 8 caractères).' });
      }
      const hash = await hasherMotDePasse(motDePasse);
      await avecContexteCabinet(pool, request.utilisateur.cabinetId, (client) =>
        definirMotDePasse(client, request.params.id, hash)
      );
      reply.code(204).send();
    }
  );

  // --- Synchronisation des dossiers depuis l'API Cabinet Pennylane (10/08) ---
  // Réservé aux admin_cabinet — auto-découverte des dossiers déjà gérés
  // sous Pennylane, réponse directe à "comment les dossiers arrivent sur la
  // plateforme". Le jeton cabinet est lu depuis les paramètres cabinet
  // (clé pennylane_firm_api_key), jamais transmis dans la requête.
  app.post('/synchroniser-dossiers', async (request, reply) => {
    if (request.utilisateur!.role !== 'admin_cabinet') {
      return reply.code(403).send({ erreur: 'Réservé aux administrateurs de cabinet.' });
    }
    const cabinetId = request.utilisateur!.cabinetId;

    const jetonCabinet = await avecContexteCabinet(pool, cabinetId, (client) =>
      parametreCabinetValeur(client, cabinetId, 'pennylane_firm_api_key')
    );
    if (typeof jetonCabinet !== 'string' || jetonCabinet.length === 0) {
      return reply.code(400).send({
        erreur:
          "Aucun jeton d'API Cabinet Pennylane configuré. Définir la clé pennylane_firm_api_key dans les paramètres du cabinet avant de synchroniser.",
      });
    }

    let dossiersDecouverts;
    try {
      dossiersDecouverts = await fetchDossiersCabinet(jetonCabinet);
    } catch (err) {
      return reply.code(502).send({ erreur: `Échec de l'appel à l'API Cabinet Pennylane : ${String(err)}` });
    }

    const resultat = await avecContexteCabinet(pool, cabinetId, (client) =>
      synchroniserDossiersCabinet(
        client,
        cabinetId,
        dossiersDecouverts.map((d) => ({ id: d.id, nom: d.nom, siren: d.siren }))
      )
    );

    reply.code(200).send({
      total: resultat.length,
      nouveaux: resultat.filter((d) => d.nouveau).length,
      dossiers: resultat,
    });
  });

  // Réservé aux admin_cabinet — permet à un cabinet de gérer lui-même ses
  // utilisateurs (lister, ajouter) sans jamais repasser par du SQL direct.
  app.get('/utilisateurs', async (request, reply) => {
    if (request.utilisateur!.role !== 'admin_cabinet') {
      return reply.code(403).send({ erreur: 'Réservé aux administrateurs de cabinet.' });
    }
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) => listerUtilisateursCabinet(client, cabinetId));
  });

  app.post<{
    Body: { nom: string; email: string; role: 'collaborateur' | 'admin_cabinet'; motDePasse: string };
  }>('/utilisateurs', async (request, reply) => {
    if (request.utilisateur!.role !== 'admin_cabinet') {
      return reply.code(403).send({ erreur: 'Réservé aux administrateurs de cabinet.' });
    }
    const { nom, email, role, motDePasse } = request.body;
    if (!nom || !email || !role) {
      return reply.code(400).send({ erreur: 'nom, email et role requis' });
    }
    if (!motDePasse || motDePasse.length < 8) {
      return reply.code(400).send({ erreur: 'Mot de passe requis (au moins 8 caractères).' });
    }
    const hash = await hasherMotDePasse(motDePasse);
    try {
      const id = await avecContexteCabinet(pool, request.utilisateur!.cabinetId, (client) =>
        creerUtilisateurCabinet(client, request.utilisateur!.cabinetId, nom, email, role, hash)
      );
      reply.code(201).send({ id });
    } catch (err) {
      if (err instanceof EmailDejaUtiliseError) {
        return reply.code(409).send({ erreur: err.message });
      }
      throw err;
    }
  });

  // Désactive plutôt que supprime (cf. desactiverUtilisateurCabinet) —
  // jamais le dernier admin_cabinet actif du cabinet.
  app.post<{ Params: { id: string } }>('/utilisateurs/:id/desactiver', async (request, reply) => {
    if (request.utilisateur!.role !== 'admin_cabinet') {
      return reply.code(403).send({ erreur: 'Réservé aux administrateurs de cabinet.' });
    }
    try {
      await avecContexteCabinet(pool, request.utilisateur!.cabinetId, (client) =>
        desactiverUtilisateurCabinet(client, request.utilisateur!.cabinetId, request.params.id)
      );
      reply.code(204).send();
    } catch (err) {
      if (err instanceof DernierAdminCabinetError) {
        return reply.code(409).send({ erreur: err.message });
      }
      throw err;
    }
  });

  app.get('/health', async () => ({ statut: 'ok' }));

  // --- Anomalies ---
  app.get<{ Params: { dossierId: string }; Querystring: { statut?: string; periode?: string } }>(
    '/dossiers/:dossierId/anomalies',
    async (request) => {
      const cabinetId = request.utilisateur!.cabinetId;
      return avecContexteCabinet(pool, cabinetId, (client) =>
        listerAnomalies(client, request.params.dossierId, request.query)
      );
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string; commentaire?: string } }>(
    '/anomalies/:id/resoudre',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        resoudreAnomalie(client, request.params.id, request.body.utilisateurId, request.body.commentaire)
      );
      reply.code(204).send();
    }
  );

  // Résolution en masse — pense à filtrer côté frontend AVANT d'appeler ça
  // (par type d'anomalie, cf. filtre demandé) : ce n'est pas cette route qui
  // décide quoi inclure, elle prend juste la liste d'ids déjà choisie.
  app.post<{ Body: { anomalieIds: string[]; utilisateurId: string; commentaire: string } }>(
    '/anomalies/resoudre-en-masse',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
      const { anomalieIds, utilisateurId, commentaire } = request.body;
      if (!commentaire) {
        return reply.code(400).send({ erreur: 'commentaire requis pour une resolution en masse' });
      }
      const resultat = await avecContexteCabinet(pool, cabinetId, (client) =>
        resoudreAnomaliesEnMasse(client, anomalieIds, utilisateurId, commentaire)
      );
      return resultat;
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string; commentaire: string } }>(
    '/anomalies/:id/justifier',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
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
    const cabinetId = request.utilisateur!.cabinetId;
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
      const cabinetId = request.utilisateur!.cabinetId;
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
      const cabinetId = request.utilisateur!.cabinetId;
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
      const cabinetId = request.utilisateur!.cabinetId;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        confirmerConvention(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/conventions/:id/rejeter',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
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
      const cabinetId = request.utilisateur!.cabinetId;
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
      const cabinetId = request.utilisateur!.cabinetId;
      return avecContexteCabinet(pool, cabinetId, (client) =>
        listerTauxHistorique(client, request.params.dossierId, request.query.statut)
      );
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/taux-historique/:id/confirmer',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        confirmerTauxHistorique(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/taux-historique/:id/rejeter',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
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
      const cabinetId = request.utilisateur!.cabinetId;
      return avecContexteCabinet(pool, cabinetId, (client) =>
        listerTauxHistoriqueTiers(client, request.params.dossierId, request.query.statut)
      );
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/taux-historique-tiers/:id/confirmer',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        confirmerTauxHistoriqueTiers(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/taux-historique-tiers/:id/rejeter',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        rejeterTauxHistoriqueTiers(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  // --- Tiers de référence (mémoire de confiance — Module 9) ---
  // --- Parc de véhicules (immobilisations) — table prête depuis le
  // schéma initial, aucune route n'existait jusqu'ici pour l'alimenter.
  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/vehicules', async (request) => {
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) => listerVehicules(client, request.params.dossierId));
  });

  app.post<{
    Params: { dossierId: string };
    Body: VehiculeManuel & { utilisateurId: string };
  }>('/dossiers/:dossierId/vehicules', async (request, reply) => {
    const cabinetId = request.utilisateur!.cabinetId;
    const { utilisateurId, ...vehicule } = request.body;
    const id = await avecContexteCabinet(pool, cabinetId, (client) =>
      ajouterVehiculeManuel(client, request.params.dossierId, vehicule, utilisateurId)
    );
    reply.code(201).send({ id });
  });

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/vehicules/:id/retirer',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
      await avecContexteCabinet(pool, cabinetId, (client) =>
        retirerVehicule(client, request.params.id, request.body.utilisateurId)
      );
      reply.code(204).send();
    }
  );

  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/tiers', async (request) => {
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) => listerTiersReference(client, request.params.dossierId));
  });

  // Correction manuelle du niveau de confiance : la progression automatique
  // reste la voie normale, ceci est l'exception pour une information directe
  // du collaborateur.
  app.post<{
    Params: { dossierId: string };
    Body: { numeroCompteTiers: string; niveauConfiance: 'nouveau' | 'a_surveiller' | 'confiance'; utilisateurId: string };
  }>('/dossiers/:dossierId/tiers/corriger', async (request, reply) => {
    const cabinetId = request.utilisateur!.cabinetId;
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

  // --- Taux assigné par compte (produit/charge) — assignation directe, une
  // fois pour toutes, cf. migration 010. Pas de workflow candidate/confirmed.
  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/taux-assignes', async (request) => {
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) =>
      listerTauxAssignes(client, request.params.dossierId)
    );
  });

  app.post<{
    Params: { dossierId: string };
    Body: { compte: string; taux: TauxAssigne; utilisateurId: string };
  }>('/dossiers/:dossierId/taux-assignes', async (request, reply) => {
    const cabinetId = request.utilisateur!.cabinetId;
    const { compte, taux, utilisateurId } = request.body;
    await avecContexteCabinet(pool, cabinetId, (client) =>
      assignerTauxCompte(client, request.params.dossierId, compte, taux, utilisateurId)
    );
    reply.code(204).send();
  });

  // --- Taux client assigné manuellement (distinct de la détection auto sur
  // historique lettré, cf. analyserTauxHistoriqueParTiers) — confirme
  // directement, pas de candidate à valider séparément.
  app.post<{
    Params: { dossierId: string };
    Body: { numeroCompteTiers: string; tauxHabituel: number | 'mixte'; utilisateurId: string };
  }>('/dossiers/:dossierId/taux-historique-tiers/assigner', async (request, reply) => {
    const cabinetId = request.utilisateur!.cabinetId;
    const { numeroCompteTiers, tauxHabituel, utilisateurId } = request.body;
    await avecContexteCabinet(pool, cabinetId, (client) =>
      assignerTauxHistoriqueTiersManuel(client, request.params.dossierId, numeroCompteTiers, tauxHabituel, utilisateurId)
    );
    reply.code(204).send();
  });

  // --- Calculs ---
  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/calculs', async (request) => {
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) => listerCalculs(client, request.params.dossierId));
  });

  app.post<{ Params: { id: string }; Body: { utilisateurId: string } }>(
    '/calculs/:id/valider',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
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
      const cabinetId = request.utilisateur!.cabinetId;
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

  // --- Ajustement manuel des montants de TVA (10/08) — restreint aux
  // calculs encore 'brouillon', additif (jamais un remplacement, cf.
  // migration 012).
  app.get<{ Params: { id: string } }>('/calculs/:id/ajustements', async (request) => {
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) => listerAjustementsCalcul(client, request.params.id));
  });

  app.post<{
    Params: { id: string };
    Body: {
      typeMontant: 'collectee_totale' | 'deductible_totale';
      montantOriginal: number;
      montantAjuste: number;
      justification: string;
      utilisateurId: string;
    };
  }>('/calculs/:id/ajustements', async (request, reply) => {
    const cabinetId = request.utilisateur!.cabinetId;
    const { typeMontant, montantOriginal, montantAjuste, justification, utilisateurId } = request.body;
    if (!justification || justification.trim().length === 0) {
      return reply.code(400).send({ erreur: 'justification requise pour ajuster un montant' });
    }
    try {
      await avecContexteCabinet(pool, cabinetId, (client) =>
        ajusterMontantCalcul(client, request.params.id, typeMontant, montantOriginal, montantAjuste, justification, utilisateurId)
      );
      reply.code(204).send();
    } catch (err) {
      if (err instanceof CalculPlusEnBrouillonError) {
        return reply.code(409).send({ erreur: err.message });
      }
      throw err;
    }
  });

  app.post<{
    Params: { id: string; typeMontant: 'collectee_totale' | 'deductible_totale' };
    Body: { utilisateurId: string };
  }>('/calculs/:id/ajustements/:typeMontant/retirer', async (request, reply) => {
    const cabinetId = request.utilisateur!.cabinetId;
    try {
      await avecContexteCabinet(pool, cabinetId, (client) =>
        retirerAjustementCalcul(client, request.params.id, request.params.typeMontant, request.body.utilisateurId)
      );
      reply.code(204).send();
    } catch (err) {
      if (err instanceof CalculPlusEnBrouillonError) {
        return reply.code(409).send({ erreur: err.message });
      }
      throw err;
    }
  });

  // --- Audit (Module 10) ---
  app.get<{
    Params: { dossierId: string };
    Querystring: { typeEvenement?: string; acteur?: string; depuis?: string; jusqua?: string; limite?: string };
  }>('/dossiers/:dossierId/audit', async (request) => {
    const cabinetId = request.utilisateur!.cabinetId;
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
    const cabinetId = request.utilisateur!.cabinetId;
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
      comptesVenteService?: string[];
      comptesChargeService?: string[];
      comptesEquipement?: string[];
      comptesCarburant?: string[];
    };
  }>('/dossiers/:dossierId/cycles', async (request, reply) => {
    const cabinetId = request.utilisateur!.cabinetId;
    const { periodeDebut, periodeFin, ...overrides } = request.body;

    if (!periodeDebut || !periodeFin) {
      return reply.code(400).send({ erreur: 'periodeDebut et periodeFin sont requis' });
    }
    if (periodeFin < periodeDebut) {
      return reply.code(400).send({ erreur: 'periodeFin ne peut pas être antérieure à periodeDebut' });
    }

    let client;
    try {
      client = await resoudreClientPennylane(cabinetId, request.params.dossierId);
    } catch (err) {
      if (err instanceof DossierIntrouvableError) return reply.code(404).send({ erreur: err.message });
      if (err instanceof LogicielSourceNonPrisEnChargeError || err instanceof JetonCabinetManquantError) {
        return reply.code(400).send({ erreur: err.message });
      }
      throw err;
    }

    try {
      const resultat = await executerCycleTva(pool, {
        cabinetId,
        dossierId: request.params.dossierId,
        periodeDebut,
        periodeFin,
        client,
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

  // --- Analyse manuelle du motif de numérotation de facture (Module 5) ---
  // Déclenchée par un bouton dédié côté interface, jamais automatiquement à
  // chaque cycle — cf. analyserMotifNumerotation.ts pour le raisonnement.
  app.post<{
    Params: { dossierId: string };
    Body: { periodeDebut: string; periodeFin: string; utilisateurId: string };
  }>('/dossiers/:dossierId/motif-numerotation/analyser', async (request, reply) => {
    const cabinetId = request.utilisateur!.cabinetId;
    const { periodeDebut, periodeFin, utilisateurId } = request.body;

    if (!periodeDebut || !periodeFin) {
      return reply.code(400).send({ erreur: 'periodeDebut et periodeFin sont requis' });
    }

    let client;
    try {
      client = await resoudreClientPennylane(cabinetId, request.params.dossierId);
    } catch (err) {
      if (err instanceof DossierIntrouvableError) return reply.code(404).send({ erreur: err.message });
      if (err instanceof LogicielSourceNonPrisEnChargeError || err instanceof JetonCabinetManquantError) {
        return reply.code(400).send({ erreur: err.message });
      }
      throw err;
    }

    try {
      return await analyserMotifNumerotationFacture(pool, {
        cabinetId,
        dossierId: request.params.dossierId,
        client,
        periodeDebut,
        periodeFin,
        utilisateurId,
      });
    } catch (err) {
      if (err instanceof ClefMistralAbsenteError) {
        return reply.code(400).send({ erreur: err.message });
      }
      throw err;
    }
  });

  // --- Paramétrage cabinet (ex: clé API Mistral — présence = LLM activé) ---
  // Réservé au rôle admin_cabinet (décision de Rami, 10/08) — un
  // collaborateur voit les dossiers de son cabinet mais jamais les
  // paramètres du cabinet lui-même.
  app.get('/parametres-cabinet', async (request, reply) => {
    if (request.utilisateur!.role !== 'admin_cabinet') {
      return reply.code(403).send({ erreur: 'Réservé aux administrateurs de cabinet.' });
    }
    const cabinetId = request.utilisateur!.cabinetId;
    // listerParametresCabinet masque déjà les valeurs secrètes (ex:
    // mistral_api_key) avant de sortir de la couche DB — jamais de valeur en
    // clair à masquer ici, la garantie vient d'une seule source.
    return avecContexteCabinet(pool, cabinetId, (client) => listerParametresCabinet(client, cabinetId));
  });

  app.put<{ Body: { utilisateurId: string; cle: string; valeur: unknown } }>(
    '/parametres-cabinet',
    async (request, reply) => {
      if (request.utilisateur!.role !== 'admin_cabinet') {
        return reply.code(403).send({ erreur: 'Réservé aux administrateurs de cabinet.' });
      }
      const cabinetId = request.utilisateur!.cabinetId;
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
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) =>
      listerParametresDossier(client, request.params.dossierId)
    );
  });

  app.put<{ Params: { dossierId: string }; Body: { utilisateurId: string; cle: string; valeur: unknown } }>(
    '/dossiers/:dossierId/parametres',
    async (request, reply) => {
      const cabinetId = request.utilisateur!.cabinetId;
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
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) => listerDossiers(client, cabinetId, request.query.q));
  });

  // --- Tout ce qui attend une décision humaine sur ce dossier ---
  app.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId/a-traiter', async (request) => {
    const cabinetId = request.utilisateur!.cabinetId;
    return avecContexteCabinet(pool, cabinetId, (client) =>
      listerElementsATraiter(client, request.params.dossierId)
    );
  });

  return app;
}
