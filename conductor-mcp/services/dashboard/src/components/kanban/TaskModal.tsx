import { Calendar, Check, Clock, FileText, GitBranch, RotateCcw, X, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import { cn, formatRelativeTime } from '../../lib/utils';
import { useTaskStore } from '../../store/taskStore';
import { toast } from '../../store/toastStore';
import { useUIStore } from '../../store/uiStore';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

const PRIORITY_COLORS = {
  low: 'bg-gray-400 text-gray-800',
  medium: 'bg-blue-400 text-blue-800',
  high: 'bg-orange-400 text-orange-800',
  critical: 'bg-red-500 text-white',
};

const STATUS_COLORS = {
  BACKLOG: 'bg-gray-500',
  READY: 'bg-blue-500',
  IN_PROGRESS: 'bg-amber-500',
  REVIEW: 'bg-purple-500',
  DONE: 'bg-green-500',
};

// Parse output line with event type prefix
function parseOutputLine(line: string): { type: string; content: string } {
  const match = line.match(/^\[(init|thinking|tool|complete|error|info)\](.*)$/s);
  if (match) {
    return { type: match[1], content: match[2] };
  }
  return { type: 'info', content: line };
}

// Style classes for different event types
const OUTPUT_STYLES = {
  init: 'text-blue-400',
  thinking: 'text-gray-300',
  tool: 'text-yellow-400',
  complete: 'text-green-400 font-medium',
  error: 'text-red-400',
  info: 'text-gray-400',
};

// Extract Final Result from pipeline output lines
function extractFinalResultFromOutput(lines: string[] | undefined): string | null {
  if (!lines || lines.length === 0) return null;

  for (const line of lines) {
    const { type, content } = parseOutputLine(line);
    if (type === 'complete' && content) {
      // Format: "✅ 작업 완료 (30.5초, $0.5775)\n\n{result}"
      // Extract everything after the double newline
      const parts = content.split('\n\n');
      if (parts.length > 1) {
        return parts.slice(1).join('\n\n').trim();
      }
      // If no double newline, try to remove the prefix
      const cleaned = content.replace(/^✅\s*작업 완료.*?\)\s*/, '').trim();
      return cleaned || null;
    }
  }
  return null;
}

