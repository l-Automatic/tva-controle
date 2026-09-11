import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { ApiError, ajouterVehicule, fetchVehicules, retirerVehicule } from '../api';
import { formatDate } from '../dateUtils';
import { ICONE_ACTION } from '../icons';
import { formatMontant as formatMontantEuros } from '../montantUtils';
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
  // Brief v70, point 1 : badge de l'onglet côté PortesObligatoiresPopup,
  // sourcé jusqu'ici depuis l'instantané initial de l'agrégateur
  // (parcVehiculesNonRenseigne) — remonte désormais le même booléen 0/1
  // depuis l'état local réellement affiché, dès qu'un véhicule est ajouté
  // ou retiré, sans attendre un rechargement complet.
  onCountChange?: (n: number) => void;
}

function formatMontant(montant: number | null): string {
  return montant === null ? 'montant inconnu' : formatMontantEuros(montant);
}

// Formulaire simple, confirmé immédiatement (pas de candidate/confirmed) —
// alimente notamment le contrôle "flotte mixte" (véhicules tourisme ET
// utilitaires) et la déductibilité carburant, jusqu'ici sans aucun moyen de
// renseigner le parc autrement qu'à la main dans Pennylane (cf. brief v6).
export function VehiculesPanel({ cabinetId, dossierId, utilisateurId, onCountChange }: VehiculesPanelProps) {
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
  // Contrairement aux 3 autres onglets, ce panneau ne reçoit aucune donnée
  // initiale de l'agrégateur : il refait toujours sa propre requête au
  // montage. Sans cette garde, le tableau vehicules=[] du tout premier
  // rendu (avant que charger() n'ait fini) ferait passer le badge à "(1)"
  // même quand des véhicules existent déjà, le temps d'un aller-retour.
  const [chargeInitiale, setChargeInitiale] = useState(false);
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
      setChargeInitiale(true);
    }
  }

  useEffect(() => {
    if (cabinetId && dossierId) void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetId, dossierId]);

  useEffect(() => {
    if (!chargeInitiale) return;
    onCountChange?.(vehicules.length === 0 ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicules.length, chargeInitiale]);

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
        mixte. Renseigné une fois pour toutes, sans workflow de confirmation.
      </p>
      {/* Passait trop inaperçu en simple texte de référence (brief v54) —
          même classe que MessageCalculIncomplet (CalculsPanel.tsx), seul
          autre rappel de ce genre dans l'app, plus gras pour renforcer
          encore la mise en évidence. */}
      <p className="avertissement">
        <strong>
          Pensez à ajouter aussi les véhicules en location/crédit-bail à ce parc, et à les retirer une fois le
          contrat terminé.
        </strong>
      </p>
      {error && <p className="error">{error}</p>}
      {!loading && vehicules.length === 0 && <p className="empty">Aucun véhicule renseigné pour ce dossier.</p>}
      <ul className="card-list">
        {vehicules.map((v) => (
          <li key={v.id} className="card">
            <p className="label">
              {v.designation ?? 'Véhicule sans désignation'}, <strong>{LIBELLE_TYPE_BIEN_VEHICULE[v.typeBien]}</strong>
            </p>
            <p className="reference">
              {formatMontant(v.montantHt)}
              {v.dateAcquisition ? `, acquis le ${formatDate(v.dateAcquisition)}` : ''}
              {v.typeCarburant ? `, ${LIBELLE_TYPE_CARBURANT[v.typeCarburant]}` : ''}
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
