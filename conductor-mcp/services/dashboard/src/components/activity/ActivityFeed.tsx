import { useUIStore } from '../../store/uiStore';
import { formatRelativeTime } from '../../lib/utils';
import { Activity, GitBranch, Server, CheckCircle, XCircle } from 'lucide-react';

const TYPE_ICONS: Record<string, React.ElementType> = {
  'task.created': Activity,
  'task.started': GitBranch,
  'task.transitioned': CheckCircle,
  'server.started': Server,
  'server.stopped': XCircle,
};

export function ActivityFeed() {
  const activities = useUIStore((s) => s.activities);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b dark:border-gray-700">
        <Activity className="w-5 h-5 text-gray-500" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Activity</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activities.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No recent activity</div>
        ) : (
          <div className="space-y-3">
            {activities.map((activity) => {
              const Icon = TYPE_ICONS[activity.type] || Activity;
              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800"
                >
                  <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700">
                    <Icon className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-white">{activity.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs text-blue-600">{activity.task_id}</code>
                      <span className="text-xs text-gray-400">
                        {formatRelativeTime(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
