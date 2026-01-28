import { Square, ExternalLink, FileText } from 'lucide-react';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { useServerStore } from '../../store/serverStore';
import { api } from '../../lib/api';
import type { RunningServer } from '../../types';
import { cn } from '../../lib/utils';

const STATUS_COLORS = {
  starting: 'text-yellow-500',
  running: 'text-green-500',
  stopping: 'text-orange-500',
  stopped: 'text-gray-500',
  error: 'text-red-500',
};

export function ServerCard({ server }: { server: RunningServer }) {
  const selectedId = useServerStore((s) => s.selectedId);
  const selectServer = useServerStore((s) => s.selectServer);
  const removeServer = useServerStore((s) => s.removeServer);

  const isSelected = selectedId === server.task_id;
  const isRunning = server.status === 'running';

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.post(`/servers/${server.task_id}/stop`);
      removeServer(server.task_id);
    } catch (err) {
      console.error('Failed to stop server:', err);
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors cursor-pointer bg-white dark:bg-gray-900',
        isSelected
          ? 'border-blue-500 ring-1 ring-blue-500'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
      )}
      onClick={() => selectServer(isSelected ? null : server.task_id)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
            )}
          />
          <span className="font-medium text-gray-900 dark:text-white">{server.task_id}</span>
        </div>
        <Badge variant="outline" className="text-xs">
          {server.type}
        </Badge>
      </div>

      <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
        <div className="flex justify-between">
          <span>Port</span>
          <code className="text-blue-600">{server.port}</code>
        </div>
        <div className="flex justify-between">
          <span>PID</span>
          <code>{server.pid ?? '-'}</code>
        </div>
        <div className="flex justify-between">
          <span>Status</span>
          <span className={cn('font-medium', STATUS_COLORS[server.status])}>
            {server.status}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t dark:border-gray-700">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            window.open(server.url, '_blank');
          }}
          disabled={!isRunning}
        >
          <ExternalLink className="w-4 h-4 mr-1" />
          Open
        </Button>
        {server.api_docs?.swagger && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              window.open(`${server.url}${server.api_docs!.swagger}`, '_blank');
            }}
            disabled={!isRunning}
          >
            <FileText className="w-4 h-4 mr-1" />
            API
          </Button>
        )}
        {isRunning && (
          <Button variant="danger" size="sm" className="ml-auto" onClick={handleStop}>
            <Square className="w-4 h-4 mr-1" />
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
