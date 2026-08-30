// Client HTTP générique — ne connaît aucune logique métier TVA, uniquement
// l'authentification, la construction d'URL et la gestion d'erreur.
// Le paramètre fetchImpl est injectable pour permettre de tester la logique
// de pagination et de mapping sans jamais faire d'appel réseau réel dans
// les tests unitaires.

// Interface partagée (10/08) — extraite pour que toutes les fonctions
// connecteur déjà écrites (fetchLignesParCompte, fetchLettrage, etc.)
// acceptent indifféremment un PennylaneClient (jeton par dossier) ou un
// FirmApiClient (jeton cabinet, API Cabinet) sans aucune modification de
// leur propre code. Une classe TypeScript ordinaire ne suffit pas ici : deux
// classes avec des champs privés distincts (même identiques par le nom) ne
// sont jamais mutuellement assignables, même si leur forme publique est
// strictement la même — d'où cette interface, purement structurelle.
export interface IPennylaneApiClient {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T>;
}

export class PennylaneApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`Pennylane API error ${status} on ${path}: ${body}`);
    this.name = 'PennylaneApiError';
  }
}

export interface PennylaneClientConfig {
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
  maxRetries429?: number; // nombre max de nouvelles tentatives sur 429, défaut 3
}

// Limite documentée : 25 requêtes / 5 secondes par token (rate-limiting-1.md).
// Gérée ici, au niveau le plus bas, pour qu'aucun appelant n'ait à s'en
// soucier ni ne puisse l'oublier.
export class PennylaneClient implements IPennylaneApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries429: number;

  constructor(config: PennylaneClientConfig) {
    this.baseUrl = config.baseUrl ?? 'https://app.pennylane.com';
    this.token = config.token;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries429 = config.maxRetries429 ?? 3;
  }

  async get<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    let tentative = 0;
    for (;;) {
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
      });

      if (response.status === 429 && tentative < this.maxRetries429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const attenteSecondes = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : 1;
        await sleep(Math.max(attenteSecondes, 0.1) * 1000);
        tentative += 1;
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new PennylaneApiError(response.status, path, body);
      }

      return (await response.json()) as T;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
