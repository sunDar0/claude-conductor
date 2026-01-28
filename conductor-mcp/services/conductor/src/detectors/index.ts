import type { DetectionResult } from '../types/index.js';
import { detectNextjs } from './nextjs.detector.js';
import { detectVite } from './vite.detector.js';
import { detectExpress } from './express.detector.js';
import { detectFastAPI } from './fastapi.detector.js';
import { detectNestJS } from './nestjs.detector.js';
import { detectSpring } from './spring.detector.js';
import { detectGoGin } from './go-gin.detector.js';

export async function detectProject(workspacePath: string): Promise<DetectionResult> {
  const detectors = [
    detectNextjs,
    detectVite,
    detectExpress,
    detectNestJS,
    detectFastAPI,
    detectSpring,
    detectGoGin,
  ];

  let bestResult: DetectionResult = { detected: false, type: 'unknown', confidence: 0 };

  for (const detector of detectors) {
    try {
      const result = await detector(workspacePath);
      if (result.detected && result.confidence > bestResult.confidence) {
        bestResult = result;
      }
    } catch (error) {
      console.error(`Detector failed:`, error);
    }
  }

  return bestResult;
}

export {
  detectNextjs,
  detectVite,
  detectExpress,
  detectFastAPI,
  detectNestJS,
  detectSpring,
  detectGoGin,
};
