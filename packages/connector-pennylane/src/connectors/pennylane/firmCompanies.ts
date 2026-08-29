// Liste des dossiers du cabinet (10/08) — le point d'entrée de tout ce
// chantier : c'est cet appel qui répond à la vraie question de Rami
// ("comment les dossiers apparaissent sur la plateforme") — auto-découverte
// via l'API Cabinet, pas d'import CSV ni FEC nécessaire pour un dossier déjà
// géré sous Pennylane.
//
// Distinct de FirmApiClient : cet appel n'est PAS scopé à un dossier (c'est
// justement lui qui les liste tous), donc pas besoin de la logique de
// réécriture de chemin — un appel direct et isolé, jamais répété dans le
// cycle régulier (seulement lors d'une synchronisation).
//
// Forme de la réponse À VÉRIFIER EN CONDITIONS RÉELLES — construite à
// partir de la documentation (id + name confirmés comme présents sur toute
// ressource "company" Pennylane par cohérence avec le reste de l'API),
// jamais observée sur un vrai appel avec un vrai jeton cabinet.

export interface DossierCabinet {
  id: string;
  nom: string;
  siren: string | null;
}

interface PennylaneCompanyItem {
  id: number | string;
  name: string;
  siren?: string | null;
}

interface PennylaneCompaniesResponse {
  items?: PennylaneCompanyItem[];
  data?: PennylaneCompanyItem[]; // forme alternative possible, à vérifier
  has_more?: boolean;
  next_cursor?: string | null;
}

export async function fetchDossiersCabinet(
  token: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl = 'https://app.pennylane.com'
): Promise<DossierCabinet[]> {
  const resultat: DossierCabinet[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL('/api/external/firm/v1/companies', baseUrl);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Échec de la liste des dossiers du cabinet (${response.status}) : ${body}`);
    }

    const payload = (await response.json()) as PennylaneCompaniesResponse;
    const items = payload.items ?? payload.data ?? [];

    for (const item of items) {
      resultat.push({ id: String(item.id), nom: item.name, siren: item.siren ?? null });
    }

    cursor = payload.has_more ? (payload.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return resultat;
}
