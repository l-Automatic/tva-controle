import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { hasherMotDePasse, verifierMotDePasse, creerJeton, verifierJeton, type PayloadJeton } from '../src/db/auth.js';

describe('hasherMotDePasse / verifierMotDePasse', () => {
  it('un mot de passe correct est vérifié avec succès', async () => {
    const hash = await hasherMotDePasse('correcthorsebatterystaple');
    expect(await verifierMotDePasse('correcthorsebatterystaple', hash)).toBe(true);
  });

  it('un mot de passe incorrect est rejeté', async () => {
    const hash = await hasherMotDePasse('correcthorsebatterystaple');
    expect(await verifierMotDePasse('mauvais_mot_de_passe', hash)).toBe(false);
  });

  it('deux hachages du même mot de passe sont différents (sel aléatoire)', async () => {
    const hash1 = await hasherMotDePasse('meme_mot_de_passe');
    const hash2 = await hasherMotDePasse('meme_mot_de_passe');
    expect(hash1).not.toBe(hash2);
    expect(await verifierMotDePasse('meme_mot_de_passe', hash1)).toBe(true);
    expect(await verifierMotDePasse('meme_mot_de_passe', hash2)).toBe(true);
  });

  it('un hash malformé ne fait jamais planter la vérification, retourne false', async () => {
    expect(await verifierMotDePasse('x', 'pas_un_hash_valide')).toBe(false);
    expect(await verifierMotDePasse('x', '')).toBe(false);
  });
});

describe('creerJeton / verifierJeton', () => {
  const secret = 'secret-de-test-suffisamment-long';
  const payload: PayloadJeton = {
    utilisateurId: '11111111-1111-1111-1111-111111111111',
    cabinetId: '22222222-2222-2222-2222-222222222222',
    role: 'collaborateur',
  };

  it('un jeton valide est vérifié et retourne le bon payload', () => {
    const jeton = creerJeton(payload, secret);
    const verifie = verifierJeton(jeton, secret);
    expect(verifie).toMatchObject(payload);
    expect(typeof verifie?.exp).toBe('number');
  });

  it('un jeton signé avec un autre secret est rejeté', () => {
    const jeton = creerJeton(payload, secret);
    expect(verifierJeton(jeton, 'autre-secret')).toBeNull();
  });

  it('un jeton trafiqué (corps modifié) est rejeté', () => {
    const jeton = creerJeton(payload, secret);
    const [header, corps, signature] = jeton.split('.');
    const corpsTrafique = Buffer.from(JSON.stringify({ ...payload, role: 'admin_cabinet' })).toString('base64url');
    expect(verifierJeton(`${header}.${corpsTrafique}.${signature}`, secret)).toBeNull();
  });

  it('un jeton mal formé (pas 3 parties) est rejeté sans planter', () => {
    expect(verifierJeton('pas.un.jeton.valide.du.tout', secret)).toBeNull();
    expect(verifierJeton('', secret)).toBeNull();
  });

  it('un jeton expiré est rejeté', () => {
    // Fabrique un jeton déjà expiré en signant manuellement un corps avec exp dans le passé
    const corps = { ...payload, exp: Math.floor(Date.now() / 1000) - 10 };
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerEnc = Buffer.from(JSON.stringify(header)).toString('base64url');
    const corpsEnc = Buffer.from(JSON.stringify(corps)).toString('base64url');
    const signature = createHmac('sha256', secret).update(`${headerEnc}.${corpsEnc}`).digest('base64url');
    expect(verifierJeton(`${headerEnc}.${corpsEnc}.${signature}`, secret)).toBeNull();
  });
});
