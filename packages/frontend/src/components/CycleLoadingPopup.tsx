import { JaugeChargement } from './JaugeChargement';

interface CycleLoadingPopupProps {
  phase: 'chargement' | 'succes';
  messageSucces: string;
}

export function CycleLoadingPopup({ phase, messageSucces }: CycleLoadingPopupProps) {
  return (
    <div className="popup-overlay">
      <div className="popup popup-cycle-loading" role="status" aria-live="polite">
        <JaugeChargement phase={phase} messageSucces={messageSucces} />
      </div>
    </div>
  );
}
