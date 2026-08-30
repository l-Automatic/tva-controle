import { AnomaliesPanel } from '../AnomaliesPanel';
import { AuditPanel } from '../AuditPanel';
import { CalculsPanel } from '../CalculsPanel';
import type { Anomalie } from '../../types';

interface HistoriqueZoneProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
  onCompteNonReconnuClic?: (anomalie: Anomalie) => void;
}

// Calculs passés (toutes périodes), anomalies passées (toutes périodes,
// filtrables), audit + export — cf. brief refonte, section 3, zone
// "Historique".
export function HistoriqueZone({ cabinetId, dossierId, utilisateurId, onCompteNonReconnuClic }: HistoriqueZoneProps) {
  return (
    <>
      <CalculsPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <AnomaliesPanel
        cabinetId={cabinetId}
        dossierId={dossierId}
        utilisateurId={utilisateurId}
        variant="historique"
        onCompteNonReconnuClic={onCompteNonReconnuClic}
      />
      <AuditPanel cabinetId={cabinetId} dossierId={dossierId} />
    </>
  );
}
