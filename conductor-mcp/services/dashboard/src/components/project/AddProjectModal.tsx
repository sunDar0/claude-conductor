import { useState } from 'react';
import { X, FolderPlus, FolderOpen } from 'lucide-react';
import { api } from '../../lib/api';
import { useProjectStore } from '../../store/projectStore';
import { toast } from '../../store/toastStore';
import { DirectoryPickerModal } from './DirectoryPickerModal';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddProjectModal({ isOpen, onClose }: AddProjectModalProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Project name is required');
      return;
    }

    if (!path.trim()) {
      setError('Project path is required');
      return;
    }

    setLoading(true);
    setError(null);

    const toastId = toast.loading('Adding project...');

    try {
      await api.post('/projects', { name, path, description });
      await fetchProjects();
      toast.update(toastId, 'success', `Project "${name}" added successfully`);
      setName('');
      setPath('');
      setDescription('');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add project';
      toast.update(toastId, 'error', message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold">Add Project</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Project Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="My Project"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Project Path *</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1 px-3 py-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                placeholder="/Users/username/projects/my-project"
              />
              <button
                type="button"
                onClick={() => setShowDirectoryPicker(true)}
                className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border dark:border-gray-600 rounded-lg flex items-center gap-2"
                title="Browse directories"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Full path to the project directory
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Optional description..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Adding...' : 'Add Project'}
            </button>
          </div>
        </form>

        <DirectoryPickerModal
          isOpen={showDirectoryPicker}
          onClose={() => setShowDirectoryPicker(false)}
          onSelect={(selectedPath) => {
            setPath(selectedPath);
            // Auto-fill project name from directory name if empty
            if (!name.trim()) {
              const dirName = selectedPath.split('/').filter(Boolean).pop() || '';
              setName(dirName);
            }
          }}
          initialPath={path || undefined}
        />
      </div>
    </div>
  );
}
