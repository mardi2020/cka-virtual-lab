import { describe, expect, it } from "vitest";
import { createFileSystem, ensureDir } from "./filesystem.js";
import { getCdCompletions } from "./completion.js";

describe("terminal completion", () => {
  it("suggests matching directories for cd path fragments", () => {
    const files = createFileSystem();

    expect(getCdCompletions("cd m", { files, cwd: "/home/candidate" })).toEqual([
      {
        label: "manifests/",
        replacement: "cd manifests/",
      },
    ]);
  });

  it("completes nested and absolute cd directory fragments", () => {
    const files = createFileSystem();
    ensureDir(files, "/home/candidate/manifests/cache");
    ensureDir(files, "/home/candidate/manifests/configs");

    expect(getCdCompletions("cd manifests/c", { files, cwd: "/home/candidate" })).toEqual([
      {
        label: "cache/",
        replacement: "cd manifests/cache/",
      },
      {
        label: "configs/",
        replacement: "cd manifests/configs/",
      },
    ]);
    expect(getCdCompletions("cd /home/candidate/m", { files, cwd: "/home/candidate" })).toEqual([
      {
        label: "manifests/",
        replacement: "cd /home/candidate/manifests/",
      },
    ]);
  });

  it("does not suggest files or non-cd commands", () => {
    const files = createFileSystem();
    files["/home/candidate/memo.txt"] = { type: "file", content: "" };

    expect(getCdCompletions("cd me", { files, cwd: "/home/candidate" })).toEqual([]);
    expect(getCdCompletions("kubectl get m", { files, cwd: "/home/candidate" })).toEqual([]);
  });
});
