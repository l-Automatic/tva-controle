#!/usr/bin/env node
// Script de bootstrap (10/08) — définit le mot de passe d'un utilisateur
// déjà existant en base (typiquement le tout premier admin_cabinet d'un
// cabinet). Une fois ce mot de passe défini, ce compte peut se connecter
// via POST /auth/login et gérer lui-même les mots de passe des autres
// utilisateurs de son cabinet (POST /utilisateurs/:id/mot-de-passe) — ce
// script ne sert qu'à amorcer le tout premier compte, jamais à un usage
// courant.
//
// Suppose que l'utilisateur (ligne dans la table `utilisateurs`) existe
// déjà — ce script ne crée jamais de cabinet ni d'utilisateur, seulement
// un mot de passe sur une ligne existante. La création d'un cabinet et de
// son premier utilisateur reste manuelle (SQL direct via
// provisioning_create_cabinet, cf. le reste du projet), cohérent avec ce
// qui existe déjà.
//
// Usage :
//   node scripts/bootstrap-mot-de-passe.mjs email@exemple.fr
// Le mot de passe est demandé de façon interactive (jamais en argument de
// ligne de commande, pour ne pas le laisser traîner dans l'historique du
// shell ou dans `ps`).

import pg from 'pg';
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';
import { createInterface } from 'readline';

const scryptAsync = promisify(scrypt);

// IMPORTANT : doit rester identique à hasherMotDePasse dans
// packages/orchestrateur-module9/src/db/auth.ts — un format différent
// rendrait le mot de passe défini ici invérifiable par l'application.
async function hasherMotDePasse(motDePasse) {
  const sel = randomBytes(16).toString('hex');
  const derive = await scryptAsync(motDePasse, sel, 64);
  return `${sel}:${derive.toString('hex')}`;
}

function demanderMotDePasseSecret(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Pas d'écho à l'écran — évite d'afficher le mot de passe en clair
    // dans le terminal pendant la saisie.
    const stdin = process.stdin;
    process.stdout.write(question);
    let motDePasse = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(motDePasse);
      } else if (char === '\u0003') {
        process.exit(1); // Ctrl+C
      } else if (char === '\u007f') {
        motDePasse = motDePasse.slice(0, -1); // backspace
      } else {
        motDePasse += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage : node scripts/bootstrap-mot-de-passe.mjs email@exemple.fr');
    process.exit(1);
  }

  const motDePasse = await demanderMotDePasseSecret(`Nouveau mot de passe pour ${email} : `);
  if (motDePasse.length < 8) {
    console.error('Le mot de passe doit faire au moins 8 caractères.');
    process.exit(1);
  }

  const connectionString =
    process.env.DATABASE_URL_PROVISIONING ??
    'postgresql://pennylane_tva_provisioning:CHANGE_ME_PROVISIONING@localhost:5432/tva_orchestrateur_test';

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // authentifier_par_email est SECURITY DEFINER (migration 013) :
    // fonctionne sans contexte cabinet, justement ce qu'il faut ici.
    const res = await client.query('SELECT * FROM authentifier_par_email($1)', [email]);
    if (res.rows.length === 0) {
      console.error(`Aucun utilisateur avec l'email ${email}. Ce script ne crée jamais de compte, seulement un mot de passe sur un compte existant.`);
      await client.query('ROLLBACK');
      process.exit(1);
    }

    const { id, cabinet_id: cabinetId, role } = res.rows[0];

    // Fixe le contexte cabinet pour que l'UPDATE passe le RLS (forcé sur
    // utilisateurs, cf. 002) — SET LOCAL, portée limitée à cette transaction.
    await client.query(`SELECT set_config('app.current_cabinet_id', $1, true)`, [cabinetId]);

    const hash = await hasherMotDePasse(motDePasse);
    await client.query('UPDATE utilisateurs SET mot_de_passe_hash = $2 WHERE id = $1', [id, hash]);

    await client.query('COMMIT');
    console.log(`Mot de passe défini pour ${email} (rôle : ${role}). Connexion possible via POST /auth/login.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
