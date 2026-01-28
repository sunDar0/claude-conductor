import * as path from 'path';
import type { DetectionResult, ServerConfig } from '../types/index.js';
import { hasFilePattern } from './base.detector.js';
import { readFileOrNull } from '../utils/file.js';

export async function detectSpring(workspacePath: string): Promise<DetectionResult> {
  const hasMaven = await hasFilePattern(workspacePath, ['pom.xml']);
  const hasGradle = await hasFilePattern(workspacePath, ['build.gradle', 'build.gradle.kts']);

  if (!hasMaven && !hasGradle) return { detected: false, type: 'spring', confidence: 0 };

  let hasSpringBoot = false;

  if (hasMaven) {
    const pom = await readFileOrNull(path.join(workspacePath, 'pom.xml'));
    if (pom?.includes('spring-boot')) hasSpringBoot = true;
  }
  if (hasGradle) {
    const gradle = await readFileOrNull(path.join(workspacePath, 'build.gradle')) ||
                   await readFileOrNull(path.join(workspacePath, 'build.gradle.kts'));
    if (gradle?.includes('spring-boot')) hasSpringBoot = true;
  }

  if (!hasSpringBoot) return { detected: false, type: 'spring', confidence: 0 };

  const config: ServerConfig = {
    type: 'spring',
    port: 8080,
    command: hasGradle ? './gradlew bootRun' : './mvnw spring-boot:run',
    healthCheck: '/actuator/health',
    apiDocs: { swagger: '/swagger-ui.html', openapi_json: '/v3/api-docs' },
    env: { SPRING_PROFILES_ACTIVE: 'dev' },
  };

  return { detected: true, type: 'spring', config, confidence: 85 };
}
