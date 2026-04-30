import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  showToast: (message: string, action?: { label: string; onClick: () => void }) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, action?: { label: string; onClick: () => void }) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, action }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}>
          {toasts.map(t => (
            <div
              key={t.id}
              style={{
                pointerEvents: 'auto',
                background: '#1c1b32',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '10px 14px',
                color: '#ddd',
                fontSize: 13,
                maxWidth: 340,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                animation: 'toastSlideIn 0.2s ease-out',
              }}
            >
              <span style={{ flex: 1 }}>{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                  style={{
                    background: 'rgba(200,83,28,0.2)',
                    border: '1px solid rgba(200,83,28,0.4)',
                    borderRadius: 4,
                    color: '#e0763f',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                style={{
                  background: 'none', border: 'none', color: '#666',
                  cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1,
                }}
              >
                {'\u00D7'}
              </button>
            </div>
          ))}
        </div>
      )}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
