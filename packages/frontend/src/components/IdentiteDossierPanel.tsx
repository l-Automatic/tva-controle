import { useEffect, useState } from 'react';
import { ApiError, fetchDossierComplet, mettreAJourIdentiteDossier } from '../api';
import { toDateOnly } from '../dateUtils';
import { useToast } from '../toast';
import {
  FORMES_JURIDIQUES_COURANTES,
  LIBELLE_COMPTABILITE,
  LIBELLE_FISCALITE,
  type Comptabilite,
  type DossierComplet,
  type Fiscalite,
  type InfosIdentiteDossier,
} from '../types';

interface ChampsEditables {
  siret: string;
  formeJuridique: string;
  fiscalite: Fiscalite | '';
  comptabilite: Comptabilite | '';
  dateDebutExercice: string;
  dateFinExercice: string;
  numeroTvaIntracom: string;
  emailContact: string;
  contactNom: string;
  contactTelephone: string;
}

function versChamps(d: DossierComplet): ChampsEditables {
  return {
    siret: d.siret ?? '',
    formeJuridique: d.formeJuridique ?? '',
    fiscalite: d.fiscalite ?? '',
    comptabilite: d.comptabilite ?? '',
    dateDebutExercice: d.dateDebutExercice ? toDateOnly(d.dateDebutExercice) : '',
    dateFinExercice: d.dateFinExercice ? toDateOnly(d.dateFinExercice) : '',
    numeroTvaIntracom: d.numeroTvaIntracom ?? '',
    emailContact: d.emailContact ?? '',
    contactNom: d.contactNom ?? '',
    contactTelephone: d.contactTelephone ?? '',
  };
}

// Ne renvoie que les champs qui ont réellement changé par rapport à
// l'original chargé — une chaîne vidée redevient explicitement null
// (efface), un champ jamais touché est absent du body (laissé intact
// côté backend), cf. brief v29 section 1.
function calculerDiff(original: ChampsEditables, actuel: ChampsEditables): InfosIdentiteDossier {
  const diff: InfosIdentiteDossier = {};
  for (const cle of Object.keys(actuel) as (keyof ChampsEditables)[]) {
    if (actuel[cle] !== original[cle]) {
      (diff as Record<string, unknown>)[cle] = actuel[cle] === '' ? null : actuel[cle];
    }
  }
  return diff;
}

// Champs remplis par la synchronisation Pennylane (v27) — pas de route
// backend pour les modifier ici, affichés en lecture seule pour ne jamais
// laisser penser qu'ils viennent d'une saisie manuelle (brief v29 §1).
function ChampSynchronise({ libelle, valeur }: { libelle: string; valeur: string | null }) {
  return (
    <div className="identite-champ-lecture">
      <span className="identite-champ-lecture-libelle">{libelle}</span>
      <span className="identite-champ-lecture-valeur">{valeur || '—'}</span>
    </div>
  );
}

