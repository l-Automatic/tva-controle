import { AnomaliesPanel } from '../AnomaliesPanel';
import { AuditPanel } from '../AuditPanel';
import { CalculsPanel } from '../CalculsPanel';

interface HistoriqueZoneProps {
  cabinetId: string;
  dossierId: string;
  utilisateurId: string;
}

// Calculs passés (toutes périodes), anomalies passées (toutes périodes,
// filtrables), audit + export — cf. brief refonte, section 3, zone
// "Historique".
export function HistoriqueZone({ cabinetId, dossierId, utilisateurId }: HistoriqueZoneProps) {
  return (
    <>
      <CalculsPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} />
      <AnomaliesPanel cabinetId={cabinetId} dossierId={dossierId} utilisateurId={utilisateurId} variant="historique" />
      <AuditPanel cabinetId={cabinetId} dossierId={dossierId} />
    </>
  );
}
