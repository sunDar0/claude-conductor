import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasDependency, hasFilePattern } from './base.detector.js';

export async function detectNestJS(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasDependency(workspacePath, '@nestjs/core'))) {
    return { detected: false, type: 'nestjs', confidence: 0 };
  }

  let confidence = 85;
  if (await hasFilePattern(workspacePath, ['nest-cli.json'])) confidence += 10;
  const hasSwagger = await hasDependency(workspacePath, '@nestjs/swagger');

  const config: ServerConfig = {
    type: 'nestjs',
    port: 3000,
    command: 'npm run start:dev',
    healthCheck: '/health',
    apiDocs: hasSwagger ? { swagger: '/api', openapi_json: '/api-json' } : undefined,
    env: { NODE_ENV: 'development' },
  };

  return { detected: true, type: 'nestjs', config, confidence };
}
