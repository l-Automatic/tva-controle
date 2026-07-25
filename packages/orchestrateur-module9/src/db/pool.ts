import pg from 'pg';

const { Pool } = pg;
export type { Pool as PgPool } from 'pg';

export function creerPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString });
}

// Exécute fn dans une transaction avec le contexte RLS positionné sur le
// cabinet donné (SET LOCAL app.current_cabinet_id) — sans ça, la RLS posée
// en Module 2 filtre silencieusement tout à zéro ligne, comme découvert lors
// des tests du schéma.
export async function avecContexteCabinet<T>(
  pool: pg.Pool,
  cabinetId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL n'accepte pas de paramètre bindé côté Postgres (erreur de
    // syntaxe confirmée en testant contre une vraie instance) — set_config()
    // fait la même chose (3e argument true = portée transaction, comme LOCAL)
    // mais accepte les paramètres.
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
