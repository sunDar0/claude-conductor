import { Toast } from './Toast';
import { useToastStore } from '../../store/toastStore';

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center space-y-3 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast
            id={t.id}
            type={t.type}
            message={t.message}
            onClose={removeToast}
          />
        </div>
      ))}
    </div>
  );
}
