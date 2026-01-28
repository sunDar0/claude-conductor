import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasDependency, hasFilePattern } from './base.detector.js';

export async function detectNextjs(workspacePath: string): Promise<DetectionResult> {
  if (!(await hasDependency(workspacePath, 'next'))) {
    return { detected: false, type: 'nextjs', confidence: 0 };
  }

  let confidence = 70;
  if (await hasFilePattern(workspacePath, ['next.config.js', 'next.config.mjs', 'next.config.ts'])) confidence += 20;
  if (await hasFilePattern(workspacePath, ['app', 'pages', 'src/app', 'src/pages'])) confidence += 10;

  const config: ServerConfig = {
    type: 'nextjs',
    port: 3000,
    command: 'npm run dev',
    healthCheck: '/',
    env: { NODE_ENV: 'development' },
  };

  return { detected: true, type: 'nextjs', config, confidence };
}
