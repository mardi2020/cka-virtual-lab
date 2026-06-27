import { directChildren, normalizePath, pathType } from "./filesystem.js";

export function getCdCompletions(input, { files, cwd }) {
  const command = String(input ?? "");
  if (command.includes("\n")) return [];

  const match = command.match(/^(\s*cd\s+)(\S*)$/);
  if (!match) return [];

  const [, commandPrefix, fragment] = match;
  const pathParts = splitPathFragment(fragment);
  if (!pathParts.prefix) return [];

  const baseDir = normalizePath(cwd, pathParts.parentInput || ".");
  if (pathType(files, baseDir) !== "dir") return [];

  return directChildren(files, baseDir)
    .filter((name) => name.startsWith(pathParts.prefix))
    .filter((name) => pathType(files, normalizePath(baseDir, name)) === "dir")
    .map((name) => ({
      label: `${name}/`,
      replacement: `${commandPrefix}${pathParts.parentReplacement}${name}/`,
    }));
}

function splitPathFragment(fragment) {
  const lastSlash = fragment.lastIndexOf("/");
  if (lastSlash < 0) {
    return {
      parentInput: "",
      parentReplacement: "",
      prefix: fragment,
    };
  }

  const parentInput = fragment.slice(0, lastSlash) || "/";
  return {
    parentInput,
    parentReplacement: `${fragment.slice(0, lastSlash + 1)}`,
    prefix: fragment.slice(lastSlash + 1),
  };
}
