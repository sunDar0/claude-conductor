import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasDependency } from './base.detector.js';

export async function detectExpress(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasDependency(workspacePath, 'express'))) {
    return { detected: false, type: 'express', confidence: 0 };
  }

  const hasSwagger = await hasDependency(workspacePath, 'swagger-ui-express');

  const config: ServerConfig = {
    type: 'express',
    port: 3000,
    command: 'npm run start:dev',
    healthCheck: '/health',
    apiDocs: hasSwagger ? { swagger: '/api-docs', redoc: '/redoc' } : undefined,
    env: { NODE_ENV: 'development' },
  };

  return { detected: true, type: 'express', config, confidence: 70 };
}
