import { useState, useEffect } from 'react';
import { X, Folder, File, ChevronRight, ArrowLeft, Home } from 'lucide-react';
import { Button } from '../common/Button';
import { useProjectStore, type Project, type FileEntry } from '../../store/projectStore';
import { cn } from '../../lib/utils';

interface FileBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
}

export function FileBrowserModal({ isOpen, onClose, project }: FileBrowserModalProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(false);
  const getProjectFiles = useProjectStore((s) => s.getProjectFiles);

  useEffect(() => {
    if (isOpen) {
      loadFiles('');
    }
  }, [isOpen, project.id]);

  const loadFiles = async (path: string) => {
    setLoading(true);
    const result = await getProjectFiles(project.id, path);
    setFiles(result);
    setCurrentPath(path);
    setLoading(false);
  };

  const handleNavigate = (entry: FileEntry) => {
    if (entry.type === 'directory') {
      loadFiles(entry.path);
    }
  };

  const handleGoUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    loadFiles(parts.join('/'));
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-lg">{project.name}</h2>
            <p className="text-xs text-gray-500">{project.path}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700 overflow-x-auto">
          <button
            onClick={() => loadFiles('')}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          >
            <Home className="w-4 h-4" />
          </button>
          {pathParts.map((part, index) => (
            <div key={index} className="flex items-center">
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <button
                onClick={() => loadFiles(pathParts.slice(0, index + 1).join('/'))}
                className="px-2 py-1 text-sm hover:bg-gray-200 dark:hover:bg-gray-700 rounded truncate max-w-[150px]"
              >
                {part}
              </button>
            </div>
          ))}
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto p-2">
          {currentPath && (
            <button
              onClick={handleGoUp}
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
          ) : files.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-gray-500">
              Empty directory
            </div>
          ) : (
            files.map((entry) => (
              <button
                key={entry.path}
                onClick={() => handleNavigate(entry)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left',
                  entry.type === 'directory'
                    ? 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
                    : 'text-gray-500 cursor-default'
                )}
              >
                {entry.type === 'directory' ? (
                  <Folder className="w-4 h-4 text-blue-500" />
                ) : (
                  <File className="w-4 h-4 text-gray-400" />
                )}
                <span className="text-sm truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t dark:border-gray-700 text-xs text-gray-500">
          {files.length} items
        </div>
      </div>
    </div>
  );
}
