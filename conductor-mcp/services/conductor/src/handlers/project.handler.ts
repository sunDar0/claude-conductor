import type { Project, ProjectRegistry } from '../types/index.js';
import { readProjectRegistry, writeProjectRegistry, readTaskRegistry } from '../utils/registry.js';
import { nowISO } from '../utils/date.js';

export type EventPublisher = (event: string, data: unknown) => Promise<void>;

function generateProjectId(counter: number): string {
  return `PRJ-${String(counter).padStart(3, '0')}`;
}

export async function handleProjectCreate(
  input: { name: string; path?: string },
  publish: EventPublisher
) {
  const registry = await readProjectRegistry();
  registry.counter += 1;
  const projectId = generateProjectId(registry.counter);
  const now = nowISO();

  const project: Project = {
    id: projectId,
    name: input.name,
    path: input.path || process.env.WORKSPACE_DIR || '/workspace',
    created_at: now,
    updated_at: now,
    active: true,
  };

  registry.projects[projectId] = project;

  // 첫 프로젝트면 자동 선택
  if (!registry.current_project_id) {
    registry.current_project_id = projectId;
  }

  await writeProjectRegistry(registry);
  await publish('project.created', { project });

  return {
    content: [{
      type: 'text',
      text: `✅ 프로젝트 생성 완료

| 항목 | 값 |
|------|-----|
| ID | ${project.id} |
| 이름 | ${project.name} |
| 경로 | ${project.path} |

프로젝트 선택: project_select ${project.id}`,
    }],
  };
}

export async function handleProjectList(input: { active_only?: boolean }) {
  const registry = await readProjectRegistry();
  const taskRegistry = await readTaskRegistry();
  let projects = Object.values(registry.projects);

  if (input.active_only !== false) {
    projects = projects.filter(p => p.active);
  }

  if (projects.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `📁 등록된 프로젝트가 없습니다.

새 프로젝트 생성: project_create name="프로젝트명"`,
      }],
    };
  }

  // 프로젝트별 태스크 수 계산
  const taskCountByProject: Record<string, number> = {};
  for (const task of Object.values(taskRegistry.tasks)) {
    const pid = task.project_id || 'default';
    taskCountByProject[pid] = (taskCountByProject[pid] || 0) + 1;
  }

  let response = '📁 프로젝트 목록\n\n| ID | 이름 | 경로 | 태스크 수 | 상태 |\n|----|------|------|----------|------|\n';

  for (const p of projects) {
    const isSelected = p.id === registry.current_project_id;
    const taskCount = taskCountByProject[p.id] || 0;
    response += `| ${p.id} | ${p.name} | ${p.path} | ${taskCount} | ${isSelected ? '✅ 선택됨' : '-'} |\n`;
  }

  response += `\n총 ${projects.length}개 프로젝트`;

  return { content: [{ type: 'text', text: response }] };
}

export async function handleProjectSelect(
  input: { project_id: string },
  publish: EventPublisher
) {
  const registry = await readProjectRegistry();
  const project = registry.projects[input.project_id];

  if (!project) {
    return {
      content: [{
        type: 'text',
        text: `❌ 프로젝트를 찾을 수 없습니다: ${input.project_id}`,
      }],
      isError: true,
    };
  }

  registry.current_project_id = input.project_id;
  await writeProjectRegistry(registry);
  await publish('project.selected', { project });

  return {
    content: [{
      type: 'text',
      text: `✅ 프로젝트 선택됨: ${project.id} (${project.name})

현재 프로젝트의 태스크를 보려면: task_list`,
    }],
  };
}

export async function handleProjectGet(input: { project_id: string }) {
  const registry = await readProjectRegistry();
  const project = registry.projects[input.project_id];

  if (!project) {
    return {
      content: [{
        type: 'text',
        text: `❌ 프로젝트를 찾을 수 없습니다: ${input.project_id}`,
      }],
      isError: true,
    };
  }

  const isSelected = project.id === registry.current_project_id;

  return {
    content: [{
      type: 'text',
      text: `## ${project.name}

| 항목 | 값 |
|------|-----|
| ID | ${project.id} |
| 경로 | ${project.path} |
| 생성일 | ${project.created_at} |
| 상태 | ${project.active ? '활성' : '비활성'} |
| 선택됨 | ${isSelected ? '예' : '아니오'} |`,
    }],
  };
}

export async function handleProjectDelete(
  input: { project_id: string },
  publish: EventPublisher
) {
  const registry = await readProjectRegistry();
  const project = registry.projects[input.project_id];

  if (!project) {
    return {
      content: [{
        type: 'text',
        text: `❌ 프로젝트를 찾을 수 없습니다: ${input.project_id}`,
      }],
      isError: true,
    };
  }

  // 비활성화 처리 (실제 삭제 대신)
  project.active = false;
  project.updated_at = nowISO();

  // 현재 선택된 프로젝트였다면 선택 해제
  if (registry.current_project_id === input.project_id) {
    registry.current_project_id = null;
  }

  await writeProjectRegistry(registry);
  await publish('project.deleted', { project });

  return {
    content: [{
      type: 'text',
      text: `✅ 프로젝트가 비활성화되었습니다: ${project.id} (${project.name})`,
    }],
  };
}
