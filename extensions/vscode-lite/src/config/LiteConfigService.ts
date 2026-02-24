import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  AssistantUnrolled,
  BLOCK_TYPES,
  ConfigResult,
  ConfigValidationError,
  ModelConfig,
  PackageIdentifier,
  Registry,
  decodePackageIdentifier,
  mergeConfigYamlRequestOptions,
  parseConfigYaml,
  unrollAssistantFromContent,
} from "@continuedev/config-yaml";

import { getGlobalConfigYamlPath, getWorkspaceConfigYamlPath } from "./configPaths";
import { e2eLog } from "../e2e/e2eLog";

type ConfigUpdateListener = (result: ConfigResult<AssistantUnrolled>) => void;

export type LiteAutocompleteSettings = {
  model: ModelConfig;
  requestOptionsBaseUrl?: string;
};

export type LiteLoadedConfig = {
  assistant: AssistantUnrolled;
  autocompleteModel: ModelConfig;
};

function isYamlFile(filePath: string): boolean {
  return filePath.endsWith(".yaml") || filePath.endsWith(".yml");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkYamlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && isYamlFile(full)) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

function findRemoteBlockUses(configYaml: any): string[] {
  const remoteUses: string[] = [];

  const scanList = (items: any[] | undefined) => {
    for (const item of items ?? []) {
      if (item && typeof item === "object" && "uses" in item) {
        const uses = (item as any).uses;
        if (typeof uses === "string") {
          const id = decodePackageIdentifier(uses);
          if (id.uriType === "slug") {
            remoteUses.push(uses);
          }
        }
      }
    }
  };

  scanList(configYaml.models);
  scanList(configYaml.context);
  scanList(configYaml.data);
  scanList(configYaml.mcpServers);
  scanList(configYaml.prompts);
  scanList(configYaml.docs);

  // rules can contain string | object | { uses }
  for (const rule of configYaml.rules ?? []) {
    if (rule && typeof rule === "object" && "uses" in rule) {
      const uses = (rule as any).uses;
      if (typeof uses === "string") {
        const id = decodePackageIdentifier(uses);
        if (id.uriType === "slug") {
          remoteUses.push(uses);
        }
      }
    }
  }

  return remoteUses;
}

class LocalOnlyRegistry implements Registry {
  constructor(private readonly rootPath: string) {}

  async getContent(id: PackageIdentifier): Promise<string> {
    if (id.uriType === "slug") {
      throw new Error(
        `Remote blocks are not supported in Continue Lite: ${id.fullSlug.ownerSlug}/${id.fullSlug.packageSlug}`,
      );
    }

    const filePath = path.isAbsolute(id.fileUri)
      ? id.fileUri
      : path.join(this.rootPath, id.fileUri);

    return await fs.readFile(filePath, "utf8");
  }
}

