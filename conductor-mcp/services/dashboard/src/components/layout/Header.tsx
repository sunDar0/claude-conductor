import { useEffect, useState, useRef } from 'react';
import { Sun, Moon, Monitor, Wifi, WifiOff, FolderOpen, ChevronDown, Check, Plus, Trash2, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '../common/Button';
import { AddProjectModal } from '../project/AddProjectModal';
import { FileBrowserModal } from '../project/FileBrowserModal';
import { useUIStore } from '../../store/uiStore';
import { useProjectStore, type Project } from '../../store/projectStore';
import { useTaskStore } from '../../store/taskStore';
import { toast } from '../../store/toastStore';
import { cn } from '../../lib/utils';

export function Header() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const wsConnected = useUIStore((s) => s.wsConnected);

  const { projects, currentProject, fetchProjects, setCurrentProject, deleteProject, projectValidity } = useProjectStore();
  const setProjectFilter = useTaskStore((s) => s.setProjectFilter);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [browseProject, setBrowseProject] = useState<Project | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectProject = (project: Project) => {
    setCurrentProject(project);
    setProjectFilter(project.id);  // Re-fetch tasks for this project
    setIsDropdownOpen(false);
    toast.success(`Switched to project: ${project.name}`);
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteConfirm === projectId) {
      await deleteProject(projectId);
      setDeleteConfirm(null);
      toast.success('Project deleted');
    } else {
      setDeleteConfirm(projectId);
      // Reset confirm state after 3 seconds
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  const handleBrowseFiles = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setBrowseProject(project);
  };

  const getValidityIcon = (projectId: string) => {
    const validity = projectValidity[projectId];
    if (validity === undefined) {
      return <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />;
    }
    return validity ? (
      <CheckCircle className="w-3 h-3 text-green-500" />
    ) : (
      <XCircle className="w-3 h-3 text-red-500" />
    );
  };

  const icons = { light: Sun, dark: Moon, system: Monitor };
  const next = { light: 'dark', dark: 'system', system: 'light' } as const;
  const Icon = icons[theme];

  return (
    <header className="h-14 border-b dark:border-gray-700 bg-white dark:bg-gray-800 px-4">
      <div className="h-full flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
              C
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 dark:text-white">Claude Conductor</h1>
              <p className="text-xs text-gray-500">Development Orchestrator</p>
            </div>
          </div>

          {/* Project Selector */}
          <div className="hidden md:block border-l dark:border-gray-700 pl-4 ml-2" ref={dropdownRef}>
            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors',
                  isDropdownOpen
                    ? 'bg-gray-100 dark:bg-gray-700'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700',
                  !currentProject && 'border-2 border-dashed border-amber-400 dark:border-amber-500'
                )}
              >
                <FolderOpen className={cn('w-4 h-4', currentProject ? 'text-gray-500' : 'text-amber-500')} />
                <span className={cn('text-sm font-medium', !currentProject && 'text-amber-600 dark:text-amber-400')}>
                  {currentProject?.name || 'Select Project'}
                </span>
                <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', isDropdownOpen && 'rotate-180')} />
              </button>

              {/* Dropdown */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 z-50">
                  <div className="p-2">
                    <p className="text-xs text-gray-500 px-2 py-1 uppercase tracking-wider">Available Projects</p>
                    {projects.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-gray-500">No projects added yet</p>
                    ) : (
                      projects.map((project) => (
                        <div
                          key={project.id}
                          onClick={() => handleSelectProject(project)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 cursor-pointer',
                            currentProject?.id === project.id
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                          )}
                        >
                          {/* Validity Icon */}
                          <div className="flex-shrink-0">
                            {getValidityIcon(project.id)}
                          </div>

                          {/* Project Info */}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{project.name}</div>
                            <button
                              onClick={(e) => handleBrowseFiles(project, e)}
                              className="text-xs text-gray-500 hover:text-blue-500 hover:underline truncate block max-w-full text-left"
                              title="Click to browse files"
                            >
                              {project.path}
                            </button>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {currentProject?.id === project.id && (
                              <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            )}
                            <button
                              onClick={(e) => handleDeleteProject(project.id, e)}
                              className={cn(
                                'p-1 rounded transition-colors',
                                deleteConfirm === project.id
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-600'
                                  : 'hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-red-500'
                              )}
                              title={deleteConfirm === project.id ? 'Click again to confirm' : 'Delete project'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                    {/* Add Project Button */}
                    <div className="border-t dark:border-gray-700 mt-2 pt-2">
                      <button
                        onClick={() => {
                          setIsDropdownOpen(false);
                          setShowAddModal(true);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add Project</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex items-center gap-1.5 text-sm',
              wsConnected ? 'text-green-500' : 'text-red-500'
            )}
          >
            {wsConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span className="hidden sm:inline">{wsConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTheme(next[theme])}>
            <Icon className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Add Project Modal */}
      <AddProjectModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
      />

      {/* File Browser Modal */}
      {browseProject && (
        <FileBrowserModal
          isOpen={!!browseProject}
          onClose={() => setBrowseProject(null)}
          project={browseProject}
        />
      )}
    </header>
  );
}
