import * as path from 'path';
import { readFileOrNull, fileExists } from '../utils/file.js';

export async function readPackageJson(workspacePath: string): Promise<Record<string, unknown> | null> {
  const content = await readFileOrNull(path.join(workspacePath, 'package.json'));
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function hasDependency(workspacePath: string, depName: string): Promise<boolean> {
  const pkg = await readPackageJson(workspacePath);
  if (!pkg) return false;
  const deps = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  return depName in deps;
}

export async function hasFilePattern(workspacePath: string, patterns: string[]): Promise<boolean> {
  for (const pattern of patterns) {
    if (await fileExists(path.join(workspacePath, pattern))) return true;
  }
  return false;
}

export async function hasGoModule(workspacePath: string, moduleName: string): Promise<boolean> {
  const content = await readFileOrNull(path.join(workspacePath, 'go.mod'));
  return content ? content.includes(moduleName) : false;
}

export async function hasPythonPackage(workspacePath: string, packageName: string): Promise<boolean> {
  const reqContent = await readFileOrNull(path.join(workspacePath, 'requirements.txt'));
  if (reqContent?.toLowerCase().includes(packageName.toLowerCase())) return true;
  const pyContent = await readFileOrNull(path.join(workspacePath, 'pyproject.toml'));
  return pyContent?.toLowerCase().includes(packageName.toLowerCase()) ?? false;
}