function pickFirstAutocompleteModel(assistant: AssistantUnrolled): ModelConfig | undefined {
  const models = assistant.models ?? [];
  for (const m of models) {
    if (!m) continue;
    const roles = m.roles ?? [];
    if (roles.includes("autocomplete")) {
      return m;
    }
  }
  return undefined;
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key) {
      out.push(item);
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeAssistantsWithWorkspaceOverride(
  globalAssistant: AssistantUnrolled,
  workspaceAssistant: AssistantUnrolled,
): AssistantUnrolled {
  const merged: AssistantUnrolled = {
    name: workspaceAssistant.name || globalAssistant.name,
    version: workspaceAssistant.version || globalAssistant.version,
    requestOptions: mergeConfigYamlRequestOptions(
      workspaceAssistant.requestOptions,
      globalAssistant.requestOptions,
    ),
    env: { ...(globalAssistant as any).env, ...(workspaceAssistant as any).env },
    metadata: (workspaceAssistant as any).metadata ?? (globalAssistant as any).metadata,
    schema: (workspaceAssistant as any).schema ?? (globalAssistant as any).schema,
  } as any;

  for (const blockType of BLOCK_TYPES) {
    const wsBlocks = ((workspaceAssistant as any)[blockType] ?? []).filter(Boolean);
    const globalBlocks = ((globalAssistant as any)[blockType] ?? []).filter(Boolean);
    const combined = [...wsBlocks, ...globalBlocks];

    const deduped =
      blockType === "context"
        ? dedupeByKey(combined, (b: any) => b?.provider)
        : blockType === "rules"
          ? dedupeByKey(combined, (b: any) => (typeof b === "string" ? b : b?.name))
          : dedupeByKey(combined, (b: any) => b?.name);

    if (deduped.length > 0) {
      (merged as any)[blockType] = deduped;
    }
  }

  return merged;
}

async function unrollConfigFile(options: {
  configPath: string;
  injectBlocks: PackageIdentifier[];
}): Promise<ConfigResult<AssistantUnrolled>> {
  const { configPath, injectBlocks } = options;

  const rawYaml = await fs.readFile(configPath, "utf8");

  // Parse + validate first (so we can enforce local-only "uses")
  let parsed: any;
  try {
    parsed = parseConfigYaml(rawYaml);
  } catch (e) {
    return {
      config: undefined,
      errors: [
        {
          fatal: true,
          message: `Failed to parse config.yaml: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      configLoadInterrupted: true,
    };
  }

  const remoteUses = findRemoteBlockUses(parsed);
  if (remoteUses.length > 0) {
    return {
      config: undefined,
      errors: remoteUses.map((u) => ({
        fatal: true,
        message: `Remote block reference is not supported in Continue Lite: ${u}. Use a local file path instead.`,
      })),
      configLoadInterrupted: true,
    };
  }

  const rootPath = path.dirname(configPath);
  const registry = new LocalOnlyRegistry(rootPath);

  const result = await unrollAssistantFromContent(
    { uriType: "file", fileUri: configPath },
    rawYaml,
    registry,
    { renderSecrets: false, injectBlocks },
  );

  // `unrollAssistantFromContent` returns ConfigResult, but doesn't use configLoadInterrupted for our cases.
  return result;
}

export class LiteConfigService {
  private cachedResult: ConfigResult<AssistantUnrolled> | null = null;
  private listeners: Set<ConfigUpdateListener> = new Set();

  constructor(private readonly options: { workspaceDirs: string[] }) {}

  getWatchedConfigPaths(): string[] {
    const watched: string[] = [];
    watched.push(getGlobalConfigYamlPath());
    const workspaceConfig = this.getWorkspaceConfigPath();
    if (workspaceConfig) {
      watched.push(workspaceConfig);
    }
    return watched;
  }

  private getWorkspaceConfigPath(): string | undefined {
    const [firstWorkspace] = this.options.workspaceDirs;
    if (!firstWorkspace) {
      return undefined;
    }
    return getWorkspaceConfigYamlPath(firstWorkspace);
  }

  onConfigUpdate(listener: ConfigUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(result: ConfigResult<AssistantUnrolled>) {
    for (const listener of this.listeners) {
      listener(result);
    }
  }

  async reloadConfig(_reason: string): Promise<ConfigResult<AssistantUnrolled>> {
    const result = await this.loadConfig({ force: true });
    this.notify(result);
    return result;
  }

  async loadConfig(options?: { force?: boolean }): Promise<ConfigResult<AssistantUnrolled>> {
    if (!options?.force && this.cachedResult) {
      return this.cachedResult;
    }

    const debug = process.env.NODE_ENV === "e2e";
    const errors: ConfigValidationError[] = [];

    const globalConfigPath = getGlobalConfigYamlPath();
    const workspaceConfigPath = this.getWorkspaceConfigPath();

    const workspaceDirs = this.options.workspaceDirs;
    const globalDir = path.dirname(globalConfigPath);

    const injectBlocks: PackageIdentifier[] = [];

    // Global + workspace .continue/<blockType> YAML blocks
    for (const blockType of BLOCK_TYPES) {
      const globalBlocksDir = path.join(globalDir, blockType);
      for (const filePath of await walkYamlFiles(globalBlocksDir)) {
        injectBlocks.push({ uriType: "file", fileUri: filePath });
      }

      for (const workspaceDir of workspaceDirs) {
        const wsBlocksDir = path.join(workspaceDir, ".continue", blockType);
        for (const filePath of await walkYamlFiles(wsBlocksDir)) {
          injectBlocks.push({ uriType: "file", fileUri: filePath });
        }
      }
    }

    const globalExists = await fileExists(globalConfigPath);
    const workspaceExists = workspaceConfigPath
      ? await fileExists(workspaceConfigPath)
      : false;

    if (debug) {
      e2eLog(
        `[continue-lite] loadConfig global=${globalConfigPath} exists=${globalExists} workspace=${workspaceConfigPath ?? ""} exists=${workspaceExists}`,
      );
    }

    let globalAssistant: AssistantUnrolled | undefined;
    let workspaceAssistant: AssistantUnrolled | undefined;

    if (globalExists) {
      const result = await unrollConfigFile({
        configPath: globalConfigPath,
        injectBlocks,
      });
      if (result.errors) errors.push(...result.errors);
      if (result.config) globalAssistant = result.config;
    }

    if (workspaceExists && workspaceConfigPath) {
      const result = await unrollConfigFile({
        configPath: workspaceConfigPath,
        injectBlocks,
      });
      if (result.errors) errors.push(...result.errors);
      if (result.config) workspaceAssistant = result.config;
    }

    if (!globalAssistant && !workspaceAssistant) {
      const notFoundErrors: ConfigValidationError[] = [];
      if (!workspaceExists && workspaceConfigPath) {
        notFoundErrors.push({
          fatal: true,
          message: `Continue Lite could not find workspace config.yaml at ${workspaceConfigPath}`,
        });
      }
      if (!globalExists) {
        notFoundErrors.push({
          fatal: true,
          message: `Continue Lite could not find global config.yaml at ${globalConfigPath}`,
        });
      }

      const result: ConfigResult<AssistantUnrolled> = {
        config: undefined,
        errors: [...errors, ...notFoundErrors],
        configLoadInterrupted: true,
      };
      this.cachedResult = result;
      return result;
    }

    const merged =
      globalAssistant && workspaceAssistant
        ? mergeAssistantsWithWorkspaceOverride(globalAssistant, workspaceAssistant)
        : (workspaceAssistant ?? globalAssistant!);

    const autocompleteModel = pickFirstAutocompleteModel(merged);
    if (!autocompleteModel) {
      errors.push({
        fatal: true,
        message:
          "No model with role 'autocomplete' found in config.yaml (models[].roles must include 'autocomplete').",
      });
    } else if (autocompleteModel.provider !== "ollama") {
      errors.push({
        fatal: true,
        message: `Only provider 'ollama' is supported in Continue Lite. Found: ${autocompleteModel.provider}`,
      });
    }

    if (debug && autocompleteModel) {
      e2eLog(
        `[continue-lite] selected autocomplete model name=${autocompleteModel.name ?? ""} provider=${autocompleteModel.provider} model=${autocompleteModel.model}`,
      );
    }

    const result: ConfigResult<AssistantUnrolled> = {
      config: merged,
      errors: errors.length > 0 ? errors : undefined,
      configLoadInterrupted: errors.some((e) => e.fatal) && !autocompleteModel,
    };

    this.cachedResult = result;
    return result;
  }

  async loadLiteConfig(): Promise<
    { config: LiteLoadedConfig; errors?: ConfigValidationError[] } | { config: undefined; errors?: ConfigValidationError[] }
  > {
    const { config: assistant, errors, configLoadInterrupted } = await this.loadConfig();
    if (configLoadInterrupted || !assistant) {
      return { config: undefined, errors };
    }

    const model = pickFirstAutocompleteModel(assistant);
    if (!model || model.provider !== "ollama") {
      return { config: undefined, errors };
    }

    return {
      config: {
        assistant,
        autocompleteModel: model,
      },
      errors,
    };
  }
}
