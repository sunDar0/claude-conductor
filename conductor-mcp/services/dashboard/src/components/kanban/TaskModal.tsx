import { AlertCircle, Calendar, Check, ChevronDown, ChevronUp, Clock, Eye, EyeOff, FileText, GitBranch, GitCommit, Maximize2, Minimize2, Play, RotateCcw, StopCircle, Terminal, Trash2, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import { cn, formatRelativeTime } from '../../lib/utils';
import { useTaskStore } from '../../store/taskStore';
import { toast, useToastStore } from '../../store/toastStore';
import { useUIStore } from '../../store/uiStore';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

const STATUS_COLORS = {
  BACKLOG: 'bg-gray-400',
  READY: 'bg-blue-500',
  IN_PROGRESS: 'bg-amber-500',
  REVIEW: 'bg-purple-500',
  DONE: 'bg-green-500',
  CLOSED: 'bg-gray-300',
};

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
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

// Diff 코드 블록 렌더러 - +/- 라인에 색상 적용
function DiffCodeBlock({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const isDiff = className?.includes('language-diff');
  const content = String(children || '');

  if (!isDiff) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  // diff 라인별로 색상 적용
  const lines = content.split('\n');
  return (
    <code className={className} {...props}>
      {lines.map((line, i) => {
        let lineClass = '';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          lineClass = 'diff-line-add';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineClass = 'diff-line-remove';
        } else if (line.startsWith('@@')) {
          lineClass = 'diff-line-header';
        } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
          lineClass = 'diff-line-file';
        }
        return (
          <span key={i} className={lineClass}>
            {line}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        );
      })}
    </code>
  );
}

// ReactMarkdown 커스텀 컴포넌트
const markdownComponents = {
  code: DiffCodeBlock,
};

// Strip orchestration agent role prefix like "[test] ", "[code] " etc.
function stripRolePrefix(text: string): string {
  return text.replace(/^\[[\w-]+\]\s*/, '');
}

// Extract Final Result from pipeline output lines
function extractFinalResultFromOutput(lines: string[] | undefined): string | null {
  if (!lines || lines.length === 0) return null;

  for (const line of lines) {
    const { type, content } = parseOutputLine(line);
    if (type === 'complete' && content) {
      const cleaned = stripRolePrefix(content);
      // Format: "✅ 작업 완료 (30.5초, $0.5775)\n\n{result}"
      // Extract everything after the double newline
      const parts = cleaned.split('\n\n');
      if (parts.length > 1) {
        return parts.slice(1).join('\n\n').trim();
      }
      // If no double newline, try to remove the prefix
      const withoutEmoji = cleaned.replace(/^✅\s*작업 완료.*?\)\s*/, '').trim();
      return withoutEmoji || null;
    }
  }
  return null;
}

