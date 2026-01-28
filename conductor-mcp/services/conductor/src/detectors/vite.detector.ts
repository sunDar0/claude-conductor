import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasDependency, hasFilePattern } from './base.detector.js';

export async function detectVite(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasDependency(workspacePath, 'vite'))) {
    return { detected: false, type: 'vite', confidence: 0 };
  }

  let confidence = 70;
  if (await hasFilePattern(workspacePath, ['vite.config.js', 'vite.config.ts'])) confidence += 20;

  const config: ServerConfig = {
    type: 'vite',
    port: 5173,
    command: 'npm run dev',
    healthCheck: '/',
    env: { NODE_ENV: 'development' },
  };

  return { detected: true, type: 'vite', config, confidence };
}
