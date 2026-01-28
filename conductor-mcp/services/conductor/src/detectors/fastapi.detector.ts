import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasPythonPackage, hasFilePattern } from './base.detector.js';

export async function detectFastAPI(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasPythonPackage(workspacePath, 'fastapi'))) {
    return { detected: false, type: 'fastapi', confidence: 0 };
  }

  let confidence = 80;
  if (await hasFilePattern(workspacePath, ['main.py', 'app/main.py'])) confidence += 10;

  const config: ServerConfig = {
    type: 'fastapi',
    port: 8000,
    command: 'uvicorn main:app --reload --host 0.0.0.0 --port 8000',
    healthCheck: '/health',
    apiDocs: { swagger: '/docs', redoc: '/redoc', openapi_json: '/openapi.json' },
    env: { PYTHONUNBUFFERED: '1' },
  };

  return { detected: true, type: 'fastapi', config, confidence };
}
