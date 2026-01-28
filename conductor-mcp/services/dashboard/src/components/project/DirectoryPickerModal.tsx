import { useState, useEffect } from 'react';
import { X, Folder, ChevronRight, ArrowLeft, Home, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

interface DirectoryEntry {
  name: string;
  path: string;
}

interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
}

interface DirectoryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function DirectoryPickerModal({ isOpen, onClose, onSelect, initialPath }: DirectoryPickerModalProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath || '');
    }
  }, [isOpen, initialPath]);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<BrowseResponse>('/filesystem/browse', { path });
      setCurrentPath(response.currentPath);
      setParentPath(response.parentPath);
      setDirectories(response.directories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = () => {
    onSelect(currentPath);
    onClose();
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
          <h2 className="font-semibold text-lg">Select Directory</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Path Display */}
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700">
          <div className="flex items-center gap-1 overflow-x-auto text-sm">
            <button
              onClick={() => loadDirectory('/')}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded flex-shrink-0"
            >
              <Home className="w-4 h-4" />
            </button>
            {pathParts.map((part, index) => (
              <div key={index} className="flex items-center flex-shrink-0">
                <ChevronRight className="w-4 h-4 text-gray-400" />
                <button
                  onClick={() => loadDirectory('/' + pathParts.slice(0, index + 1).join('/'))}
                  className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded truncate max-w-[120px]"
                  title={part}
                >
                  {part}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Directory List */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[300px]">
          {error && (
            <div className="p-3 mb-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-sm">
              {error}
            </div>
          )}

          {parentPath && (
            <button
              onClick={() => loadDirectory(parentPath)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-left"
            >
              <ArrowLeft className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-500">..</span>
            </button>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-500">
              Loading...
            </div>
          ) : directories.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-gray-500">
              No subdirectories
            </div>
          ) : (
            directories.map((dir) => (
              <button
                key={dir.path}
                onClick={() => loadDirectory(dir.path)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left',
                  'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
                )}
              >
                <Folder className="w-4 h-4 text-blue-500" />
                <span className="text-sm truncate">{dir.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t dark:border-gray-700 flex items-center justify-between">
          <div className="text-sm text-gray-500 truncate flex-1 mr-4 font-mono">
            {currentPath}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              disabled={!currentPath}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
