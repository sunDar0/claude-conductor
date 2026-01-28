import { useEffect } from 'react';
import { wsClient } from '../lib/websocket';
import { useTaskStore } from '../store/taskStore';
import { useServerStore } from '../store/serverStore';
import { useAgentStore } from '../store/agentStore';
import { useUIStore } from '../store/uiStore';
import { toast } from '../store/toastStore';
import type { Task, RunningServer, Activity } from '../types';

export function useWebSocket() {
  const updateTask = useTaskStore((s) => s.updateTask);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const appendPipelineOutput = useTaskStore((s) => s.appendPipelineOutput);
  const clearPipelineOutput = useTaskStore((s) => s.clearPipelineOutput);
  const updateServer = useServerStore((s) => s.updateServer);
  const removeServer = useServerStore((s) => s.removeServer);
  const appendLog = useServerStore((s) => s.appendLog);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const addActivity = useUIStore((s) => s.addActivity);
  const setWsConnected = useUIStore((s) => s.setWsConnected);

  useEffect(() => {
    wsClient.connect();

    const unsub = wsClient.subscribe((msg) => {
      // Handle wrapped event format from Redis bridge
      const eventType = msg.type === 'event' ? (msg as { event?: string }).event : msg.type;
      const payload = msg.type === 'event' ? (msg as { data?: unknown }).data : msg.payload;

      switch (eventType) {
        case 'connection':
          setWsConnected((payload as { connected: boolean }).connected);
          break;
        case 'task.created':
        case 'task.updated':
        case 'task.transitioned':
          if (payload && (payload as { task?: Task }).task) {
            updateTask((payload as { task: Task }).task);
          }
          break;
        case 'task:started': {
          // AI picked up the task (only handle colon notation from auto-pipeline)
          const startPayload = payload as { id?: string };
          if (startPayload.id) {
            clearPipelineOutput(startPayload.id);
          }
          toast.info('AI가 작업을 시작했습니다');
          fetchTasks();
          break;
        }
        case 'task.started':
          // Manual start - just refresh, no toast (auto-pipeline will send task:started)
          fetchTasks();
          break;
        case 'task:review':
          // AI completed the task (only handle colon notation from auto-pipeline)
          toast.success('AI 작업이 완료되었습니다. 검토해주세요.');
          fetchTasks();
          break;
        case 'task.review':
          // Just refresh, no duplicate toast
          fetchTasks();
          break;
        case 'pipeline:error':
          toast.error(`작업 오류: ${(payload as { error?: string })?.error || '알 수 없는 오류'}`);
          fetchTasks();
          break;
        case 'pipeline:queued':
          toast.info(`작업이 대기열에 추가됨 (${(payload as { queue_position?: number })?.queue_position || 1}번째)`);
          break;
        case 'pipeline:output': {
          // Real-time output - store for display with event type
          const pipelinePayload = payload as { task_id?: string; output?: string; event_type?: string };
          if (pipelinePayload.task_id && pipelinePayload.output) {
            // Format output with event type prefix for UI styling
            const eventType = pipelinePayload.event_type || 'info';
            const formattedOutput = `[${eventType}]${pipelinePayload.output}`;
            appendPipelineOutput(pipelinePayload.task_id, formattedOutput);
          }
          break;
        }
        case 'server.started':
        case 'server.updated':
          updateServer(payload as RunningServer);
          break;
        case 'server.stopped':
          removeServer((payload as { task_id: string }).task_id);
          break;
        case 'server.log':
          appendLog(
            (payload as { task_id: string }).task_id,
            (payload as { line: string }).line
          );
          break;
        case 'activity':
          addActivity(payload as Activity);
          break;
        // Agent events
        case 'agent.spawned':
        case 'agent.started':
        case 'agent.completed':
        case 'agent.error':
        case 'agent.terminated':
          // Refresh agent list when any agent event occurs
          fetchAgents();
          break;
      }
    });

    return () => {
      unsub();
      wsClient.disconnect();
    };
  }, [updateTask, fetchTasks, appendPipelineOutput, clearPipelineOutput, updateServer, removeServer, appendLog, fetchAgents, addActivity, setWsConnected]);
}