// Extract Final Result from context file content
function extractFinalResultFromContext(content: string | null): string | null {
  if (!content) return null;

  // Try multiple patterns to find final result
  // Pattern 1: "### Final Result" section
  const finalResultMatch = content.match(/### Final Result\s*\n([\s\S]*?)(?=\n##|$)/);
  if (finalResultMatch) {
    return finalResultMatch[1].trim();
  }

  // Pattern 2: Last "## Pipeline Output" section content
  const pipelineMatch = content.match(/## Pipeline Output[^\n]*\n\n([\s\S]*?)(?=\n## |$)/);
  if (pipelineMatch) {
    const pipelineContent = pipelineMatch[1].trim();
    // If it's not just "(no output)", return it
    if (pipelineContent && pipelineContent !== '(no output)') {
      return pipelineContent;
    }
  }

  return null;
}

export function TaskModal() {
  const taskModalId = useUIStore((s) => s.taskModalId);
  const closeTaskModal = useUIStore((s) => s.closeTaskModal);
  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const pipelineOutput = useTaskStore((s) => s.pipelineOutput);
  const clearPipelineOutput = useTaskStore((s) => s.clearPipelineOutput);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextContent, setContextContent] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(false);
  const liveLogRef = useRef<HTMLDivElement>(null);

  const task = taskModalId ? tasks[taskModalId] : null;
  const liveOutput = taskModalId ? pipelineOutput[taskModalId] : undefined;

  // Extract Final Result for REVIEW status (try live output first, then context file)
  const finalResult = extractFinalResultFromOutput(liveOutput) || extractFinalResultFromContext(contextContent);

  // Auto-scroll live output to bottom
  useEffect(() => {
    if (liveLogRef.current && liveOutput?.length) {
      liveLogRef.current.scrollTop = liveLogRef.current.scrollHeight;
    }
  }, [liveOutput]);

  // Fetch context when modal opens or status changes
  useEffect(() => {
    if (taskModalId) {
      api.get<{ content: string }>(`/tasks/${taskModalId}/context`)
        .then(res => setContextContent(res.content))
        .catch(() => setContextContent(null));
    }
    return () => {
      setContextContent(null);
      setShowContext(false);
    };
  }, [taskModalId, task?.status]);

  const handleApprove = async () => {
    if (!task) return;
    setLoading(true);
    try {
      await api.post(`/tasks/${task.id}/transition`, { target_state: 'DONE' });
      toast.success('태스크가 완료되었습니다');
      await fetchTasks();
      closeTaskModal();
    } catch (err) {
      toast.error('승인 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!task || !feedback.trim()) {
      toast.error('반려 사유를 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      await api.post(`/tasks/${task.id}/transition`, {
        target_state: 'BACKLOG',
        feedback: feedback.trim()
      });
      toast.info('태스크가 백로그로 이동되었습니다');
      setFeedback('');
      await fetchTasks();
      closeTaskModal();
    } catch (err) {
      toast.error('반려 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleRerun = async () => {
    if (!task || !feedback.trim()) {
      toast.error('피드백을 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      // Clear previous pipeline output before rerun
      clearPipelineOutput(task.id);
      await api.post(`/tasks/${task.id}/transition`, {
        target_state: 'READY',
        feedback: feedback.trim()
      });
      await api.post(`/tasks/${task.id}/run`);
      toast.success('AI가 작업을 다시 시작합니다');
      setFeedback('');
      await fetchTasks();
      closeTaskModal();
    } catch (err) {
      toast.error('재실행 실패');
    } finally {
      setLoading(false);
    }
  };

  if (!task) {
    return (
      <Modal isOpen={!!taskModalId} onClose={closeTaskModal} title="Task Not Found">
        <p className="text-gray-500">The task could not be found.</p>
      </Modal>
    );
  }

  return (
    <Modal isOpen={true} onClose={closeTaskModal} title={task.id} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className={cn('w-3 h-3 rounded-full', STATUS_COLORS[task.status])} />
          <span className="text-sm font-medium">{task.status.replace('_', ' ')}</span>
          <Badge className={cn('ml-2', PRIORITY_COLORS[task.priority])}>
            {task.priority}
          </Badge>
        </div>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          {task.title}
        </h2>

        {task.description && (
          <p className="text-gray-600 dark:text-gray-300">{task.description}</p>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          {task.branch && (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <GitBranch className="w-4 h-4" />
              <code className="text-blue-600 dark:text-blue-400">{task.branch}</code>
            </div>
          )}
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <FileText className="w-4 h-4" />
            <span className="truncate">{task.context_file}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Calendar className="w-4 h-4" />
            <span>Created {formatRelativeTime(task.created_at)}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Clock className="w-4 h-4" />
            <span>Updated {formatRelativeTime(task.updated_at)}</span>
          </div>
        </div>

        {/* Live Output - IN_PROGRESS */}
        {task.status === 'IN_PROGRESS' && (
          <div className="border-t dark:border-gray-700 pt-4">
            <div className="flex items-center gap-2 font-medium mb-2 text-amber-600 dark:text-amber-400">
              <Terminal className="w-4 h-4 animate-pulse" />
              <span>AI 작업 중...</span>
              <span className="text-xs text-gray-500 ml-2">
                {liveOutput?.length || 0} events
              </span>
            </div>
            <div
              ref={liveLogRef}
              className="p-3 bg-gray-900 rounded-lg overflow-auto h-64 font-mono text-sm"
            >
              {liveOutput?.length ? (
                liveOutput.map((line, i) => {
                  const { type, content } = parseOutputLine(line);
                  return (
                    <div
                      key={i}
                      className={cn(
                        'whitespace-pre-wrap py-1 border-b border-gray-800 last:border-0',
                        OUTPUT_STYLES[type as keyof typeof OUTPUT_STYLES] || OUTPUT_STYLES.info
                      )}
                    >
                      {content}
                    </div>
                  );
                })
              ) : (
                <div className="text-gray-500 flex items-center gap-2">
                  <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                  Waiting for AI response...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Final Result - shown in REVIEW status */}
        {task.status === 'REVIEW' && (
          <div className="border-t dark:border-gray-700 pt-4">
            <h3 className="flex items-center gap-2 font-medium mb-2 text-green-600 dark:text-green-400">
              <Check className="w-4 h-4" />
              Final Result
            </h3>
            {finalResult ? (
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg overflow-auto max-h-64 prose prose-sm dark:prose-invert prose-headings:text-base prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:text-xs max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalResult}</ReactMarkdown>
              </div>
            ) : (
              <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-500">
                AI 작업 결과는 아래 Pipeline Output에서 확인하세요.
              </div>
            )}
          </div>
        )}

        {/* Pipeline Output / Context */}
        {contextContent && (
          <div className="border-t dark:border-gray-700 pt-4">
            <button
              onClick={() => setShowContext(!showContext)}
              className="flex items-center gap-2 font-medium mb-2 hover:text-blue-600"
            >
              {showContext ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Pipeline Output
            </button>
            {showContext && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg overflow-auto max-h-96 prose prose-sm dark:prose-invert prose-headings:text-base prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:text-xs max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{contextContent}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {task.feedback_history.length > 0 && (
          <div className="border-t dark:border-gray-700 pt-4">
            <h3 className="font-medium mb-2">Feedback History</h3>
            <div className="space-y-2">
              {task.feedback_history.map((fb) => (
                <div
                  key={fb.id}
                  className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
                >
                  <p className="text-gray-700 dark:text-gray-300">{fb.content}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatRelativeTime(fb.created_at)}
                    {fb.resolved && ' - Resolved'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Review Actions */}
        {task.status === 'REVIEW' && (
          <div className="border-t dark:border-gray-700 pt-4 space-y-3">
            <h3 className="font-medium">Review Actions</h3>

            {/* Feedback Input - always visible, used for reject/rerun */}
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                피드백 (반려/재실행 시 필수)
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="수정 사항이나 피드백을 입력하세요..."
                className="w-full px-3 py-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm resize-none"
                rows={3}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                variant="success"
                onClick={handleApprove}
                disabled={loading}
              >
                <Check className="w-4 h-4 mr-1" />
                승인 (DONE)
              </Button>
              <Button
                variant="secondary"
                onClick={handleReject}
                disabled={loading || !feedback.trim()}
                title={!feedback.trim() ? '피드백을 입력해주세요' : ''}
              >
                <X className="w-4 h-4 mr-1" />
                반려 (BACKLOG)
              </Button>
              <Button
                variant="warning"
                onClick={handleRerun}
                disabled={loading || !feedback.trim()}
                title={!feedback.trim() ? '피드백을 입력해주세요' : ''}
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                재실행
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
          <Button variant="secondary" onClick={closeTaskModal}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
