import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
}

interface ToastContextValue {
  notifier: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Confirmation discrète après une action réussie (anomalie résolue, calcul
// validé, encaissement qualifié, etc.) — cf. brief refonte : pas de
// confettis, juste un accusé de réception sobre qui s'efface tout seul.
const DUREE_AFFICHAGE_MS = 2600;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const compteur = useRef(0);

  const notifier = useCallback((message: string) => {
    const id = ++compteur.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DUREE_AFFICHAGE_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ notifier }}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span className="toast-check" aria-hidden="true">
              ✓
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé sous ToastProvider');
  return ctx.notifier;
}
