import { cn } from '../../lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'outline';
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      variant === 'default' && 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
      variant === 'outline' && 'border border-gray-300 dark:border-gray-600',
      className
    )}>
      {children}
    </span>
  );
}
