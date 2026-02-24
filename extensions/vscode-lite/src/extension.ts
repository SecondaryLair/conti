import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { LiteConfigService } from "./config/LiteConfigService";
import { LiteInlineCompletionProvider } from "./autocomplete/LiteInlineCompletionProvider";
import { e2eLog } from "./e2e/e2eLog";

const EXTENSION_SECTION = "continueLite";

export async function activate(context: vscode.ExtensionContext) {
  if (process.env.NODE_ENV === "e2e") {
    e2eLog(
      `[continue-lite] activate cwd=${process.cwd()} CONTINUE_GLOBAL_DIR=${process.env.CONTINUE_GLOBAL_DIR ?? ""}`,
    );
  }

  const workspaceDirs = (vscode.workspace.workspaceFolders ?? []).map((f) =>
    f.uri.fsPath,
  );

  const configService = new LiteConfigService({
    workspaceDirs,
  });

  // Initial load (non-blocking)
  void configService.loadConfig().then((result) => {
    if (result.configLoadInterrupted) {
      const msg =
        result.errors?.[0]?.message ??
        "Continue Lite: failed to load config.yaml";
      void vscode.window.showErrorMessage(msg);
    }
  });

  const provider = new LiteInlineCompletionProvider(configService, () => {
    const settings = vscode.workspace.getConfiguration(EXTENSION_SECTION);
    return {
      enabled: settings.get<boolean>("enableTabAutocomplete", true),
      ollamaBaseUrl: settings.get<string>("ollamaBaseUrl", "http://localhost:11434/"),
    };
  });

  if (process.env.NODE_ENV === "e2e") {
    e2eLog("[continue-lite] registering inline completion provider");
  }
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      [{ pattern: "**" }],
      provider,
    ),
  );

  if (process.env.NODE_ENV === "e2e") {
    e2eLog("[continue-lite] registering commands");
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("continueLite.forceAutocomplete", async () => {
      if (process.env.NODE_ENV === "e2e") {
        e2eLog("[continue-lite] command continueLite.forceAutocomplete invoked");
      }
      // Mirror Continue's Force Autocomplete behavior:
      // Hide any cached suggestion for the current position, then trigger a new request.
      await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");
      await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }),
  );

  const watchPaths = configService.getWatchedConfigPaths();
  if (process.env.NODE_ENV === "e2e") {
    e2eLog(`[continue-lite] watching config paths: ${watchPaths.join(",")}`);
  }
  for (const p of watchPaths) {
    fs.watchFile(p, { interval: 1000 }, async (stats) => {
      if (stats.size === 0) {
        return;
      }
      await configService.reloadConfig(
        `Config updated - fs watch (${path.basename(p)})`,
      );
    });
  }
}

export function deactivate() {}
