import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'loading';

interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  onClose: (id: string) => void;
  duration?: number;
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  loading: Loader2,
};

// Dynamic Island style - dark pill-shaped toasts
const styles = {
  success: 'bg-gray-900 text-green-400 border-gray-800',
  error: 'bg-gray-900 text-red-400 border-gray-800',
  info: 'bg-gray-900 text-blue-400 border-gray-800',
  loading: 'bg-gray-900 text-gray-300 border-gray-800',
};

export function Toast({ id, type, message, onClose, duration = 5000 }: ToastProps) {
  const Icon = icons[type];

  useEffect(() => {
    if (type !== 'loading' && duration > 0) {
      const timer = setTimeout(() => onClose(id), duration);
      return () => clearTimeout(timer);
    }
  }, [id, type, duration, onClose]);

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-5 py-3 rounded-full border shadow-2xl animate-slide-in backdrop-blur-sm',
        styles[type]
      )}
    >
      <Icon className={cn('w-4 h-4 flex-shrink-0', type === 'loading' && 'animate-spin')} />
      <span className="text-sm font-medium whitespace-nowrap">{message}</span>
      {type !== 'loading' && (
        <button
          onClick={() => onClose(id)}
          className="p-1 hover:bg-white/10 rounded-full ml-1"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
