# Claude Conductor - Phase 7 상세 구현 스펙 (Part B)

> **목표**: 고도화 및 폴리싱 - 멀티 프로젝트, 메트릭스, 프로덕션 최적화, 문서화
> **범위**: Step 7-13 (MCP 도구 및 통합)

---

## Step 7: MCP 도구 - 프로젝트

### 파일: `src/handlers/project.handlers.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@anthropic/mcp-server';
import { ProjectManager } from '../projects/manager';

export function registerProjectHandlers(server: McpServer, manager: ProjectManager) {

  // ===========================================
  // project_create - 프로젝트 생성
  // ===========================================
  server.tool(
    'project_create',
    '새 프로젝트를 생성합니다.',
    {
      name: z.string().describe('프로젝트 이름'),
      root_path: z.string().describe('프로젝트 루트 경로'),
      description: z.string().optional().describe('설명'),
      git_branch: z.string().default('main').describe('기본 브랜치'),
      auto_start_servers: z.array(z.string()).optional().describe('자동 시작 서버 ID'),
    },
    async ({ name, root_path, description, git_branch, auto_start_servers }) => {
      try {
        const project = await manager.create({
          name,
          root_path,
          description,
          settings: {
            git: { default_branch: git_branch },
            servers: { auto_start: auto_start_servers || [] },
            notifications: { enabled: true },
            agents: { max_concurrent: 5 },
          },
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              project: {
                id: project.id,
                name: project.name,
                root_path: project.root_path,
              },
              message: `프로젝트 '${project.name}' 생성됨`,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // project_list - 프로젝트 목록
  // ===========================================
  server.tool(
    'project_list',
    '모든 프로젝트 목록을 조회합니다.',
    {},
    async () => {
      const projects = await manager.list();
      const current = manager.getCurrentProject();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            current_project: current?.project_id,
            count: projects.length,
            projects: projects.map(p => ({
              id: p.id,
              name: p.name,
              root_path: p.root_path,
              stats: p.stats,
              active: current?.project_id === p.id,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // ===========================================
  // project_switch - 프로젝트 전환
  // ===========================================
  server.tool(
    'project_switch',
    '활성 프로젝트를 전환합니다.',
    {
      project_id: z.string().describe('프로젝트 ID'),
    },
    async ({ project_id }) => {
      try {
        const context = await manager.switch(project_id);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              project: {
                id: context.project.id,
                name: context.project.name,
                root_path: context.project.root_path,
              },
              message: `프로젝트 '${context.project.name}'으로 전환됨`,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // project_current - 현재 프로젝트
  // ===========================================
  server.tool(
    'project_current',
    '현재 활성 프로젝트 정보를 조회합니다.',
    {},
    async () => {
      const context = manager.getCurrentProject();

      if (!context) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              project: null,
              message: '활성 프로젝트가 없습니다.',
            }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            project: context.project,
          }, null, 2),
        }],
      };
    }
  );

  // ===========================================
  // project_delete - 프로젝트 삭제
  // ===========================================
  server.tool(
    'project_delete',
    '프로젝트를 삭제합니다. (관련 데이터도 삭제됨)',
    {
      project_id: z.string().describe('프로젝트 ID'),
      confirm: z.boolean().describe('삭제 확인 (true 필요)'),
    },
    async ({ project_id, confirm }) => {
      if (!confirm) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: '삭제를 확인하려면 confirm=true를 설정하세요.',
            }, null, 2),
          }],
          isError: true,
        };
      }

      try {
        const deleted = await manager.delete(project_id);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: deleted,
              message: deleted ? '프로젝트가 삭제되었습니다.' : '프로젝트를 찾을 수 없습니다.',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}
```

---

## Step 8: MCP 도구 - 메트릭스

### 파일: `src/handlers/metrics.handlers.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@anthropic/mcp-server';
import { MetricsAggregator } from '../metrics/aggregator';
import { ProjectManager } from '../projects/manager';

export function registerMetricsHandlers(
  server: McpServer,
  aggregator: MetricsAggregator,
  projectManager: ProjectManager
) {

  // ===========================================
  // metrics_summary - 메트릭스 요약
  // ===========================================
  server.tool(
    'metrics_summary',
    '프로젝트 메트릭스 요약을 조회합니다.',
    {
      project_id: z.string().optional().describe('프로젝트 ID (없으면 현재 프로젝트)'),
      period: z.enum(['hour', 'day', 'week', 'month']).default('day').describe('집계 기간'),
    },
    async ({ project_id, period }) => {
      const projectId = project_id || projectManager.getCurrentProject()?.project_id;

      if (!projectId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: '프로젝트를 지정하거나 활성 프로젝트를 선택하세요.',
            }, null, 2),
          }],
          isError: true,
        };
      }

      try {
        const metrics = await aggregator.aggregate(projectId, period);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              project_id: projectId,
              period,
              metrics: {
                tasks: {
                  total: metrics.tasks.total,
                  completion_rate: `${(metrics.tasks.completion_rate * 100).toFixed(1)}%`,
                  avg_completion_time: `${(metrics.tasks.avg_completion_time_ms / 1000 / 60).toFixed(1)} min`,
                  by_status: metrics.tasks.by_status,
                },
                agents: {
                  total_runs: metrics.agents.total_spawned,
                  success_rate: `${(metrics.agents.success_rate * 100).toFixed(1)}%`,
                  by_role: metrics.agents.by_role,
                },
                servers: {
                  running: metrics.servers.running,
                  total_starts: metrics.servers.total,
                },
                reviews: {
                  total: metrics.reviews.total,
                  approved: metrics.reviews.approved,
                  rejected: metrics.reviews.rejected,
                },
              },
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // metrics_tasks - 태스크 상세 메트릭스
  // ===========================================
  server.tool(
    'metrics_tasks',
    '태스크 메트릭스 상세 정보를 조회합니다.',
    {
      project_id: z.string().optional(),
      period: z.enum(['hour', 'day', 'week', 'month']).default('day'),
    },
    async ({ project_id, period }) => {
      const projectId = project_id || projectManager.getCurrentProject()?.project_id;
      if (!projectId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: false, error: '프로젝트 필요' }, null, 2),
          }],
          isError: true,
        };
      }

      const metrics = await aggregator.aggregate(projectId, period);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            project_id: projectId,
            period,
            tasks: metrics.tasks,
          }, null, 2),
        }],
      };
    }
  );

  // ===========================================
  // metrics_agents - Agent 상세 메트릭스
  // ===========================================
  server.tool(
    'metrics_agents',
    'Agent 메트릭스 상세 정보를 조회합니다.',
    {
      project_id: z.string().optional(),
      period: z.enum(['hour', 'day', 'week', 'month']).default('day'),
    },
    async ({ project_id, period }) => {
      const projectId = project_id || projectManager.getCurrentProject()?.project_id;
      if (!projectId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: false, error: '프로젝트 필요' }, null, 2),
          }],
          isError: true,
        };
      }

      const metrics = await aggregator.aggregate(projectId, period);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            project_id: projectId,
            period,
            agents: metrics.agents,
          }, null, 2),
        }],
      };
    }
  );
}
```

---

## Step 9: MCP 도구 - 백업

### 파일: `src/handlers/backup.handlers.ts`

```typescript
import { z } from 'zod';
import type { McpServer } from '@anthropic/mcp-server';
import { BackupExporter } from '../backup/exporter';
import { BackupImporter } from '../backup/importer';

