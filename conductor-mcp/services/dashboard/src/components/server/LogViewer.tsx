import { useEffect, useRef } from 'react';
import { useServerStore } from '../../store/serverStore';
import { X } from 'lucide-react';

interface Props {
  taskId: string;
}

export function LogViewer({ taskId }: Props) {
  const logs = useServerStore((s) => s.logs[taskId] || []);
  const fetchLogs = useServerStore((s) => s.fetchLogs);
  const selectServer = useServerStore((s) => s.selectServer);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchLogs(taskId);
  }, [taskId, fetchLogs]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-300">Logs: {taskId}</span>
        <button
          onClick={() => selectServer(null)}
          className="p-1 rounded hover:bg-gray-800"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs text-gray-300 space-y-0.5"
      >
        {logs.length === 0 ? (
          <div className="text-gray-500">No logs available</div>
        ) : (
          logs.map((line, i) => (
            <div
              key={i}
              className={
                line.startsWith('[ERR]')
                  ? 'text-red-400'
                  : line.startsWith('[SYS]')
                  ? 'text-yellow-400'
                  : ''
              }
            >
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
