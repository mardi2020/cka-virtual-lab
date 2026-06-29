import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commandInputPlaceholder, vimNormalKeyAction } from "./App.jsx";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

describe("app shell copy", () => {
  it("does not render the old welcome message and exposes a test reset button", () => {
    expect(appSource).not.toContain("CKA Virtual Lab에 오신 것을 환영합니다");
    expect(appSource).not.toContain("help를 입력하면 지원 명령을 볼 수 있습니다");
    expect(appSource).toContain("Reset test");
  });

  it("shows vim-specific input affordances while the editor is active", () => {
    expect(commandInputPlaceholder({ editor: null })).toBe("kubectl get pods -A");
    expect(commandInputPlaceholder({ editor: { mode: "normal" } })).toBe("");
    expect(commandInputPlaceholder({ editor: { mode: "insert" } })).toBe("");
  });

  it("renders vim as a file editor surface instead of a shell placeholder", () => {
    expect(appSource).toContain("vim-buffer-editor");
    expect(appSource).toContain("updateEditorBuffer");
    expect(appSource).not.toContain(":%s#old#new#g");
  });

  it("routes normal-mode vim keys through the file buffer", () => {
    expect(vimNormalKeyAction("i")).toEqual({ type: "command", command: "i" });
    expect(vimNormalKeyAction(":")).toEqual({ type: "commandLine", value: ":" });
    expect(vimNormalKeyAction("x")).toBeNull();
  });
});
