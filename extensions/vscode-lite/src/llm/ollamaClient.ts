export type OllamaGenerateOptions = {
  temperature?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  num_ctx?: number;
  num_predict?: number;
  stop?: string[] | string;
};

export type OllamaGenerateRequest = {
  model: string;
  prompt: string;
  suffix?: string;
  stream: true;
  raw?: boolean;
  keep_alive?: number;
  options?: OllamaGenerateOptions;
};

type OllamaGenerateChunk =
  | { error: string }
  | { response?: string; done?: boolean };

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export class OllamaClient {
  constructor(private readonly baseUrl: string) {}

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await fetch(new URL("api/tags", normalizeBaseUrl(this.baseUrl)), {
      method: "GET",
      signal,
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to list Ollama models (HTTP ${response.status}). Is Ollama running at ${this.baseUrl}?`,
      );
    }
    const data = (await response.json()) as any;
    return (data?.models ?? []).map((m: any) => m?.name).filter(Boolean);
  }

  async *streamGenerate(
    req: OllamaGenerateRequest,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const response = await fetch(new URL("api/generate", normalizeBaseUrl(this.baseUrl)), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Ollama /api/generate failed (HTTP ${response.status}): ${text}`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Ollama response body is empty");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk: OllamaGenerateChunk;
        try {
          chunk = JSON.parse(trimmed);
        } catch (e) {
          throw new Error(`Error parsing Ollama response chunk: ${trimmed}`);
        }

        if ("error" in chunk) {
          throw new Error(chunk.error);
        }

        if (chunk.response) {
          yield chunk.response;
        }
      }
    }
  }
}
