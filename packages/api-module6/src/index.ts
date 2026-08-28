import pg from 'pg';
import { buildApp } from './app.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://pennylane_tva_app:CHANGE_ME_APP@localhost:5432/tva_orchestrateur_test';
const port = Number.parseInt(process.env.PORT ?? '3001', 10);

const pool = new pg.Pool({ connectionString });
const app = buildApp(pool);

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    console.log(`TVA Contrôle — API en écoute sur http://0.0.0.0:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
