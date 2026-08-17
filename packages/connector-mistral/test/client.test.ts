import { describe, it, expect } from 'vitest';
import { MistralClient, MistralApiError, MistralReponseInvalideError } from '../src/client.js';

function fakeFetch(reponse: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(reponse), { status })) as unknown as typeof fetch;
}

describe('MistralClient.completionJson', () => {
  it('parse le contenu JSON de la réponse', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch({
        choices: [{ message: { content: '{"foo": "bar"}' } }],
      }),
    });

    const resultat = await client.completionJson('system', 'user');
    expect(resultat).toEqual({ foo: 'bar' });
  });

  it('envoie bien le header Authorization Bearer et response_format json_object', async () => {
    let requeteVue: { headers: Record<string, string>; body: string } | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      requeteVue = {
        headers: init?.headers as Record<string, string>,
        body: init?.body as string,
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new MistralClient({ apiKey: 'ma-cle-secrete', fetchImpl });
    await client.completionJson('system', 'user');

    expect(requeteVue?.headers.Authorization).toBe('Bearer ma-cle-secrete');
    const bodyParse = JSON.parse(requeteVue!.body);
    expect(bodyParse.response_format).toEqual({ type: 'json_object' });
  });

  it('lève MistralApiError sur une réponse HTTP en erreur', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch({ error: 'unauthorized' }, 401) });
    await expect(client.completionJson('s', 'u')).rejects.toThrow(MistralApiError);
  });

  it('lève MistralReponseInvalideError si le content est absent', async () => {
    const client = new MistralClient({ apiKey: 'x', fetchImpl: fakeFetch({ choices: [] }) });
    await expect(client.completionJson('s', 'u')).rejects.toThrow(MistralReponseInvalideError);
  });

  it('lève MistralReponseInvalideError si le content n’est pas un JSON valide', async () => {
    const client = new MistralClient({
      apiKey: 'x',
      fetchImpl: fakeFetch({ choices: [{ message: { content: 'pas du json' } }] }),
    });
    await expect(client.completionJson('s', 'u')).rejects.toThrow(MistralReponseInvalideError);
  });
});
