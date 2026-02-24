import {
  EditorView,
  InputBox,
  TextEditor,
  VSBrowser,
  Workbench,
} from "vscode-extension-tester";

import { DEFAULT_TIMEOUT } from "../constants";

export class GlobalActions {
  static defaultFolder = "e2e/test-workspace";

  public static async openTestWorkspace() {
    console.log("[e2e] openTestWorkspace");
    await VSBrowser.instance.openResources(GlobalActions.defaultFolder);
    await new Workbench().executeCommand(
      "Notifications: Clear All Notifications",
    );
  }

  public static async createAndOpenNewTextFile(): Promise<{
    editor: TextEditor;
  }> {
    console.log("[e2e] createAndOpenNewTextFile");
    await new Workbench().executeCommand("Create: New File...");
    await (
      await InputBox.create(DEFAULT_TIMEOUT.MD)
    ).selectQuickPick("Text File");
    const editor = (await new EditorView().openEditor("Untitled-1")) as TextEditor;

    return { editor };
  }
}