export function registerBackupHandlers(
  server: McpServer,
  exporter: BackupExporter,
  importer: BackupImporter
) {

  // ===========================================
  // backup_create - 백업 생성
  // ===========================================
  server.tool(
    'backup_create',
    '데이터 백업을 생성합니다.',
    {
      output_path: z.string().describe('출력 경로 (.zip)'),
      project_id: z.string().optional().describe('특정 프로젝트만 백업'),
      include_metrics: z.boolean().default(true).describe('메트릭스 포함'),
      compress: z.boolean().default(true).describe('압축 여부'),
      encrypt: z.boolean().default(false).describe('암호화 여부'),
      encryption_key: z.string().optional().describe('암호화 키'),
    },
    async ({ output_path, project_id, include_metrics, compress, encrypt, encryption_key }) => {
      try {
        const manifest = await exporter.export(output_path, {
          project_id,
          includes: { metrics: include_metrics },
          compress,
          encrypt,
          encryption_key,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              output: output_path,
              manifest: {
                version: manifest.version,
                created_at: manifest.created_at,
                includes: manifest.includes,
              },
              message: '백업이 생성되었습니다.',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // backup_restore - 백업 복원
  // ===========================================
  server.tool(
    'backup_restore',
    '백업에서 데이터를 복원합니다.',
    {
      input_path: z.string().describe('백업 파일 경로'),
      overwrite: z.boolean().default(false).describe('기존 데이터 덮어쓰기'),
      decrypt: z.boolean().default(false).describe('복호화 여부'),
      decryption_key: z.string().optional().describe('복호화 키'),
    },
    async ({ input_path, overwrite, decrypt, decryption_key }) => {
      try {
        const result = await importer.import(input_path, {
          overwrite,
          decrypt,
          decryption_key,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              restored: result.restored,
              errors: result.errors,
              manifest: {
                version: result.manifest.version,
                created_at: result.manifest.created_at,
              },
              message: result.success ? '복원이 완료되었습니다.' : '일부 오류가 발생했습니다.',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // backup_info - 백업 정보 조회
  // ===========================================
  server.tool(
    'backup_info',
    '백업 파일 정보를 조회합니다.',
    {
      path: z.string().describe('백업 파일 경로'),
    },
    async ({ path }) => {
      try {
        const fs = require('fs');
        const unzipper = require('unzipper');

        // manifest.json 읽기
        const directory = await unzipper.Open.file(path);
        const manifestFile = directory.files.find((f: any) => f.path === 'manifest.json');

        if (!manifestFile) {
          throw new Error('Invalid backup file');
        }

        const manifestContent = await manifestFile.buffer();
        const manifest = JSON.parse(manifestContent.toString());

        const stat = fs.statSync(path);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              file: {
                path,
                size: `${(stat.size / 1024 / 1024).toFixed(2)} MB`,
              },
              manifest,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}
```

## Step 10: 대시보드 차트 컴포넌트

### 파일: `dashboard/src/components/charts/TaskChart.tsx`

```tsx
import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

interface TaskMetrics {
  total: number;
  by_status: Record<string, number>;
  avg_completion_time_ms: number;
  completion_rate: number;
}

interface Props {
  metrics: TaskMetrics;
  period: string;
}

export function TaskChart({ metrics, period }: Props) {
  // 상태별 도넛 차트
  const statusData = {
    labels: Object.keys(metrics.by_status),
    datasets: [{
      data: Object.values(metrics.by_status),
      backgroundColor: [
        '#10B981', // TODO - green
        '#3B82F6', // IN_PROGRESS - blue
        '#F59E0B', // REVIEW - yellow
        '#8B5CF6', // DONE - purple
        '#EF4444', // BLOCKED - red
      ],
      borderWidth: 0,
    }],
  };

  const statusOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'right' as const,
      },
      title: {
        display: true,
        text: '상태별 태스크 분포',
      },
    },
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* 상태별 분포 */}
      <div className="bg-white rounded-lg shadow p-4">
        <Doughnut data={statusData} options={statusOptions} />
      </div>

      {/* 요약 통계 */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-4">태스크 통계 ({period})</h3>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">총 태스크</span>
            <span className="text-2xl font-bold">{metrics.total}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">완료율</span>
            <span className="text-2xl font-bold text-green-600">
              {(metrics.completion_rate * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">평균 완료 시간</span>
            <span className="text-xl font-semibold">
              {(metrics.avg_completion_time_ms / 1000 / 60).toFixed(1)}분
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 파일: `dashboard/src/components/charts/AgentChart.tsx`

```tsx
import React from 'react';
import { Bar, Pie } from 'react-chartjs-2';

interface AgentMetrics {
  total_spawned: number;
  total_completed: number;
  total_failed: number;
  success_rate: number;
  avg_duration_ms: number;
  by_role: Record<string, {
    count: number;
    success_rate: number;
    avg_duration_ms: number;
  }>;
}

interface Props {
  metrics: AgentMetrics;
}

export function AgentChart({ metrics }: Props) {
  const roles = Object.keys(metrics.by_role);

  // 역할별 실행 횟수
  const roleCountData = {
    labels: roles,
    datasets: [{
      label: '실행 횟수',
      data: roles.map(r => metrics.by_role[r].count),
      backgroundColor: '#3B82F6',
    }],
  };

  // 역할별 성공률
  const roleSuccessData = {
    labels: roles,
    datasets: [{
      label: '성공률 (%)',
      data: roles.map(r => metrics.by_role[r].success_rate * 100),
      backgroundColor: '#10B981',
    }],
  };

  const barOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: { beginAtZero: true },
    },
  };

  return (
    <div className="space-y-6">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{metrics.total_spawned}</div>
          <div className="text-gray-600">총 실행</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{metrics.total_completed}</div>
          <div className="text-gray-600">성공</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-red-600">{metrics.total_failed}</div>
          <div className="text-gray-600">실패</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-purple-600">
            {(metrics.success_rate * 100).toFixed(0)}%
          </div>
          <div className="text-gray-600">성공률</div>
        </div>
      </div>

      {/* 차트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-4">역할별 실행 횟수</h3>
          <Bar data={roleCountData} options={barOptions} />
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-4">역할별 성공률</h3>
          <Bar data={roleSuccessData} options={{ ...barOptions, scales: { y: { max: 100 } } }} />
        </div>
      </div>
    </div>
  );
}
```

### 파일: `dashboard/src/pages/Analytics.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import { TaskChart } from '../components/charts/TaskChart';
import { AgentChart } from '../components/charts/AgentChart';
import { useProjectStore } from '../store/projectStore';

type Period = 'hour' | 'day' | 'week' | 'month';

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('day');
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { currentProject } = useProjectStore();

  useEffect(() => {
    if (!currentProject) return;

    const fetchMetrics = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/metrics/summary?project_id=${currentProject.id}&period=${period}`
        );
        const data = await response.json();
        setMetrics(data.metrics);
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [currentProject, period]);

  if (!currentProject) {
    return (
      <div className="p-8 text-center text-gray-500">
        프로젝트를 선택해주세요.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">분석 대시보드</h1>
        <div className="flex gap-2">
          {(['hour', 'day', 'week', 'month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded ${
                period === p
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              {p === 'hour' ? '1시간' : p === 'day' ? '1일' : p === 'week' ? '1주' : '1달'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : metrics ? (
        <>
          {/* 태스크 메트릭스 */}
          <section>
            <h2 className="text-xl font-semibold mb-4">📋 태스크</h2>
            <TaskChart metrics={metrics.tasks} period={period} />
          </section>

          {/* Agent 메트릭스 */}
          <section>
            <h2 className="text-xl font-semibold mb-4">🤖 Agent</h2>
            <AgentChart metrics={metrics.agents} />
          </section>

          {/* 서버 & 리뷰 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold mb-4">🖥️ 서버</h2>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>현재 실행 중</span>
                  <span className="font-bold text-green-600">{metrics.servers.running}</span>
                </div>
                <div className="flex justify-between">
                  <span>총 시작 횟수</span>
                  <span className="font-bold">{metrics.servers.total_starts}</span>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold mb-4">📝 리뷰</h2>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>총 리뷰</span>
                  <span className="font-bold">{metrics.reviews.total}</span>
                </div>
                <div className="flex justify-between">
                  <span>승인</span>
                  <span className="font-bold text-green-600">{metrics.reviews.approved}</span>
                </div>
                <div className="flex justify-between">
                  <span>반려</span>
                  <span className="font-bold text-red-600">{metrics.reviews.rejected}</span>
                </div>
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="text-center text-gray-500 py-12">
          데이터를 불러올 수 없습니다.
        </div>
      )}
    </div>
  );
}
```

---

## Step 11: 프로덕션 설정

### 파일: `docker/docker-compose.prod.yml`

```yaml
version: '3.8'

services:
  conductor:
    build:
      context: ../services/conductor
      dockerfile: Dockerfile
    restart: always
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - LOG_LEVEL=info
      - LOG_FORMAT=json
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
    networks:
      - conductor-network

  dashboard:
    build:
      context: ../dashboard
      dockerfile: Dockerfile
    restart: always
    environment:
      - NODE_ENV=production
      - API_URL=http://conductor:3000
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - conductor-network

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - conductor-network

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - conductor
      - dashboard
    networks:
      - conductor-network

  # 선택적: 백업 스케줄러
  backup-scheduler:
    build:
      context: ../services/conductor
      dockerfile: Dockerfile
    restart: always
    command: ["node", "dist/backup/scheduler.js"]
    environment:
      - BACKUP_SCHEDULE=0 2 * * *
      - BACKUP_RETENTION_DAYS=30
      - BACKUP_PATH=/backups
    volumes:
      - backup-data:/backups
    depends_on:
      - redis
    networks:
      - conductor-network

volumes:
  redis-data:
  backup-data:

networks:
  conductor-network:
    driver: bridge
```

### 파일: `docker/nginx/nginx.conf`

```nginx
events {
    worker_connections 1024;
}

http {
    upstream conductor_api {
        server conductor:3000;
        keepalive 32;
    }

    upstream dashboard {
        server dashboard:4000;
        keepalive 32;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
    limit_req_zone $binary_remote_addr zone=ws_limit:10m rate=10r/s;

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;

    server {
        listen 80;
        server_name _;

        # API
        location /api/ {
            limit_req zone=api_limit burst=20 nodelay;

            proxy_pass http://conductor_api/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # WebSocket
        location /ws {
            limit_req zone=ws_limit burst=5 nodelay;

            proxy_pass http://conductor_api/ws;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;

            proxy_connect_timeout 7d;
            proxy_send_timeout 7d;
            proxy_read_timeout 7d;
        }

        # Dashboard
        location / {
            proxy_pass http://dashboard/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # Health check
        location /health {
            access_log off;
            return 200 "OK";
        }
    }
}
```

### 파일: `docker/scripts/backup.sh`

```bash
#!/bin/bash
set -e

BACKUP_DIR="${BACKUP_PATH:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/conductor_backup_${TIMESTAMP}.zip"

echo "[$(date)] Starting backup..."

# Conductor API를 통해 백업 생성
curl -X POST "http://conductor:3000/backup" \
  -H "Content-Type: application/json" \
  -d "{\"output_path\": \"${BACKUP_FILE}\", \"compress\": true}" \
  --fail

echo "[$(date)] Backup created: ${BACKUP_FILE}"

# 오래된 백업 삭제
find "${BACKUP_DIR}" -name "conductor_backup_*.zip" -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] Old backups cleaned up (retention: ${RETENTION_DAYS} days)"

# 백업 목록 출력
echo "[$(date)] Current backups:"
ls -lh "${BACKUP_DIR}"/*.zip 2>/dev/null || echo "No backups found"
```

---

## Step 12: 문서 사이트 구조

### 파일: `docs/docusaurus.config.js`

```javascript
module.exports = {
  title: 'Claude Conductor',
  tagline: 'AI-Powered Development Orchestration',
  url: 'https://conductor.example.com',
  baseUrl: '/',
  favicon: 'img/favicon.ico',
  organizationName: 'your-org',
  projectName: 'claude-conductor',

  themeConfig: {
    navbar: {
      title: 'Claude Conductor',
      logo: { alt: 'Logo', src: 'img/logo.svg' },
      items: [
        { to: 'docs/getting-started', label: '시작하기', position: 'left' },
        { to: 'docs/tools', label: '도구', position: 'left' },
        { to: 'docs/api', label: 'API', position: 'left' },
        { href: 'https://github.com/your-org/claude-conductor', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} Your Organization`,
    },
    prism: {
      theme: require('prism-react-renderer/themes/github'),
      darkTheme: require('prism-react-renderer/themes/dracula'),
    },
  },

  presets: [
    ['@docusaurus/preset-classic', {
      docs: {
        sidebarPath: require.resolve('./sidebars.js'),
        editUrl: 'https://github.com/your-org/claude-conductor/edit/main/docs/',
      },
      theme: {
        customCss: require.resolve('./src/css/custom.css'),
      },
    }],
  ],
};
```

### 파일: `docs/docs/getting-started.md`

```markdown
---
id: getting-started
title: 시작하기
sidebar_position: 1
---

# Claude Conductor 시작하기

Claude Conductor는 AI 기반 개발 오케스트레이션 도구입니다.

## 설치

### 사전 요구사항

- Docker 및 Docker Compose
- Node.js 24+
- Claude Code CLI

### 빠른 시작

```bash
# 저장소 클론
git clone https://github.com/your-org/claude-conductor.git
cd claude-conductor

# 환경 설정
cp .env.example .env
# .env 파일을 수정하여 필요한 설정을 입력

# 서비스 시작
docker-compose up -d

# 상태 확인
docker-compose ps
```

### Claude Code에서 사용

```bash
# MCP 서버 연결
claude mcp add conductor stdio docker compose exec conductor node dist/index.js

# 도구 확인
claude tools

# 태스크 생성
claude "새 태스크를 생성해줘: API 인증 구현"
```

## 핵심 개념

### 프로젝트

프로젝트는 Claude Conductor의 최상위 단위입니다. 각 프로젝트는 독립적인 태스크, 서버, 메트릭스를 가집니다.

### 태스크

태스크는 작업 단위입니다. TODO → IN_PROGRESS → REVIEW → DONE 상태를 거칩니다.

### Agent

Agent는 특정 역할을 수행하는 AI 작업자입니다. Code Agent, Test Agent, Review Agent 등이 있습니다.

### 서버

서버는 개발 중 필요한 백그라운드 프로세스입니다. 개발 서버, 테스트 서버 등을 관리합니다.

## 다음 단계

- [설치 가이드](/docs/installation) - 상세 설치 방법
- [설정 가이드](/docs/configuration) - 환경 설정
- [도구 레퍼런스](/docs/tools) - 모든 MCP 도구 설명
```

### 파일: `docs/docs/tools/task-tools.md`

```markdown
---
id: task-tools
title: 태스크 도구
sidebar_position: 1
---

# 태스크 관리 도구

태스크의 생성, 조회, 상태 변경을 위한 MCP 도구입니다.

## task_create

새 태스크를 생성합니다.

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| title | string | ✓ | 태스크 제목 |
| description | string | | 상세 설명 |
| priority | enum | | low, normal, high, urgent |
| labels | string[] | | 라벨 목록 |

### 예시

```typescript
task_create({
  title: "API 인증 구현",
  description: "JWT 기반 인증 시스템 구현",
  priority: "high",
  labels: ["backend", "auth"]
})
```

### 응답

```json
{
  "success": true,
  "task": {
    "id": "TASK-001",
    "title": "API 인증 구현",
    "status": "TODO",
    "priority": "high"
  }
}
```

## task_list

태스크 목록을 조회합니다.

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| status | enum | | 상태 필터 |
| priority | enum | | 우선순위 필터 |
| label | string | | 라벨 필터 |
| limit | number | | 최대 개수 (기본: 20) |

### 예시

```typescript
task_list({ status: "IN_PROGRESS", limit: 10 })
```

## task_transition

태스크 상태를 변경합니다.

### 상태 흐름

```
TODO → IN_PROGRESS → REVIEW → DONE
         ↑            ↓
         └── BLOCKED ←┘
```

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|:----:|------|
| task_id | string | ✓ | 태스크 ID |
| to | enum | ✓ | 목표 상태 |
| reason | string | | 변경 사유 |

### 예시

```typescript
task_transition({
  task_id: "TASK-001",
  to: "IN_PROGRESS"
})
```
```

---

## Step 13: 검증 테스트

### 테스트 1: 프로젝트 관리

```bash
# 프로젝트 생성
> project_create name="MyApp" root_path="/projects/myapp"

# 예상 출력:
{
  "success": true,
  "project": {
    "id": "proj-abc12345",
    "name": "MyApp",
    "root_path": "/projects/myapp"
  }
}

# 프로젝트 전환
> project_switch project_id="proj-abc12345"

# 프로젝트 목록
> project_list
```

### 테스트 2: 메트릭스 조회

```bash
# 일간 요약
> metrics_summary period="day"

# 예상 출력:
{
  "success": true,
  "metrics": {
    "tasks": {
      "total": 15,
      "completion_rate": "73.3%",
      "avg_completion_time": "45.2 min"
    },
    "agents": {
      "total_runs": 42,
      "success_rate": "95.2%"
    }
  }
}
```

### 테스트 3: 백업/복원

```bash
# 백업 생성
> backup_create output_path="/backups/conductor_backup.zip"

# 백업 정보 확인
> backup_info path="/backups/conductor_backup.zip"

# 복원 (새 환경에서)
> backup_restore input_path="/backups/conductor_backup.zip" overwrite=false
```

### 테스트 4: 프로덕션 배포

```bash
# 프로덕션 배포
cd docker
docker-compose -f docker-compose.prod.yml up -d

# 헬스체크
curl http://localhost/health

# 로그 확인
docker-compose -f docker-compose.prod.yml logs -f conductor
```

---

## 파일 체크리스트

### 신규 파일

| 파일 | 설명 | 우선순위 |
|------|------|:--------:|
| `src/types/project.types.ts` | 프로젝트/메트릭스 타입 | P0 |
| `src/projects/manager.ts` | 멀티 프로젝트 매니저 | P0 |
| `src/metrics/collector.ts` | 메트릭스 수집기 | P0 |
| `src/metrics/aggregator.ts` | 메트릭스 집계기 | P0 |
| `src/logging/logger.ts` | 구조화 로거 | P1 |
| `src/backup/exporter.ts` | 백업 내보내기 | P1 |
| `src/backup/importer.ts` | 백업 가져오기 | P1 |
| `src/handlers/project.handlers.ts` | 프로젝트 MCP 도구 | P0 |
| `src/handlers/metrics.handlers.ts` | 메트릭스 MCP 도구 | P0 |
| `src/handlers/backup.handlers.ts` | 백업 MCP 도구 | P1 |
| `dashboard/src/components/charts/*` | 차트 컴포넌트 | P1 |
| `dashboard/src/pages/Analytics.tsx` | 분석 페이지 | P1 |
| `docker/docker-compose.prod.yml` | 프로덕션 설정 | P0 |
| `docker/nginx/nginx.conf` | Nginx 설정 | P0 |
| `docs/*` | 문서 사이트 | P2 |

---

## MCP 도구 전체 목록 (Phase 7 추가)

### 프로젝트 도구

| 도구 | 설명 |
|------|------|
| `project_create` | 프로젝트 생성 |
| `project_list` | 프로젝트 목록 |
| `project_switch` | 프로젝트 전환 |
| `project_current` | 현재 프로젝트 |
| `project_delete` | 프로젝트 삭제 |

### 메트릭스 도구

| 도구 | 설명 |
|------|------|
| `metrics_summary` | 메트릭스 요약 |
| `metrics_tasks` | 태스크 메트릭스 |
| `metrics_agents` | Agent 메트릭스 |

### 백업 도구

| 도구 | 설명 |
|------|------|
| `backup_create` | 백업 생성 |
| `backup_restore` | 백업 복원 |
| `backup_info` | 백업 정보 |

---

## 전체 MCP 도구 집계 (Phase 1-7)

| Phase | 카테고리 | 도구 수 |
|:-----:|----------|:-------:|
| 1 | 시스템 | 2 |
| 2 | 태스크 | 5 |
| 2 | 서버 | 6 |
| 3 | 코드 리뷰 | 2 |
| 3 | Changelog | 2 |
| 3 | API Docs | 2 |
| 4 | 대시보드 | 3 |
| 5 | Agent | 6 |
| 5 | 오케스트레이션 | 3 |
| 6 | 알림 | 4 |
| 6 | GitHub | 6 |
| 6 | Webhook | 5 |
| 7 | 프로젝트 | 5 |
| 7 | 메트릭스 | 3 |
| 7 | 백업 | 3 |
| **합계** | | **57** |

---

## 구현 완료 후 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Claude Conductor                                   │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         MCP Server (57 Tools)                          │ │
│  │                                                                        │ │
│  │  Tasks │ Servers │ Review │ Docs │ Agents │ Notify │ Projects │ ...   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                        │
│         ┌──────────────────────────┼──────────────────────────┐            │
│         │                          │                          │            │
│         ▼                          ▼                          ▼            │
│  ┌─────────────┐           ┌─────────────┐           ┌─────────────┐       │
│  │   Redis     │           │  Dashboard  │           │   Nginx     │       │
│  │  (Storage)  │           │   (React)   │           │  (Proxy)    │       │
│  └─────────────┘           └─────────────┘           └─────────────┘       │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │                        External Integrations                           ││
│  │                                                                        ││
│  │   Slack │ Discord │ Email │ GitHub │ Linear │ Webhooks                ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

*Phase 7 (최종) Part B 문서 끝*

*Claude Conductor 전체 스펙 완료*
- Phase 1: 기초 인프라
- Phase 2: 핵심 도구
- Phase 3: 코드 리뷰, Changelog, API Docs
- Phase 4: 실시간 대시보드
- Phase 5: Sub Agent 오케스트레이션
- Phase 6: 알림 및 외부 연동
- Phase 7: 고도화 및 폴리싱
