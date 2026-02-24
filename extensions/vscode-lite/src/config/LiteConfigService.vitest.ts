import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { LiteConfigService } from "./LiteConfigService";

async function mkTempDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

const baseConfig = (modelsYaml: string) => `name: Test Config
version: 0.0.1
schema: v1
${modelsYaml}
`;

describe("LiteConfigService", () => {
  const prevEnv = process.env.CONTINUE_GLOBAL_DIR;

  beforeEach(() => {
    process.env.CONTINUE_GLOBAL_DIR = undefined;
  });

  afterEach(async () => {
    if (prevEnv === undefined) {
      delete process.env.CONTINUE_GLOBAL_DIR;
    } else {
      process.env.CONTINUE_GLOBAL_DIR = prevEnv;
    }
  });

  it("loads global config.yaml only", async () => {
    const globalDir = await mkTempDir("continue-lite-global-");
    process.env.CONTINUE_GLOBAL_DIR = globalDir;

    await writeFile(
      path.join(globalDir, "config.yaml"),
      baseConfig(`models:
  - name: Ollama Model A
    provider: ollama
    model: qwen2.5-coder:1.5b
    roles: [autocomplete]
`),
    );

    const service = new LiteConfigService({ workspaceDirs: [] });
    const lite = await service.loadLiteConfig();

    expect(lite.config).toBeTruthy();
    expect(lite.config?.autocompleteModel.provider).toBe("ollama");
    expect(lite.config?.autocompleteModel.model).toBe("qwen2.5-coder:1.5b");
  });

  it("workspace config.yaml overrides global config.yaml", async () => {
    const globalDir = await mkTempDir("continue-lite-global-");
    const workspaceDir = await mkTempDir("continue-lite-workspace-");
    process.env.CONTINUE_GLOBAL_DIR = globalDir;

    await writeFile(
      path.join(globalDir, "config.yaml"),
      baseConfig(`models:
  - name: Global Model
    provider: ollama
    model: qwen2.5-coder:1.5b
    roles: [autocomplete]
`),
    );

    await writeFile(
      path.join(workspaceDir, ".continue", "config.yaml"),
      baseConfig(`models:
  - name: Workspace Model
    provider: ollama
    model: qwen2.5-coder:1.5b
    roles: [autocomplete]
`),
    );

    const service = new LiteConfigService({ workspaceDirs: [workspaceDir] });
    const lite = await service.loadLiteConfig();

    expect(lite.config).toBeTruthy();
    expect(lite.config?.autocompleteModel.name).toBe("Workspace Model");
  });

  it("injects local .continue/models blocks", async () => {
    const globalDir = await mkTempDir("continue-lite-global-");
    const workspaceDir = await mkTempDir("continue-lite-workspace-");
    process.env.CONTINUE_GLOBAL_DIR = globalDir;

    await writeFile(path.join(globalDir, "config.yaml"), baseConfig(""));

    await writeFile(
      path.join(workspaceDir, ".continue", "models", "injected.yaml"),
      `name: Injected Models
version: 0.0.1
schema: v1
models:
  - name: Injected Autocomplete Model
    provider: ollama
    model: qwen2.5-coder:1.5b
    roles:
      - autocomplete
`,
    );

    const service = new LiteConfigService({ workspaceDirs: [workspaceDir] });
    const lite = await service.loadLiteConfig();

    expect(lite.config).toBeTruthy();
    expect(lite.config?.autocompleteModel.name).toBe(
      "Injected Autocomplete Model",
    );
  });

  it("rejects remote uses blocks", async () => {
    const globalDir = await mkTempDir("continue-lite-global-");
    process.env.CONTINUE_GLOBAL_DIR = globalDir;

    await writeFile(
      path.join(globalDir, "config.yaml"),
      baseConfig(`models:
  - uses: openai/gpt-4o
    with: {}
`),
    );

    const service = new LiteConfigService({ workspaceDirs: [] });
    const result = await service.loadConfig();

    expect(result.configLoadInterrupted).toBe(true);
    expect(result.config).toBeUndefined();
    expect(result.errors?.[0]?.message).toContain("Remote block reference");
  });
});

