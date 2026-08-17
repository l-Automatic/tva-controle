// Client HTTP générique — aucune logique métier ici, uniquement
// authentification, appel /v1/chat/completions et gestion d'erreur. Le
// paramètre fetchImpl est injectable pour tester sans jamais faire
// d'appel réseau réel, même pattern que PennylaneClient.

export class MistralApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Mistral API error ${status}: ${body}`);
    this.name = 'MistralApiError';
  }
}

// Levée quand l'appel réussit côté HTTP mais que le contenu retourné n'est
// pas le JSON valide attendu — un appelant doit pouvoir distinguer "l'API a
// échoué" de "l'API a répondu, mais pas dans le format qu'on attendait",
// les deux se traitant différemment (retry vs abandon).
export class MistralReponseInvalideError extends Error {
  constructor(public readonly contenuBrut: string) {
    super(`Réponse Mistral non conforme au JSON attendu : ${contenuBrut.slice(0, 200)}`);
    this.name = 'MistralReponseInvalideError';
  }
}

export interface MistralClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  modele?: string;
}

export class MistralClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly modele: string;

  constructor(config: MistralClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.mistral.ai';
    this.fetchImpl = config.fetchImpl ?? fetch;
    // mistral-small-latest : suffisant pour de la classification de texte
    // court (libellés de comptes), pas besoin du modèle flagship pour ce
    // type de tâche — coût et latence bien inférieurs.
    this.modele = config.modele ?? 'mistral-small-latest';
  }

  // Appel en mode JSON garanti (response_format json_object) — le contenu
  // retourné est TOUJOURS un JSON valide au sens syntaxique (garantie
  // Mistral), mais peut ne pas correspondre à la FORME attendue par
  // l'appelant (ex: clé manquante) — c'est à l'appelant de valider la forme
  // après coup, cette fonction ne garantit que la validité JSON brute.
  async completionJson(systemPrompt: string, userPrompt: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: this.modele,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2, // classification, pas de créativité recherchée
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new MistralApiError(response.status, body);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const contenu = payload.choices?.[0]?.message?.content;
    if (!contenu) {
      throw new MistralReponseInvalideError(JSON.stringify(payload));
    }

    try {
      return JSON.parse(contenu);
    } catch {
      throw new MistralReponseInvalideError(contenu);
    }
  }
}
