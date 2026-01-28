import * as path from 'path';
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasGoModule, hasFilePattern } from './base.detector.js';
import { fileExists } from '../utils/file.js';

export async function detectGoGin(workspacePath: string): Promise<DetectionResult> {
  const hasGoMod = await hasFilePattern(workspacePath, ['go.mod']);
  if (!hasGoMod) return { detected: false, type: 'go-gin', confidence: 0 };

  const hasGin = await hasGoModule(workspacePath, 'github.com/gin-gonic/gin');
  if (!hasGin) return { detected: false, type: 'go-gin', confidence: 0 };

  let confidence = 80;
  if (await hasFilePattern(workspacePath, ['main.go', 'cmd/main.go'])) confidence += 10;

  const hasAir = await fileExists(path.join(workspacePath, '.air.toml'));
  const hasSwag = await hasFilePattern(workspacePath, ['docs/swagger.json', 'docs/swagger.yaml']);

  const config: ServerConfig = {
    type: 'go-gin',
    port: 8080,
    command: hasAir ? 'air' : 'go run main.go',
    healthCheck: '/health',
    apiDocs: hasSwag ? { swagger: '/swagger/index.html', openapi_json: '/swagger/doc.json' } : undefined,
    env: { GIN_MODE: 'debug', PORT: '8080' },
  };

  return { detected: true, type: 'go-gin', config, confidence };
}
