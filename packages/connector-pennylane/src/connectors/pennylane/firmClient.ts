// Client HTTP pour l'API Cabinet (Firm API) — TVA intracom mis à part, ceci
// est le vrai chantier de connectivité réelle du projet (10/08) : jusqu'ici,
// tout reposait sur un jeton par dossier (Company API), un vestige du
// sandbox mono-société utilisé pendant tout le développement. L'API Cabinet
// utilise un seul jeton par cabinet, et cible un dossier précis via un
// segment d'URL (/companies/{id}/...), pas un paramètre.
//
// Confirmé par la documentation officielle (deux points indépendants :
// référence technique firm-pennylane.readme.io + un post de support réel) :
//   Company API : https://app.pennylane.com/api/external/v2/<ressource>
//   Firm API    : https://app.pennylane.com/api/external/firm/v1/companies/{id}/<ressource>
//
// Choix de conception : plutôt que dupliquer chaque fonction connecteur
// déjà écrite (fetchLignesParCompte, fetchLettrage, etc.) pour ce nouveau
// mode, ce client réécrit silencieusement tout chemin Company API vers son
// équivalent Firm API scopé au dossier — toutes les fonctions existantes,
// qui appellent `client.get('/api/external/v2/...', ...)`, fonctionnent
// donc SANS AUCUNE MODIFICATION avec une instance de FirmApiClient à la
// place d'une PennylaneClient. Confirmé par tous les fichiers connecteurs
// existants : ils utilisent tous, sans exception, le préfixe
// /api/external/v2/.
//
// À VÉRIFIER EN CONDITIONS RÉELLES avec un vrai jeton cabinet — construit
// à partir de documentation, jamais observé sur un vrai appel.

const PREFIXE_COMPANY_API = '/api/external/v2/';

export class FirmApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`Pennylane Firm API error ${status} on ${path}: ${body}`);
    this.name = 'FirmApiError';
  }
}

export interface FirmApiClientConfig {
  baseUrl?: string;
  token: string; // jeton cabinet (Firm API Token), jamais un jeton dossier
  companyId: string; // dossier ciblé pour cette instance de client
  fetchImpl?: typeof fetch;
  maxRetries429?: number;
}

export class FirmApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly companyId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries429: number;

  constructor(config: FirmApiClientConfig) {
    this.baseUrl = config.baseUrl ?? 'https://app.pennylane.com';
    this.token = config.token;
    this.companyId = config.companyId;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries429 = config.maxRetries429 ?? 3;
  }

  private reecrireChemin(path: string): string {
    if (!path.startsWith(PREFIXE_COMPANY_API)) return path; // déjà un chemin Firm API explicite, ne pas toucher
    const ressource = path.slice(PREFIXE_COMPANY_API.length);
    return `/api/external/firm/v1/companies/${this.companyId}/${ressource}`;
  }

  async get<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const url = new URL(this.reecrireChemin(path), this.baseUrl);
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
        throw new FirmApiError(response.status, path, body);
      }

      return (await response.json()) as T;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
