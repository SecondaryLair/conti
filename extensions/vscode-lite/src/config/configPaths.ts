import * as os from "node:os";
import * as path from "node:path";

export function resolveContinueGlobalDir(): string {
  const configPath = process.env.CONTINUE_GLOBAL_DIR;
  if (configPath) {
    return path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);
  }
  return path.join(os.homedir(), ".continue");
}

export function getGlobalConfigYamlPath(): string {
  return path.join(resolveContinueGlobalDir(), "config.yaml");
}

export function getWorkspaceConfigYamlPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".continue", "config.yaml");
}

