import * as vscode from "vscode";

import type { CompletionOptions, ModelConfig } from "@continuedev/config-yaml";

import type { LiteConfigService } from "../config/LiteConfigService";
import { OllamaClient } from "../llm/ollamaClient";
import { e2eLog } from "../e2e/e2eLog";

type SettingsSnapshot = {
  enabled: boolean;
  ollamaBaseUrl: string;
};

function firstLine(text: string): string {
  const idx = text.indexOf("\n");
  return idx === -1 ? text : text.slice(0, idx);
}

function getCursorOffset(document: vscode.TextDocument, position: vscode.Position): number {
  return document.offsetAt(position);
}

function getSurroundingText(document: vscode.TextDocument, position: vscode.Position): {
  prefix: string;
  suffix: string;
} {
  const text = document.getText();
  const offset = getCursorOffset(document, position);

  const maxPrefixChars = 8000;
  const maxSuffixChars = 4000;

  const prefixStart = Math.max(0, offset - maxPrefixChars);
  const suffixEnd = Math.min(text.length, offset + maxSuffixChars);

  return {
    prefix: text.slice(prefixStart, offset),
    suffix: text.slice(offset, suffixEnd),
  };
}

function toOllamaOptions(opts: CompletionOptions | undefined): Record<string, any> | undefined {
  if (!opts) return undefined;

  const o: Record<string, any> = {};
  if (typeof opts.temperature === "number") o.temperature = opts.temperature;
  if (typeof opts.topK === "number") o.top_k = opts.topK;
  if (typeof opts.topP === "number") o.top_p = opts.topP;
  if (typeof opts.minP === "number") o.min_p = opts.minP;
  if (typeof opts.contextLength === "number") o.num_ctx = opts.contextLength;
  if (typeof opts.maxTokens === "number") o.num_predict = opts.maxTokens;
  if (Array.isArray(opts.stop) && opts.stop.length > 0) o.stop = opts.stop;
  return Object.keys(o).length > 0 ? o : undefined;
}

export class LiteInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private lastAutoRequestAt = 0;
  private inFlightAbort: AbortController | null = null;

  constructor(
    private readonly configService: LiteConfigService,
    private readonly getSettings: () => SettingsSnapshot,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
    const debug = process.env.NODE_ENV === "e2e";

    const { enabled, ollamaBaseUrl } = this.getSettings();
    if (!enabled) return null;
    if (token.isCancellationRequested) return null;
    if (document.uri.scheme === "vscode-scm") return null;

    if (debug) {
      e2eLog(
        `[continue-lite] inlineCompletion trigger=${context.triggerKind} scheme=${document.uri.scheme}`,
      );
    }

    const lite = await this.configService.loadLiteConfig();
    const model = lite.config?.autocompleteModel;
    if (!model) {
      if (debug) {
        e2eLog("[continue-lite] no autocomplete model (config missing or invalid)");
      }
      return null;
    }

    // Debounce automatic triggers
    const debounceDelay = model.autocompleteOptions?.debounceDelay ?? 150;
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      const now = Date.now();
      if (now - this.lastAutoRequestAt < debounceDelay) {
        return null;
      }
      this.lastAutoRequestAt = now;
    }

    // Cancel previous request
    this.inFlightAbort?.abort();
    const abortController = new AbortController();
    this.inFlightAbort = abortController;

    token.onCancellationRequested(() => abortController.abort());

    const modelTimeout = model.autocompleteOptions?.modelTimeout ?? 20_000;
    const timeout = setTimeout(() => abortController.abort(), modelTimeout);

    try {
      const { prefix, suffix } = getSurroundingText(document, position);

      const baseUrl = (model.apiBase ?? ollamaBaseUrl) || "http://localhost:11434/";
      const client = new OllamaClient(baseUrl);

      const completionOptions = toOllamaOptions(model.defaultCompletionOptions as CompletionOptions | undefined);

      let completion = "";
      const req = {
        model: model.model,
        prompt: prefix,
        suffix,
        raw: true as const,
        stream: true as const,
        options: completionOptions,
      };

      if (debug) {
        e2eLog(
          `[continue-lite] ollama.generate baseUrl=${baseUrl} model=${model.model} prefix=${prefix.length} suffix=${suffix.length}`,
        );
      }

      for await (const delta of client.streamGenerate(req, abortController.signal)) {
        completion += delta;
        if (completion.length > 2000) break;
      }

      if (abortController.signal.aborted) return null;

      const cleaned = firstLine(completion);
      if (!cleaned || cleaned.trim().length === 0) return null;

      if (debug) {
        e2eLog(
          `[continue-lite] completion received chars=${cleaned.length} preview=${JSON.stringify(cleaned.slice(0, 80))}`,
        );
      }

      const range = new vscode.Range(position, position);
      return [new vscode.InlineCompletionItem(cleaned, range)];
    } catch (e) {
      if (abortController.signal.aborted) {
        return null;
      }
      if (e instanceof Error && e.name === "AbortError") {
        return null;
      }
      const message = e instanceof Error ? e.message : String(e);
      if (debug) {
        e2eLog(`[continue-lite] completion error: ${message}`);
      }
      void vscode.window.showErrorMessage(`Continue Lite Autocomplete Error: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
