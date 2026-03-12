// Stream JSON event types (from Claude CLI output)
interface StreamEvent {
  type: 'system' | 'assistant' | 'user' | 'result';
  subtype?: string;
  session_id?: string;
  message?: {
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: string;
    }>;
  };
  result?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
}

export type ParsedStreamEvent = {
  type: 'init' | 'thinking' | 'tool' | 'complete' | 'error';
  content: string;
  text?: string;
  toolName?: string;
  result?: string;
  duration_ms?: number;
} | null;

/**
 * Parse stream-json event and extract meaningful progress info.
 */
export function parseStreamEvent(line: string): ParsedStreamEvent {
  try {
    const event: StreamEvent = JSON.parse(line);

    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          return { type: 'init', content: '🚀 Claude CLI 세션 시작' };
        }
        return null;

      case 'assistant':
        if (event.message?.content) {
          for (const item of event.message.content) {
            if (item.type === 'text' && item.text) {
              return {
                type: 'thinking',
                content: item.text,
                text: item.text,
              };
            }
            if (item.type === 'tool_use' && item.name) {
              const toolInfo = item.name;
              let detail = '';
              if (item.input && typeof item.input === 'object') {
                const input = item.input as Record<string, unknown>;
                if (input.pattern) detail = ` "${input.pattern}"`;
                else if (input.file_path) detail = ` "${input.file_path}"`;
                else if (input.command) detail = ` "${String(input.command).substring(0, 50)}..."`;
              }
              return {
                type: 'tool',
                content: `🔧 ${toolInfo}${detail}`,
                toolName: item.name,
              };
            }
          }
        }
        return null;

      case 'user':
        return null;

      case 'result':
        if (event.subtype === 'success') {
          const duration = event.duration_ms ? `${(event.duration_ms / 1000).toFixed(1)}초` : '';
          const cost = event.total_cost_usd ? `$${event.total_cost_usd.toFixed(4)}` : '';
          return {
            type: 'complete',
            content: `✅ 작업 완료 ${duration ? `(${duration}` : ''}${cost ? `, ${cost})` : duration ? ')' : ''}\n\n${event.result || ''}`,
            result: event.result,
            duration_ms: event.duration_ms,
          };
        } else if (event.subtype === 'error') {
          return {
            type: 'error',
            content: `❌ 오류 발생: ${event.result || '알 수 없는 오류'}`,
          };
        }
        return null;

      default:
        return null;
    }
  } catch {
    // Not valid JSON, might be partial line
    return null;
  }
}
