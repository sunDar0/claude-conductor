import { Server, RefreshCw } from 'lucide-react';
import { ServerCard } from './ServerCard';
import { LogViewer } from './LogViewer';
import { Button } from '../common/Button';
import { useServerStore } from '../../store/serverStore';
import { cn } from '../../lib/utils';

export function ServerPanel() {
  const servers = useServerStore((s) => s.servers);
  const selectedId = useServerStore((s) => s.selectedId);
  const loading = useServerStore((s) => s.loading);
  const fetchServers = useServerStore((s) => s.fetchServers);

  const serverList = Object.values(servers);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-gray-500" />
          <h2 className="font-semibold text-gray-900 dark:text-white">Servers</h2>
          <span className="text-sm text-gray-500">({serverList.length})</span>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchServers} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {serverList.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No running servers</div>
        ) : (
          serverList.map((server) => <ServerCard key={server.task_id} server={server} />)
        )}
      </div>

      {selectedId && (
        <div className="h-64 border-t dark:border-gray-700">
          <LogViewer taskId={selectedId} />
        </div>
      )}
    </div>
  );
}
