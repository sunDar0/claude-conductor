// ===========================================
// Agent 관련 타입 정의
// ===========================================

// Built-in roles for reference. AgentRole is string to support omc/global/project agent sources.
export type BuiltInAgentRole =
  | 'code'
  | 'test'
  | 'review'
  | 'docs'
  | 'security'
  | 'performance'
  | 'frontend'
  | 'backend'
  | 'custom';

export type AgentRole = string;

export type AgentStatus =
  | 'idle'
  | 'ready'
  | 'running'
  | 'completed'
  | 'error'
  | 'terminated';

export interface AgentDefinition {
  role: AgentRole;
  name: string;
  description: string;
  skills: {
    required: string[];
    optional: string[];
  };
  system_prompt: string;
  tools: string[];
  constraints: string[];
  output_format: {
    type: string;
    schema: Record<string, unknown>;
  };
  config: {
    timeout_ms: number;
    max_retries: number;
    parallel_allowed: boolean;
  };
}

export interface AgentInstance {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  task_id: string | null;
  skills_loaded: string[];
  context: AgentContext;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: AgentResult | null;
  error: string | null;
}

export interface AgentContext {
  task: {
    id: string;
    title: string;
    description: string;
    related_files: string[];
  };
  skills: Record<string, string>;
  shared: Record<string, unknown>;
  parent_agent_id: string | null;
}

export interface AgentResult {
  agent_id: string;
  role: AgentRole;
  task_id: string;
  status: 'success' | 'partial' | 'failed';
  output: Record<string, unknown> | null;
  artifacts: AgentArtifact[];
  metrics: {
    duration_ms: number;
    tool_calls: number;
    tokens_used: number;
  };
  timestamp: string;
}

export interface AgentArtifact {
  type: 'file' | 'diff' | 'report' | 'data';
  name: string;
  path?: string;
  content: string;
}

// ===========================================
// 오케스트레이션 관련 타입
// ===========================================

export type ExecutionStrategy = 'parallel' | 'sequential' | 'pipeline';

export interface OrchestrationPlan {
  id: string;
  task_id: string;
  strategy: ExecutionStrategy;
  stages: OrchestrationStage[];
  created_at: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  task_context?: {
    title: string;
    description: string;
    related_files?: string[];
  };
  initial_shared?: Record<string, unknown>;
}

export type AgentSourceType = 'omc' | 'global' | 'project' | 'default';

export interface OrchestrationStage {
  stage_id: string;
  name: string;
  agents: {
    role: AgentRole;
    skills?: string[];
    depends_on?: string[];
  }[];
  parallel: boolean;
  timeout_ms: number;
}

export interface DelegationRequest {
  task_id: string;
  agent_role: AgentRole;
  skills?: string[];
  context?: Partial<AgentContext>;
  priority?: 'low' | 'normal' | 'high';
  timeout_ms?: number;
}

export interface CollectionResult {
  plan_id: string;
  task_id: string;
  agents: AgentResult[];
  merged_output: Record<string, unknown>;
  conflicts: ConflictItem[];
  summary: string;
}

export interface ConflictItem {
  type: 'file_change' | 'recommendation' | 'data';
  source_agents: string[];
  description: string;
  resolution?: string;
}
