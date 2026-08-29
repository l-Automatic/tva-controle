import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// Authentification (10/08) — décision explicite de Rami : aller vite, sans
// dépendre d'un service externe (pas Supabase), au plus simple. Node fournit
// nativement tout ce qu'il faut (scrypt pour le hachage, HMAC pour signer
// des jetons) — aucune nouvelle dépendance npm nécessaire, donc aucun risque
// de compilation native (contrairement à bcrypt) et rien à mettre à jour de
// ce côté.

const LONGUEUR_CLE = 64;

// --- Mots de passe (scrypt) ---

export async function hasherMotDePasse(motDePasse: string): Promise<string> {
  const sel = randomBytes(16).toString('hex');
  const derive = (await scryptAsync(motDePasse, sel, LONGUEUR_CLE)) as Buffer;
  return `${sel}:${derive.toString('hex')}`;
}

export async function verifierMotDePasse(motDePasse: string, hash: string): Promise<boolean> {
  const [sel, cleHex] = hash.split(':');
  if (!sel || !cleHex) return false; // hash malformé, jamais planter dessus

  const cleAttendue = Buffer.from(cleHex, 'hex');
  const derive = (await scryptAsync(motDePasse, sel, LONGUEUR_CLE)) as Buffer;

  // timingSafeEqual exige des buffers de même longueur — un hash corrompu
  // ou tronqué ne doit jamais faire planter la vérification, juste échouer.
  if (cleAttendue.length !== derive.length) return false;
  return timingSafeEqual(cleAttendue, derive);
}

// --- Jetons signés (HMAC-SHA256, format compatible JWT sans dépendance) ---

export interface PayloadJeton {
  utilisateurId: string;
  cabinetId: string;
  role: 'collaborateur' | 'admin_cabinet';
}

const DUREE_JETON_SECONDES = 60 * 60 * 12; // 12h — pas de refresh token pour cette v1, décision de simplicité

export function creerJeton(payload: PayloadJeton, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + DUREE_JETON_SECONDES;
  const corps = { ...payload, exp };

  const headerEnc = Buffer.from(JSON.stringify(header)).toString('base64url');
  const corpsEnc = Buffer.from(JSON.stringify(corps)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${headerEnc}.${corpsEnc}`).digest('base64url');

  return `${headerEnc}.${corpsEnc}.${signature}`;
}

// Retourne null pour TOUT jeton invalide (signature, format, expiration) —
// jamais de distinction fine communiquée à l'appelant, pour ne rien
// apprendre à un attaquant sur la raison précise de l'échec.
export function verifierJeton(jeton: string, secret: string): (PayloadJeton & { exp: number }) | null {
  const parties = jeton.split('.');
  if (parties.length !== 3) return null;
  const [headerEnc, corpsEnc, signature] = parties as [string, string, string];

  const signatureAttendue = createHmac('sha256', secret).update(`${headerEnc}.${corpsEnc}`).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const sigAttendueBuf = Buffer.from(signatureAttendue);
  if (sigBuf.length !== sigAttendueBuf.length || !timingSafeEqual(sigBuf, sigAttendueBuf)) {
    return null;
  }

  let corps: unknown;
  try {
    corps = JSON.parse(Buffer.from(corpsEnc, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (
    typeof corps !== 'object' ||
    corps === null ||
    typeof (corps as Record<string, unknown>).utilisateurId !== 'string' ||
    typeof (corps as Record<string, unknown>).cabinetId !== 'string' ||
    typeof (corps as Record<string, unknown>).role !== 'string' ||
    typeof (corps as Record<string, unknown>).exp !== 'number'
  ) {
    return null;
  }

  const payload = corps as PayloadJeton & { exp: number };
  if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expiré

  return payload;
}
