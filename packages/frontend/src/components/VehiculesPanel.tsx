import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { ApiError, ajouterVehicule, fetchVehicules, retirerVehicule } from '../api';
import { ICONE_ACTION } from '../icons';
import { useToast } from '../toast';
import {
  LIBELLE_TYPE_BIEN_VEHICULE,
  LIBELLE_TYPE_CARBURANT,
  TYPES_BIEN_VEHICULE,
  TYPES_CARBURANT,
  type TypeBienVehicule,
  type TypeCarburant,
  type Vehicule,
} from '../types';

interface VehiculesPanelProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

function formatMontant(montant: number | null): string {
  if (montant === null) return '—';
  return `${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;
}

// Formulaire simple, confirmé immédiatement (pas de candidate/confirmed) —
// alimente notamment le contrôle "flotte mixte" (véhicules tourisme ET
// utilitaires) et la déductibilité carburant, jusqu'ici sans aucun moyen de
// renseigner le parc autrement qu'à la main dans Pennylane (cf. brief v6).
export function VehiculesPanel({ cabinetId, dossierId, utilisateurId }: VehiculesPanelProps) {
  const [vehicules, setVehicules] = useState<Vehicule[]>([]);
  const [designation, setDesignation] = useState('');
  const [typeBien, setTypeBien] = useState<TypeBienVehicule>('vehicule_tourisme');
  const [montantHt, setMontantHt] = useState('');
  const [dateAcquisition, setDateAcquisition] = useState('');
  const [typeCarburant, setTypeCarburant] = useState<TypeCarburant | ''>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retraitEnCours, setRetraitEnCours] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notifier = useToast();

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      setVehicules(await fetchVehicules(cabinetId, dossierId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger le parc de véhicules');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  async function handleAjouter() {
    setSubmitting(true);
    setError(null);
    try {
      const montant = montantHt.trim() ? Number.parseFloat(montantHt.trim().replace(',', '.')) : undefined;
      if (montant !== undefined && Number.isNaN(montant)) {
        setError('Le montant HT doit être un nombre');
        setSubmitting(false);
        return;
      }
      await ajouterVehicule(
        cabinetId,
        dossierId,
        {
          ...(designation.trim() ? { designation: designation.trim() } : {}),
          typeBien,
          ...(montant !== undefined ? { montantHt: montant } : {}),
          ...(dateAcquisition ? { dateAcquisition } : {}),
          ...(typeCarburant ? { typeCarburant } : {}),
        },
        utilisateurId
      );
      notifier('Véhicule ajouté');
      setDesignation('');
      setMontantHt('');
      setDateAcquisition('');
      setTypeCarburant('');
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'ajout");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetirer(id: string) {
    setRetraitEnCours(id);
    setError(null);
    try {
      await retirerVehicule(cabinetId, id, utilisateurId);
      notifier('Véhicule retiré');
      await charger();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du retrait');
    } finally {
      setRetraitEnCours(null);
    }
  }

  return (
    <section className="panel panel-full">
      <div className="panel-header">
        <h2>Parc de véhicules ({vehicules.length})</h2>
      </div>
      <p className="reference">
        Détermine la déductibilité du carburant (80 % tourisme / 100 % utilitaire) et signale les cas de flotte
        mixte — renseigné une fois pour toutes, sans workflow de confirmation.
      </p>
      {error && <p className="error">{error}</p>}
      {!loading && vehicules.length === 0 && <p className="empty">Aucun véhicule renseigné pour ce dossier.</p>}
      <ul className="card-list">
        {vehicules.map((v) => (
          <li key={v.id} className="card">
            <p className="label">
              {v.designation ?? 'Véhicule sans désignation'} — <strong>{LIBELLE_TYPE_BIEN_VEHICULE[v.typeBien]}</strong>
            </p>
            <p className="reference">
              {formatMontant(v.montantHt)}
              {v.dateAcquisition ? ` — acquis le ${v.dateAcquisition.split('T')[0]}` : ''}
              {v.typeCarburant ? ` — ${LIBELLE_TYPE_CARBURANT[v.typeCarburant]}` : ''}
            </p>
            <div className="actions">
              <button
                className="secondary"
                disabled={retraitEnCours === v.id}
                onClick={() => void handleRetirer(v.id)}
              >
                <ICONE_ACTION.rejeter size={14} aria-hidden="true" />
                {retraitEnCours === v.id ? '…' : 'Retirer'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="cycle-form">
        <label>
          Désignation
          <input
            type="text"
            placeholder="ex : Renault Trafic"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Type
          <select value={typeBien} onChange={(e) => setTypeBien(e.target.value as TypeBienVehicule)} disabled={submitting}>
            {TYPES_BIEN_VEHICULE.map((t) => (
              <option key={t} value={t}>
                {LIBELLE_TYPE_BIEN_VEHICULE[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Montant HT
          <input
            type="text"
            inputMode="decimal"
            placeholder="optionnel"
            value={montantHt}
            onChange={(e) => setMontantHt(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Date d'acquisition
          <input
            type="date"
            value={dateAcquisition}
            onChange={(e) => setDateAcquisition(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Carburant
          <select
            value={typeCarburant}
            onChange={(e) => setTypeCarburant(e.target.value as TypeCarburant | '')}
            disabled={submitting}
          >
            <option value="">Non renseigné</option>
            {TYPES_CARBURANT.map((t) => (
              <option key={t} value={t}>
                {LIBELLE_TYPE_CARBURANT[t]}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void handleAjouter()} disabled={submitting}>
          <Plus size={14} aria-hidden="true" />
          {submitting ? '…' : 'Ajouter'}
        </button>
      </div>
    </section>
  );
}
