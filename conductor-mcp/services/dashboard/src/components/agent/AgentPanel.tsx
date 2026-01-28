import { useEffect } from 'react';
import { Cpu, RefreshCw, CheckCircle, XCircle, Clock, Play, Square, Code, TestTube, Eye, FileText, Shield, Terminal } from 'lucide-react';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { useAgentStore, AgentStatus } from '../../store/agentStore';
import { cn } from '../../lib/utils';

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  code: Code,
  test: TestTube,
  review: Eye,
  docs: FileText,
  security: Shield,
};

const STATUS_ICONS: Record<AgentStatus, React.ComponentType<{ className?: string }>> = {
  idle: Clock,
  ready: Clock,
  running: RefreshCw,
  completed: CheckCircle,
  error: XCircle,
  terminated: Square,
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: 'text-gray-500',
  ready: 'text-blue-500',
  running: 'text-yellow-500 animate-spin',
  completed: 'text-green-500',
  error: 'text-red-500',
  terminated: 'text-gray-400',
};

const ROLE_COLORS: Record<string, string> = {
  code: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  test: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  review: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  docs: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  security: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  performance: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
};

export function AgentPanel() {
  const agents = useAgentStore((s) => s.agents);
  const roles = useAgentStore((s) => s.roles);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchRoles = useAgentStore((s) => s.fetchRoles);
  const loading = useAgentStore((s) => s.loading);

  useEffect(() => {
    fetchAgents();
    fetchRoles();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [fetchAgents, fetchRoles]);

  const agentList = Object.values(agents);
  const running = agentList.filter((a) => a.status === 'running').length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-purple-500" />
          <h2 className="font-semibold">Workers</h2>
          {running > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              {running} running
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchAgents} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Agent Roles Section */}
        {roles.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Available Agent Roles</h3>
            <div className="grid grid-cols-1 gap-2">
              {roles.map((role) => {
                const RoleIcon = ROLE_ICONS[role.role] || Cpu;
                return (
                  <div
                    key={role.role}
                    className="bg-white dark:bg-gray-800 rounded-lg p-3 border dark:border-gray-700 flex items-start gap-3"
                  >
                    <div className={cn('p-2 rounded-lg', ROLE_COLORS[role.role] || 'bg-gray-100')}>
                      <RoleIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{role.name}</span>
                        <Badge className="text-[10px]" variant="outline">{role.role}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{role.description}</p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {role.skills.required.map((skill) => (
                          <span key={skill} className="text-[10px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Active Workers Section */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Active Workers</h3>
          {agentList.length === 0 ? (
            <div className="text-center text-gray-400 py-8 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700">
              <Terminal className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No active workers</p>
              <p className="text-sm mt-1">Start a task to spawn workers</p>
            </div>
          ) : (
          agentList.map((agent) => {
            const Icon = STATUS_ICONS[agent.status];
            return (
              <div
                key={agent.id}
                className="bg-white dark:bg-gray-800 rounded-lg p-3 border dark:border-gray-700 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-4 h-4', STATUS_COLORS[agent.status])} />
                    <Badge className={ROLE_COLORS[agent.role] || 'bg-gray-100 text-gray-800'}>
                      {agent.role}
                    </Badge>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {agent.status}
                  </Badge>
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                  <div className="flex items-center gap-1">
                    <Play className="w-3 h-3" />
                    <span>Task: {agent.task_id || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Terminal className="w-3 h-3" />
                    <span>{agent.skills_loaded.join(', ') || 'CLI'}</span>
                  </div>
                  <div className="font-mono text-[10px] text-gray-400">
                    ID: {agent.id.slice(-16)}
                  </div>
                </div>

                {agent.status === 'running' && (
                  <div className="mt-2 pt-2 border-t dark:border-gray-700">
                    <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                      <div className="h-full bg-yellow-500 animate-pulse w-2/3" />
                    </div>
                  </div>
                )}

                {agent.error && (
                  <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-400">
                    Error: {agent.error}
                  </div>
                )}
              </div>
            );
          })
        )}
        </div>
      </div>
    </div>
  );
}
