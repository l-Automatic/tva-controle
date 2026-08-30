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
// Schéma de réponse CONFIRMÉ (10/08) via le schéma OpenAPI officiel complet
// de l'endpoint (firm-pennylane.readme.io/reference/companies-1) — plus une
// simple supposition. Pagination PAR PAGE (page/per_page/total_pages), pas
// par curseur — corrige une première version de ce fichier qui supposait
// à tort une pagination par curseur.
//
// Pas de champ de régime de TVA dans cette réponse (vérifié aussi sur
// l'endpoint détail "Show company", identique) — la configuration fiscale
// d'un dossier nouvellement découvert reste une étape humaine séparée
// (Phase 2 du chantier), pas quelque chose de récupérable ici.

export interface DossierCabinet {
  id: string;
  nom: string; // name (raison sociale)
  nomCommercial: string | null; // billing_company_name
  siren: string | null;
  adresse: string | null;
  ville: string | null;
  codePostal: string | null;
  codeNaf: string | null; // activity_code
  externalId: string | null; // distinct de id — identifiant externe propre à Pennylane
  codeClient: string | null; // client_code — référence assignée par le cabinet lui-même dans Pennylane, utile pour le rapprochement
}

interface PennylaneCompanyItem {
  id: number;
  name: string;
  billing_company_name?: string | null;
  siren?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  activity_code?: string | null;
  external_id?: string | null;
  client_code?: string | null;
}

interface PennylaneCompaniesResponse {
  items: PennylaneCompanyItem[];
  total_pages: number;
  current_page: number;
  total_items: number;
  per_page: number;
}

function mapper(item: PennylaneCompanyItem): DossierCabinet {
  return {
    id: String(item.id),
    nom: item.name,
    nomCommercial: item.billing_company_name ?? null,
    siren: item.siren ?? null,
    adresse: item.address ?? null,
    ville: item.city ?? null,
    codePostal: item.postal_code ?? null,
    codeNaf: item.activity_code ?? null,
    externalId: item.external_id ?? null,
    codeClient: item.client_code ?? null,
  };
}

export async function fetchDossiersCabinet(
  token: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl = 'https://app.pennylane.com'
): Promise<DossierCabinet[]> {
  const resultat: DossierCabinet[] = [];
  let page = 1;

  for (;;) {
    const url = new URL('/api/external/firm/v1/companies', baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');

    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Échec de la liste des dossiers du cabinet (${response.status}) : ${body}`);
    }

    const payload = (await response.json()) as PennylaneCompaniesResponse;
    resultat.push(...payload.items.map(mapper));

    if (page >= payload.total_pages) break;
    page += 1;
  }

  return resultat;
}
