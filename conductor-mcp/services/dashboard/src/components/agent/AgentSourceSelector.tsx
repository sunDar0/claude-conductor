import { useEffect, useState, useRef } from 'react';
import { Bot, ChevronDown, Check, Sparkles, Globe, FolderOpen } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { cn } from '../../lib/utils';

const SOURCE_CONFIG: Record<string, { label: string; icon: typeof Bot; color: string }> = {
  default: { label: 'Default', icon: Bot, color: 'text-gray-500' },
  omc: { label: 'OMC', icon: Sparkles, color: 'text-purple-500' },
  global: { label: 'Global', icon: Globe, color: 'text-blue-500' },
  project: { label: 'Project', icon: FolderOpen, color: 'text-green-500' },
};

export function AgentSourceSelector() {
  const { agentSource, availableSources, fetchSources, setAgentSource } = useAgentStore();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentConfig = SOURCE_CONFIG[agentSource] || SOURCE_CONFIG.default;
  const CurrentIcon = currentConfig.icon;

  if (availableSources.length <= 1) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors',
          'hover:bg-gray-100 dark:hover:bg-gray-700',
          isOpen && 'bg-gray-100 dark:bg-gray-700'
        )}
      >
        <CurrentIcon className={cn('w-4 h-4', currentConfig.color)} />
        <span className="hidden sm:inline text-gray-700 dark:text-gray-300">{currentConfig.label}</span>
        <ChevronDown className={cn('w-3 h-3 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 z-50 py-1">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider px-3 py-1">Agent Source</p>
          {availableSources.map((source) => {
            const config = SOURCE_CONFIG[source] || SOURCE_CONFIG.default;
            const Icon = config.icon;
            return (
              <button
                key={source}
                onClick={() => {
                  setAgentSource(source);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                  agentSource === source
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                )}
              >
                <Icon className={cn('w-4 h-4', config.color)} />
                <span className="flex-1 text-left">{config.label}</span>
                {agentSource === source && <Check className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
