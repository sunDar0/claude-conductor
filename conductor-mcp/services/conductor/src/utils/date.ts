import { format } from 'date-fns';

export function nowISO(): string {
  return new Date().toISOString();
}

export function formatKorean(isoString: string): string {
  return format(new Date(isoString), 'yyyy-MM-dd HH:mm');
}

export function formatDateOnly(isoString: string): string {
  return format(new Date(isoString), 'yyyy-MM-dd');
}

export function calculateDuration(startISO: string, endISO: string): string {
  const diffMs = new Date(endISO).getTime() - new Date(startISO).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