// Extract the last output section from context (regular or orchestrated)
function findLastOutputSection(content: string): { type: 'regular' | 'orchestrated'; body: string } | null {
  // Find all output section start positions
  const sections: Array<{ type: 'regular' | 'orchestrated'; index: number }> = [];

  const regularPattern = /## Pipeline Output[^\n]*\n/g;
  const orchestratedPattern = /## Orchestrated Pipeline Output[^\n]*\n/g;

  let match;
  while ((match = regularPattern.exec(content)) !== null) {
    sections.push({ type: 'regular', index: match.index });
  }
  while ((match = orchestratedPattern.exec(content)) !== null) {
    sections.push({ type: 'orchestrated', index: match.index });
  }

  if (sections.length === 0) return null;

  // Sort by position and take the last one
  sections.sort((a, b) => a.index - b.index);
  const last = sections[sections.length - 1];

  // Extract body from the section start to the next top-level section or end
  const afterSection = content.substring(last.index);
  // Find next ## Pipeline Output or ## Orchestrated Pipeline Output (another run)
  const nextRunMatch = afterSection.match(/\n## (?:Pipeline Output|Orchestrated Pipeline Output)/);
  const body = nextRunMatch
    ? afterSection.substring(0, nextRunMatch.index)
    : afterSection;

  return { type: last.type, body };
}

// Extract the code/executor agent's output from orchestrated output
function extractCodeAgentOutput(orchestratedBody: string): string | null {
  // Try multiple agent names that do implementation work
  for (const name of ['code', 'executor']) {
    const result = extractAgentOutput(orchestratedBody, name);
    if (result) return result;
  }
  return null;
}

// Extract a specific agent's output from orchestrated output by exact name
function extractAgentOutput(orchestratedBody: string, role: string): string | null {
  const pattern = new RegExp(`### ${role} Agent \\(success\\)\\n([\\s\\S]*?)(?=\\n### [\\w-]+ Agent \\(|$)`);
  const match = orchestratedBody.match(pattern);
  if (match) {
    return match[1].replace(/\n> 소요:.*$/m, '').trim();
  }
  return null;
}

// Try multiple agent name candidates, return first match
function extractAgentOutputMulti(orchestratedBody: string, candidates: string[]): string | null {
  for (const name of candidates) {
    const result = extractAgentOutput(orchestratedBody, name);
    if (result) return result;
  }
  return null;
}

// Extract Final Result from context file content (가장 최근 Pipeline Output의 Final Result)
function extractFinalResultFromContext(content: string | null): string | null {
  if (!content) return null;

  const lastSection = findLastOutputSection(content);

  if (lastSection?.type === 'orchestrated') {
    // For orchestrated output, use the code agent's output as the final result
    return extractCodeAgentOutput(lastSection.body);
  }

  // Regular pipeline: find "### Final Result"
  const lastIdx = content.lastIndexOf('### Final Result');
  if (lastIdx !== -1) {
    const afterHeader = content.substring(lastIdx);
    // 다음 ## 섹션 시작 전까지 (## Pipeline Output, ## Changes, ## Code Review 등)
    const nextSectionMatch = afterHeader.match(/\n## [A-Z]/);
    const result = nextSectionMatch
      ? afterHeader.substring(0, nextSectionMatch.index)
      : afterHeader;
    return result.replace(/### Final Result\s*\n/, '').trim();
  }

  // Fallback: 마지막 Pipeline Output 섹션
  const pipelineMatches = content.match(/## Pipeline Output[^\n]*\n\n([\s\S]*?)(?=\n## Pipeline Output|$)/g);
  if (pipelineMatches && pipelineMatches.length > 0) {
    const lastMatch = pipelineMatches[pipelineMatches.length - 1];
    const pipelineContent = lastMatch.replace(/## Pipeline Output[^\n]*\n\n/, '').trim();
    if (pipelineContent && pipelineContent !== '(no output)') {
      return pipelineContent;
    }
  }

  return null;
}

// Extract Changes section from context file content
function extractChangesSection(content: string | null): string | null {
  if (!content) return null;

  // Find the last "## Changes" section (regular pipeline only — orchestrated doesn't have this)
  const changesMatches = content.match(/## Changes\s*\n([\s\S]*?)(?=\n## |$)/g);
  if (changesMatches && changesMatches.length > 0) {
    const lastMatch = changesMatches[changesMatches.length - 1];
    return lastMatch.replace(/## Changes\s*\n/, '').trim();
  }

  // For orchestrated output, check if code agent output contains change summary tables
  const lastSection = findLastOutputSection(content);
  if (lastSection?.type === 'orchestrated') {
    const codeOutput = extractCodeAgentOutput(lastSection.body);
    if (codeOutput) {
      // Look for change summary patterns (tables with 변경 전/후 or 변경된 파일)
      const changeTableMatch = codeOutput.match(/(## 변경 사항 요약[\s\S]*?)(?=\n## |$)/);
      if (changeTableMatch) return changeTableMatch[1].trim();
      const changedFilesMatch = codeOutput.match(/(### 변경된 파일[\s\S]*?)(?=\n### [^변]|$)/);
      if (changedFilesMatch) return changedFilesMatch[1].trim();
    }
  }

  return null;
}

// Extract Code Review section from context file content
function extractReviewSection(content: string | null): { markdown: string | null; hasCritical: boolean; historyMarkdown: string | null; iterations: number } {
  if (!content) return { markdown: null, hasCritical: false, historyMarkdown: null, iterations: 0 };

  // Find the last "## Code Review:" or "## 코드 리뷰:" section (regular pipeline)
  const reviewMatches = content.match(/## (?:Code Review|코드 리뷰)[:\s][^\n]*\n([\s\S]*?)(?=\n## (?!#)|$)/g);
  if (reviewMatches && reviewMatches.length > 0) {
    const lastMatch = reviewMatches[reviewMatches.length - 1];
    const hasCritical = /(?:Critical|치명적|critical)/i.test(lastMatch);
    return { markdown: lastMatch.trim(), hasCritical, historyMarkdown: null, iterations: 0 };
  }

  // For orchestrated output, extract from review agent (handles various agent names)
  const lastSection = findLastOutputSection(content);
  if (lastSection?.type === 'orchestrated') {
    const reviewOutput = extractAgentOutputMulti(lastSection.body, ['review', 'code-reviewer']);
    if (reviewOutput) {
      const hasCritical = /(?:Critical|치명적|critical)/i.test(reviewOutput);
      return { markdown: `## 코드 리뷰 (review Agent)\n\n${reviewOutput}`, hasCritical, historyMarkdown: null, iterations: 0 };
    }
  }

  return { markdown: null, hasCritical: false, historyMarkdown: null, iterations: 0 };
}

// Extract Security Review section from context file content
function extractSecuritySection(content: string | null): { markdown: string | null; hasCritical: boolean } {
  if (!content) return { markdown: null, hasCritical: false };

  // Regular pipeline format — handles various Korean/English security section headers
  // Matches: 보안 점검, 보안 검토, 보안 리뷰, 보안 분석, Security Review (with optional emoji prefix)
  const secMatches = content.match(/## (?:🔒\s*)?(?:Security Review|보안 (?:점검|검토|리뷰|분석))[:\s—][^\n]*\n([\s\S]*?)(?=\n## (?!#)|$)/g);
  if (secMatches && secMatches.length > 0) {
    const lastMatch = secMatches[secMatches.length - 1];
    const hasCritical = /(?:Critical|치명적|critical)/i.test(lastMatch);
    return { markdown: lastMatch.trim(), hasCritical };
  }

  // For orchestrated output, extract from security agent (handles various agent names)
  const lastSection = findLastOutputSection(content);
  if (lastSection?.type === 'orchestrated') {
    const securityOutput = extractAgentOutputMulti(lastSection.body, ['security', 'security-reviewer']);
    if (securityOutput) {
      const hasCritical = /(?:Critical|치명적|critical)/i.test(securityOutput);
      return { markdown: `## 보안 점검 (security Agent)\n\n${securityOutput}`, hasCritical };
    }
  }

  return { markdown: null, hasCritical: false };
}

// Extract run history info from context
function extractRunHistory(content: string | null): { totalRuns: number; lastRunType: 'initial' | 'rerun' | null; lastFeedback: string | null } {
  if (!content) return { totalRuns: 0, lastRunType: null, lastFeedback: null };

  const initialRuns = (content.match(/## Pipeline Output — 초기 실행/g) || []).length;
  const reruns = (content.match(/## Pipeline Output — 재실행/g) || []).length;
  // 이전 포맷 호환 (구분 없는 Pipeline Output)
  const legacyRuns = (content.match(/## Pipeline Output \(/g) || []).length;
  // Orchestrated pipeline runs
  const orchestratedRuns = (content.match(/## Orchestrated Pipeline Output/g) || []).length;
  const totalRuns = initialRuns + reruns + legacyRuns + orchestratedRuns;

  const isRerun = reruns > 0;
  let lastFeedback: string | null = null;
  if (isRerun) {
    const feedbackMatches = content.match(/> \*\*피드백\*\*: (.+)/g);
    if (feedbackMatches && feedbackMatches.length > 0) {
      lastFeedback = feedbackMatches[feedbackMatches.length - 1].replace(/> \*\*피드백\*\*: /, '');
    }
  }

  return {
    totalRuns,
    lastRunType: totalRuns === 0 ? null : isRerun ? 'rerun' : 'initial',
    lastFeedback,
  };
}

export function TaskModal() {
  const taskModalId = useUIStore((s) => s.taskModalId);
  const closeTaskModal = useUIStore((s) => s.closeTaskModal);
  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const pipelineOutput = useTaskStore((s) => s.pipelineOutput);
  const clearPipelineOutput = useTaskStore((s) => s.clearPipelineOutput);
  const hideTask = useTaskStore((s) => s.hideTask);
  const unhideTask = useTaskStore((s) => s.unhideTask);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextContent, setContextContent] = useState<string | null>(null);
  const [promptContent, setPromptContent] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ finalResult: true });
  const [showPrompt, setShowPrompt] = useState(false);
  const liveLogRef = useRef<HTMLDivElement>(null);

  const task = taskModalId ? tasks[taskModalId] : null;
  const liveOutput = taskModalId ? pipelineOutput[taskModalId] : undefined;

  // Extract Final Result for REVIEW status (try live output first, then context file)
  const finalResult = extractFinalResultFromOutput(liveOutput) || extractFinalResultFromContext(contextContent);

  // Extract Changes section for REVIEW status
  const changesSection = extractChangesSection(contextContent);

  // Extract Code Review section for REVIEW status
  const reviewInfo = extractReviewSection(contextContent);
  const securityInfo = extractSecuritySection(contextContent);
  const runHistory = extractRunHistory(contextContent);

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
      api.get<{ content: string | null }>(`/tasks/${taskModalId}/prompt`)
        .then(res => setPromptContent(res.content || null))
        .catch(() => setPromptContent(null));
    }
    return () => {
      setContextContent(null);
      setPromptContent(null);
      setOpenSections({ finalResult: true });
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
      const toastId = toast.loading('AI 작업 재실행 중...');
      // WebSocket task:started보다 먼저 등록해야 중복 토스트 방지
      useToastStore.getState().setPipelineToastId(toastId);
      await api.post(`/tasks/${task.id}/transition`, {
        target_state: 'READY',
        feedback: feedback.trim()
      });
      await api.post(`/tasks/${task.id}/run`);
      setFeedback('');
      await fetchTasks();
      closeTaskModal();
    } catch (err) {
      toast.error('재실행 실패');
      useToastStore.getState().setPipelineToastId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!confirm(`"${task.title}" 태스크를 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/tasks/${task.id}`);
      toast.success('태스크가 삭제되었습니다.');
      await fetchTasks();
      closeTaskModal();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
  };

  const handleStart = async () => {
    if (!task) return;
    setLoading(true);
    try {
      clearPipelineOutput(task.id);
      const toastId = toast.loading('AI 작업 시작 중...');
      // WebSocket task:started보다 먼저 등록해야 중복 토스트 방지
      useToastStore.getState().setPipelineToastId(toastId);
      await api.post(`/tasks/${task.id}/run`);
      await fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '작업 시작 실패');
      useToastStore.getState().setPipelineToastId(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = async () => {
    if (!task) return;
    setLoading(true);
    try {
      // Cancel running pipeline first
      await api.post(`/tasks/${task.id}/cancel`).catch(() => {});
      // Transition back to READY
      await api.post(`/tasks/${task.id}/transition`, { target_state: 'READY' });
      // Start again
      clearPipelineOutput(task.id);
      const toastId = toast.loading('AI 작업 재시작 중...');
      useToastStore.getState().setPipelineToastId(toastId);
      await api.post(`/tasks/${task.id}/run`);
      await fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '재시작 실패');
      useToastStore.getState().setPipelineToastId(null);
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
    <Modal isOpen={true} onClose={closeTaskModal} title={task.id} size={isFullScreen ? 'full' : 'lg'}>
      <div className="space-y-4">
        {/* Header: Status + Priority + Actions - matching TaskCard layout */}
        <div className="flex items-center gap-3 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className={cn('w-2.5 h-2.5 rounded-full', STATUS_COLORS[task.status])} />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {task.status.replace('_', ' ')}
            </span>
          </div>
          <Badge className={cn('text-xs px-2.5 py-1 font-medium border-0', PRIORITY_COLORS[task.priority])}>
            {task.priority}
          </Badge>

          {/* Action buttons - matching TaskCard style */}
          <div className="ml-auto flex items-center gap-2">
            {(task.status === 'BACKLOG' || task.status === 'READY' || task.status === 'DONE') && (() => {
              const isHidden = task.hidden;
              return (
                <button
                  onClick={() => {
                    if (isHidden) {
                      unhideTask(task.id);
                    } else {
                      hideTask(task.id);
                      closeTaskModal();
                    }
                  }}
                  className={cn(
                    'p-2 rounded-lg transition-colors',
                    isHidden
                      ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                      : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  )}
                  title={isHidden ? '숨김 해제' : '숨기기'}
                >
                  {isHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              );
            })()}
            {task.status === 'BACKLOG' && (
              <button
                onClick={async () => {
                  if (!confirm(`"${task.title}" 태스크를 삭제하시겠습니까?`)) return;
                  try {
                    await api.delete(`/tasks/${task.id}`);
                    toast.success('태스크가 삭제되었습니다.');
                    closeTaskModal();
                    fetchTasks();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : '삭제 실패');
                  }
                }}
                className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-colors"
                title="삭제"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"
              title={isFullScreen ? '기본 크기' : '전체 화면'}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white -mt-2">
          {task.title}
        </h2>

        {task.description && (
          <div className="prose prose-sm dark:prose-invert prose-headings:text-base prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:text-xs max-w-none text-gray-600 dark:text-gray-300 overflow-auto max-h-64">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown>
          </div>
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

        {/* Restart Action - IN_PROGRESS status */}
        {task.status === 'IN_PROGRESS' && (
          <div className="flex gap-2">
            <Button
              variant="warning"
              onClick={handleRestart}
              disabled={loading}
            >
              <StopCircle className="w-4 h-4 mr-1" />
              중지 & 재시작
            </Button>
          </div>
        )}

        {/* Final Result - shown in REVIEW and DONE status */}
        {(task.status === 'REVIEW' || task.status === 'DONE') && (
          <div className="border-t dark:border-gray-700 pt-4">
            <button
              onClick={() => setOpenSections(s => ({ ...s, finalResult: !s.finalResult }))}
              className="flex items-center gap-2 font-medium mb-2 text-green-600 dark:text-green-400 hover:opacity-80 w-full"
            >
              {openSections.finalResult ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <Check className="w-4 h-4" />
              Final Result
              {runHistory.totalRuns > 1 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 rounded-full">
                  {runHistory.totalRuns}차 실행
                </span>
              )}
              {runHistory.lastRunType === 'rerun' && (
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 rounded-full">
                  피드백 반영
                </span>
              )}
            </button>
            {openSections.finalResult && (
              <>
                {finalResult ? (
                  <div className="space-y-2">
                    {runHistory.lastFeedback && (
                      <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 text-sm text-blue-700 dark:text-blue-300">
                        <span className="font-medium">반영된 피드백:</span> {runHistory.lastFeedback}
                      </div>
                    )}
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg overflow-auto max-h-[32rem] prose prose-sm dark:prose-invert prose-headings:text-base prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:text-xs max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalResult}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-500">
                    AI 작업 결과는 아래 Pipeline Output에서 확인하세요.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Changes (Before → After) - shown in REVIEW and DONE status */}
        {(task.status === 'REVIEW' || task.status === 'DONE') && changesSection && (
          <div className="border-t dark:border-gray-700 pt-4">
            <button
              onClick={() => setOpenSections(s => ({ ...s, changes: !s.changes }))}
              className="flex items-center gap-2 font-medium mb-2 text-blue-600 dark:text-blue-400 hover:opacity-80 w-full"
            >
              {openSections.changes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <GitCommit className="w-4 h-4" />
              Changes (Before → After)
            </button>
            {openSections.changes && (
              <div className="p-4 bg-slate-900 border border-slate-700 rounded-lg overflow-auto max-h-[32rem] prose prose-sm prose-invert prose-headings:text-base prose-headings:font-semibold prose-headings:text-slate-200 prose-p:my-1 prose-p:text-slate-300 prose-ul:my-1 prose-li:my-0 prose-table:text-xs prose-th:text-slate-300 prose-td:text-slate-400 max-w-none diff-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{changesSection}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Prompt History - shown when available */}
        {promptContent && (
          <div className="border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className="w-full flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="font-medium text-purple-900 dark:text-purple-100">프롬프트 이력</span>
              </div>
              <ChevronDown className={cn('w-4 h-4 text-purple-600 transition-transform', showPrompt && 'rotate-180')} />
            </button>
            {showPrompt && (
              <div className="p-4 bg-white dark:bg-gray-900 max-h-96 overflow-y-auto">
                <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">{promptContent}</pre>
              </div>
            )}
          </div>
        )}

        {/* Code Review - shown in REVIEW and DONE status */}
        {(task.status === 'REVIEW' || task.status === 'DONE') && (
          <div className="border-t dark:border-gray-700 pt-4">
            <button
              onClick={() => setOpenSections(s => ({ ...s, codeReview: !s.codeReview }))}
              className={cn("flex items-center gap-2 font-medium mb-2 hover:opacity-80 w-full", reviewInfo.hasCritical ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-400')}
            >
              {openSections.codeReview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <FileText className="w-4 h-4" />
              코드 리뷰
              {reviewInfo.hasCritical && (
                <span className="px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-full">
                  치명적
                </span>
              )}
            </button>
            {openSections.codeReview && (
              reviewInfo.markdown ? (
                <div className={cn(
                  "p-4 border rounded-lg overflow-auto max-h-[32rem] prose prose-sm dark:prose-invert prose-headings:text-base prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:text-xs max-w-none",
                  reviewInfo.hasCritical
                    ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
                    : "bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800"
                )}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{reviewInfo.markdown}</ReactMarkdown>
                </div>
              ) : (
                <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-500">
                  코드 리뷰 없음
                </div>
              )
            )}
          </div>
        )}

        {/* Security Review - shown in REVIEW status */}
        {(task.status === 'REVIEW' || task.status === 'DONE') && securityInfo.markdown && (
          <div className="border-t dark:border-gray-700 pt-4">
            <button
              onClick={() => setOpenSections(s => ({ ...s, security: !s.security }))}
              className={cn("flex items-center gap-2 font-medium mb-2 hover:opacity-80 w-full", securityInfo.hasCritical ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400')}
            >
              {openSections.security ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <AlertCircle className="w-4 h-4" />
              보안 점검
              {securityInfo.hasCritical && (
                <span className="px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-full">
                  치명적
                </span>
              )}
            </button>
            {openSections.security && (
              <div className={cn(
                "p-4 border rounded-lg overflow-auto max-h-[32rem] prose prose-sm dark:prose-invert prose-headings:text-base prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:text-xs max-w-none",
                securityInfo.hasCritical
                  ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
                  : "bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800"
              )}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{securityInfo.markdown}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Pipeline Output / Context */}
        {contextContent && (
          <div className="border-t dark:border-gray-700 pt-4">
            <button
              onClick={() => setOpenSections(s => ({ ...s, pipeline: !s.pipeline }))}
              className="flex items-center gap-2 font-medium mb-2 hover:text-blue-600 w-full"
            >
              {openSections.pipeline ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <Terminal className="w-4 h-4" />
              Pipeline Output
            </button>
            {openSections.pipeline && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg overflow-auto max-h-[32rem] prose prose-sm dark:prose-invert prose-headings:text-base prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:text-xs max-w-none">
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

        {/* Start Action - READY status */}
        {task.status === 'READY' && (
          <div className="border-t dark:border-gray-700 pt-4">
            <div className="flex gap-2">
              <Button
                variant="success"
                onClick={handleStart}
                disabled={loading}
              >
                <Play className="w-4 h-4 mr-1" />
                작업 시작
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={loading}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                삭제
              </Button>
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
                완료 (DONE)
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
