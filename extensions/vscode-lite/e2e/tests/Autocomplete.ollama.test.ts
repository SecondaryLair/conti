import { expect } from "chai";
import { EditorView, TextEditor } from "vscode-extension-tester";

import { AutocompleteActions } from "../actions/Autocomplete.actions";
import { GlobalActions } from "../actions/Global.actions";
import { DEFAULT_TIMEOUT } from "../constants";

async function ollamaPreflight(baseUrl: string, modelName: string) {
  const url = new URL("api/tags", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error(
      `Ollama preflight failed (HTTP ${resp.status}). Start Ollama with 'ollama serve'.`,
    );
  }
  const data = (await resp.json()) as any;
  const models: string[] = (data?.models ?? []).map((m: any) => m?.name).filter(Boolean);
  if (!models.includes(modelName)) {
    throw new Error(
      `Ollama model '${modelName}' not found. Run: ollama pull ${modelName}`,
    );
  }
}

describe("Autocomplete (Ollama)", () => {
  let editor: TextEditor;

  before(async function () {
    this.timeout(DEFAULT_TIMEOUT.XL);
    console.log("[e2e] ollamaPreflight");
    await ollamaPreflight("http://localhost:11434/", "qwen2.5-coder:1.5b");
  });

  beforeEach(async function () {
    this.timeout(DEFAULT_TIMEOUT.XL);
    console.log("[e2e] beforeEach: open workspace + new file");
    await GlobalActions.openTestWorkspace();
    ({ editor } = await GlobalActions.createAndOpenNewTextFile());
  });

  afterEach(async function () {
    this.timeout(DEFAULT_TIMEOUT.XL);
    try {
      await editor.clearText();
    } catch {
      // ignore
    }
    try {
      await new EditorView().closeAllEditors();
    } catch {
      // ignore
    }
  });

  it("Should display a completion (non-empty)", async () => {
    console.log("[e2e] test: Should display a completion");
    const ghostText = await AutocompleteActions.forceCompletion(editor);
    expect(ghostText.trim()).to.not.equal("");
  }).timeout(DEFAULT_TIMEOUT.XL);
});
