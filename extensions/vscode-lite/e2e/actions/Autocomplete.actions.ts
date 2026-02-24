import { expect } from "chai";
import { TextEditor, VSBrowser, Workbench } from "vscode-extension-tester";

import { DEFAULT_TIMEOUT } from "../constants";
import { AutocompleteSelectors } from "../selectors/Autocomplete.selectors";
import { TestUtils } from "../TestUtils";

export class AutocompleteActions {
  public static async forceCompletion(editor: TextEditor): Promise<string> {
    // Avoid TextEditor.typeTextAt/moveCursor: those call clipboard-based helpers
    // which are flaky/hanging in headless CI environments.
    console.log("[e2e] forceCompletion: typeText");
    await editor.typeText("def add(a, b):\n    return ");

    console.log("[e2e] forceCompletion: executeCommand(Force Autocomplete)");
    await new Workbench().executeCommand("Continue Lite: Force Autocomplete");

    console.log("[e2e] forceCompletion: waitFor ghost text");
    const ghostText = await TestUtils.waitForSuccess(
      () => AutocompleteSelectors.getGhostTextContent(VSBrowser.instance.driver),
      DEFAULT_TIMEOUT.XL,
    );

    expect(ghostText.trim().length).to.be.greaterThan(0);
    return ghostText;
  }
}