export function IdentiteDossierPanel({ cabinetId, dossierId }: { cabinetId: string; dossierId: string }) {
  const [dossier, setDossier] = useState<DossierComplet | null>(null);
  const [original, setOriginal] = useState<ChampsEditables | null>(null);
  const [champs, setChamps] = useState<ChampsEditables | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDossierComplet(cabinetId, dossierId);
      setDossier(data);
      const ch = versChamps(data);
      setOriginal(ch);
      setChamps(ch);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de charger l'identité du dossier");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  function majChamp<K extends keyof ChampsEditables>(cle: K, valeur: ChampsEditables[K]) {
    setChamps((prev) => (prev ? { ...prev, [cle]: valeur } : prev));
  }

  async function handleEnregistrer() {
    if (!champs || !original) return;
    const diff = calculerDiff(original, champs);
    if (Object.keys(diff).length === 0) {
      notifier('Aucune modification à enregistrer');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await mettreAJourIdentiteDossier(cabinetId, dossierId, diff);
      setOriginal(champs);
      notifier('Identité du dossier enregistrée');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'enregistrement de l'identité du dossier");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !dossier) {
    return (
      <section className="panel-section">
        <p className="empty">Chargement…</p>
      </section>
    );
  }

  if (!dossier || !champs) {
    return (
      <section className="panel-section">
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  const formesDisponibles = FORMES_JURIDIQUES_COURANTES.includes(
    champs.formeJuridique as (typeof FORMES_JURIDIQUES_COURANTES)[number]
  )
    ? FORMES_JURIDIQUES_COURANTES
    : champs.formeJuridique
      ? [champs.formeJuridique as (typeof FORMES_JURIDIQUES_COURANTES)[number], ...FORMES_JURIDIQUES_COURANTES]
      : FORMES_JURIDIQUES_COURANTES;

  return (
    <section className="panel-section">
      <div className="panel-header">
        <h2>Identité du dossier</h2>
      </div>

      <p className="reference">Synchronisé automatiquement depuis Pennylane — non modifiable ici.</p>
      <div className="identite-lecture-grille">
        <ChampSynchronise libelle="Nom" valeur={dossier.nom} />
        <ChampSynchronise libelle="Nom commercial" valeur={dossier.nomCommercial} />
        <ChampSynchronise libelle="SIREN" valeur={dossier.siren} />
        <ChampSynchronise libelle="Adresse" valeur={dossier.adresse} />
        <ChampSynchronise libelle="Ville" valeur={dossier.ville} />
        <ChampSynchronise libelle="Code postal" valeur={dossier.codePostal} />
        <ChampSynchronise libelle="Code NAF" valeur={dossier.codeNaf} />
      </div>

      <div className="panel-separateur" />

      <p className="reference">Champs à compléter manuellement.</p>
      <div className="cycle-form">
        <label>
          SIRET
          <input
            type="text"
            value={champs.siret}
            onChange={(e) => majChamp('siret', e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Forme juridique
          <select
            value={champs.formeJuridique}
            onChange={(e) => majChamp('formeJuridique', e.target.value)}
            disabled={submitting}
          >
            <option value="">—</option>
            {formesDisponibles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fiscalité
          <select
            value={champs.fiscalite}
            onChange={(e) => majChamp('fiscalite', e.target.value as Fiscalite | '')}
            disabled={submitting}
          >
            <option value="">—</option>
            {(Object.keys(LIBELLE_FISCALITE) as Fiscalite[]).map((f) => (
              <option key={f} value={f}>
                {LIBELLE_FISCALITE[f]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Comptabilité
          <select
            value={champs.comptabilite}
            onChange={(e) => majChamp('comptabilite', e.target.value as Comptabilite | '')}
            disabled={submitting}
          >
            <option value="">—</option>
            {(Object.keys(LIBELLE_COMPTABILITE) as Comptabilite[]).map((c) => (
              <option key={c} value={c}>
                {LIBELLE_COMPTABILITE[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date début exercice
          <input
            type="date"
            value={champs.dateDebutExercice}
            onChange={(e) => majChamp('dateDebutExercice', e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Date fin exercice
          <input
            type="date"
            value={champs.dateFinExercice}
            onChange={(e) => majChamp('dateFinExercice', e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Numéro de TVA intracommunautaire
          <input
            type="text"
            value={champs.numeroTvaIntracom}
            onChange={(e) => majChamp('numeroTvaIntracom', e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Email de contact
          <input
            type="email"
            value={champs.emailContact}
            onChange={(e) => majChamp('emailContact', e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Nom du contact
          <input
            type="text"
            value={champs.contactNom}
            onChange={(e) => majChamp('contactNom', e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Téléphone du contact
          <input
            type="tel"
            value={champs.contactTelephone}
            onChange={(e) => majChamp('contactTelephone', e.target.value)}
            disabled={submitting}
          />
        </label>
        <button onClick={() => void handleEnregistrer()} disabled={submitting}>
          {submitting ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
