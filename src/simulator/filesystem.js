const HOME_DIR = "/home/candidate";

export function createFileSystem(questions = []) {
  const files = {
    "/": { type: "dir" },
    "/home": { type: "dir" },
    "/home/candidate": { type: "dir" },
    "/home/candidate/manifests": { type: "dir" },
    "/etc": { type: "dir" },
    "/etc/kubernetes": { type: "dir" },
    "/var": { type: "dir" },
    "/var/log": { type: "dir" },
    "/var/log/kubelet.log": {
      type: "file",
      content:
        "Jun 26 09:00:11 worker-2 kubelet[1842]: failed to pull image registry.k8s.io/pause: network timeout\nJun 26 09:01:08 worker-2 kubelet[1842]: node condition Ready changed to False\n",
    },
  };

  for (const question of questions) {
    for (const [path, content] of Object.entries(question.startingFiles ?? {})) {
      ensureParentDirs(files, path);
      files[path] = { type: "file", content };
    }
  }

  return files;
}

export function resetFilesForQuestion(files, question) {
  const next = structuredClone(files);
  for (const [path, content] of Object.entries(question?.startingFiles ?? {})) {
    ensureParentDirs(next, path);
    next[path] = { type: "file", content };
  }
  return next;
}

export function normalizePath(cwd, input = ".") {
  const value = String(input ?? ".").trim() || ".";
  const raw =
    value === "~"
      ? HOME_DIR
      : value.startsWith("~/")
        ? `${HOME_DIR}/${value.slice(2)}`
        : value.startsWith("/")
          ? value
          : `${cwd || "/"}/${value}`;
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length) parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function ensureParentDirs(files, filePath) {
  return ensureDir(files, dirname(filePath));
}

export function ensureDir(files, dirPath) {
  const path = normalizePath("/", dirPath);
  if (path === "/") {
    files["/"] = files["/"] ?? { type: "dir" };
    return { ok: true };
  }

  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current += `/${part}`;
    const entry = files[current];
    if (entry?.type === "file") {
      return { ok: false, message: `${current}: Not a directory` };
    }
    if (!entry) files[current] = { type: "dir" };
  }
  return { ok: true };
}

export function dirname(filePath) {
  const normalized = normalizePath("/", filePath);
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function basename(filePath) {
  const normalized = normalizePath("/", filePath);
  if (normalized === "/") return "/";
  return normalized.split("/").filter(Boolean).at(-1) ?? "/";
}

export function directChildren(files, dirPath) {
  const normalized = normalizePath("/", dirPath);
  const prefix = normalized === "/" ? "/" : `${normalized}/`;
  return [...new Set(
    Object.keys(files)
      .filter((path) => path.startsWith(prefix) && path !== normalized)
      .map((path) => path.slice(prefix.length).split("/")[0])
      .filter(Boolean),
  )].sort();
}

export function removePath(files, path) {
  const normalized = normalizePath("/", path);
  for (const existingPath of Object.keys(files)) {
    if (existingPath === normalized || existingPath.startsWith(`${normalized}/`)) {
      delete files[existingPath];
    }
  }
}

export function parentExists(files, filePath) {
  const parent = dirname(filePath);
  return files[parent]?.type === "dir";
}

export function pathType(files, path) {
  return files[normalizePath("/", path)]?.type;
}
