import {
  basename,
  directChildren,
  dirname,
  ensureDir,
  ensureParentDirs,
  normalizePath,
  parentExists,
  pathType,
  removePath,
} from "./filesystem.js";
import { runKubectl } from "./kubectl.js";

const EDITOR_GUIDANCE =
  "Interactive editors are not available in this browser-only simulator. Use: cat <<EOF > file.yaml ... EOF";
const SUPPORTED_COMMANDS = [
  "help",
  "clear",
  "pwd",
  "ls",
  "cd",
  "cat",
  "echo",
  "touch",
  "mkdir -p",
  "rm",
  "vi/vim/nano",
  "systemctl status kubelet",
  "systemctl restart kubelet",
  "journalctl -u kubelet",
  "kubectl/k",
];

export function runShellCommand({ command, cluster, files, cwd, context }) {
  const commandText = String(command ?? "").replace(/\r\n/g, "\n").trimEnd();
  const heredoc = parseHeredoc(commandText, cwd);
  if (heredoc) {
    return writeFile({ cluster, files, cwd, context }, heredoc.path, heredoc.content, false);
  }

  const tokens = tokenize(commandText);
  const [name, ...args] = tokens;
  if (!name) return ok("", cluster, files, cwd, context);
  if (name === "sudo") {
    return runShellCommand({ command: args.join(" "), cluster, files, cwd, context });
  }
  if (name === "kubectl" || name === "k") {
    return runKubectl({ args, cluster, files, cwd, context });
  }
  if (name === "help") {
    return ok(
      [
        "Supported commands:",
        `  ${SUPPORTED_COMMANDS.join(", ")}`,
        "Examples:",
        "  kubectl get pods -A",
        "  kubectl apply -f manifest.yaml",
        "  echo 'apiVersion: v1' > pod.yaml",
        "  cat <<EOF > pod.yaml",
      ].join("\n"),
      cluster,
      files,
      cwd,
      context,
    );
  }
  if (name === "clear") return ok("", cluster, files, cwd, context);
  if (name === "pwd") return ok(cwd, cluster, files, cwd, context);
  if (name === "cd") return runCd(args, cluster, files, cwd, context);
  if (name === "ls") return runLs(args, cluster, files, cwd, context);
  if (name === "cat") return runCat(args, cluster, files, cwd, context);
  if (name === "echo") return runEcho(args, cluster, files, cwd, context);
  if (name === "touch") return runTouch(args, cluster, files, cwd, context);
  if (name === "mkdir") return runMkdir(args, cluster, files, cwd, context);
  if (name === "rm") return runRm(args, cluster, files, cwd, context);
  if (["vi", "vim", "nano"].includes(name)) {
    const target = args[0] ? normalizePath(cwd, args[0]) : "file.yaml";
    return ok(`${name}: ${EDITOR_GUIDANCE}\nTarget path: ${target}`, cluster, files, cwd, context);
  }
  if (name === "systemctl") return runSystemctl(args, cluster, files, cwd, context);
  if (name === "journalctl") return runJournalctl(args, cluster, files, cwd, context);
  return ok(`${name}: command not found`, cluster, files, cwd, context);
}

export function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  const text = String(command ?? "");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === "\"" && char === "\\" && next) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    if (char === ">") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      if (next === ">") {
        tokens.push(">>");
        index += 1;
      } else {
        tokens.push(">");
      }
      continue;
    }
    if (char === "\\" && next) {
      current += next;
      index += 1;
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function runCd(args, cluster, files, cwd, context) {
  const input = args[0] ?? "~";
  const target = normalizePath(cwd, input);
  const entry = files[target];
  if (!entry) {
    return ok(`cd: ${input}: No such file or directory`, cluster, files, cwd, context);
  }
  if (entry.type !== "dir") {
    return ok(`cd: ${input}: Not a directory`, cluster, files, cwd, context);
  }
  return ok("", cluster, files, target, context);
}

function runLs(args, cluster, files, cwd, context) {
  const { flags, paths } = splitFlagsAndPaths(args);
  const long = flags.some((flag) => flag.includes("l"));
  const showAll = flags.some((flag) => flag.includes("a"));
  const targets = paths.length ? paths : ["."];
  const blocks = targets.map((input) => listTarget(files, cwd, input, { long, showAll }));
  return ok(blocks.join(targets.length > 1 ? "\n\n" : ""), cluster, files, cwd, context);
}

function listTarget(files, cwd, input, options) {
  const target = normalizePath(cwd, input);
  const entry = files[target];
  if (!entry) return `ls: cannot access '${input}': No such file or directory`;
  if (entry.type === "file") return options.long ? formatLongEntry(target, entry) : basename(target);

  const names = directChildren(files, target);
  const visibleNames = options.showAll ? [".", "..", ...names] : names;
  const listing = options.long
    ? visibleNames.map((name) => formatLongEntry(normalizePath(target, name), files[normalizePath(target, name)] ?? { type: "dir" })).join("\n")
    : visibleNames.join("  ");
  return listing;
}

function formatLongEntry(path, entry) {
  const mode = entry.type === "dir" ? "drwxr-xr-x" : "-rw-r--r--";
  const size = entry.type === "file" ? String(entry.content?.length ?? 0).padStart(5, " ") : "    0";
  return `${mode} 1 candidate candidate ${size} ${basename(path)}`;
}

function runCat(args, cluster, files, cwd, context) {
  const paths = args.filter((arg) => !arg.startsWith("-"));
  if (!paths.length) return ok("cat: missing operand", cluster, files, cwd, context);

  const chunks = paths.map((input, index) => {
    const target = normalizePath(cwd, input);
    const entry = files[target];
    const separator = index < paths.length - 1 ? "\n" : "";
    if (!entry) return `cat: ${input}: No such file or directory${separator}`;
    if (entry.type === "dir") return `cat: ${input}: Is a directory${separator}`;
    return entry.content ?? "";
  });
  return ok(chunks.join(""), cluster, files, cwd, context);
}

function runEcho(args, cluster, files, cwd, context) {
  const redirect = findRedirect(args);
  const contentArgs = redirect ? args.slice(0, redirect.index) : args;
  const noNewline = contentArgs[0] === "-n";
  const content = (noNewline ? contentArgs.slice(1) : contentArgs).join(" ");
  const text = noNewline ? content : `${content}\n`;

  if (redirect) {
    if (!redirect.target) {
      return ok(`echo: syntax error near unexpected token '${redirect.operator}'`, cluster, files, cwd, context);
    }
    return writeFile(
      { cluster, files, cwd, context },
      normalizePath(cwd, redirect.target),
      text,
      redirect.operator === ">>",
    );
  }
  return ok(content, cluster, files, cwd, context);
}

function runTouch(args, cluster, files, cwd, context) {
  const paths = args.filter((arg) => !arg.startsWith("-"));
  if (!paths.length) return ok("touch: missing file operand", cluster, files, cwd, context);

  const nextFiles = structuredClone(files);
  const errors = [];
  for (const input of paths) {
    const target = normalizePath(cwd, input);
    const parentResult = ensureParentDirs(nextFiles, target);
    if (!parentResult.ok) {
      errors.push(`touch: cannot touch '${input}': ${parentResult.message}`);
      continue;
    }
    if (nextFiles[target]?.type === "dir") continue;
    nextFiles[target] = nextFiles[target] ?? { type: "file", content: "" };
  }
  return ok(errors.join("\n"), cluster, nextFiles, cwd, context);
}

function runMkdir(args, cluster, files, cwd, context) {
  const { flags, paths } = splitFlagsAndPaths(args);
  const createParents = flags.some((flag) => flag.includes("p"));
  if (!paths.length) return ok("mkdir: missing operand", cluster, files, cwd, context);

  const nextFiles = structuredClone(files);
  const errors = [];
  for (const input of paths) {
    const target = normalizePath(cwd, input);
    const existingType = pathType(nextFiles, target);
    if (existingType) {
      if (createParents && existingType === "dir") continue;
      errors.push(`mkdir: cannot create directory '${input}': File exists`);
      continue;
    }
    if (createParents) {
      const result = ensureDir(nextFiles, target);
      if (!result.ok) errors.push(`mkdir: cannot create directory '${input}': ${result.message}`);
      continue;
    }
    if (!parentExists(nextFiles, target)) {
      const parentType = pathType(nextFiles, dirname(target));
      errors.push(`mkdir: cannot create directory '${input}': ${parentType === "file" ? "Not a directory" : "No such file or directory"}`);
      continue;
    }
    nextFiles[target] = { type: "dir" };
  }
  return ok(errors.join("\n"), cluster, nextFiles, cwd, context);
}

function runRm(args, cluster, files, cwd, context) {
  const { force, recursive, paths } = parseRmArgs(args);
  if (!paths.length) return ok("rm: missing operand", cluster, files, cwd, context);

  const nextFiles = structuredClone(files);
  const errors = [];
  for (const input of paths) {
    const target = normalizePath(cwd, input);
    const entry = nextFiles[target];
    if (!entry) {
      if (!force) errors.push(`rm: cannot remove '${input}': No such file or directory`);
      continue;
    }
    if (target === "/" && recursive) {
      errors.push("rm: it is dangerous to operate recursively on '/'");
      continue;
    }
    if (entry.type === "dir" && !recursive) {
      errors.push(`rm: cannot remove '${input}': Is a directory`);
      continue;
    }
    removePath(nextFiles, target);
  }
  return ok(errors.join("\n"), cluster, nextFiles, cwd, context);
}

function runSystemctl(args, cluster, files, cwd, context) {
  const action = args[0];
  const unit = normalizeUnit(args.slice(1).find((arg) => !arg.startsWith("-")));
  if (!action) return ok("systemctl: missing command", cluster, files, cwd, context);
  if (!isKubeletUnit(unit)) return ok(`Unit ${unit || "(missing)"} could not be found.`, cluster, files, cwd, context);

  if (action === "status") {
    const notReadyNodes = Object.values(cluster.nodes ?? {}).filter((node) => node.status !== "Ready");
    return ok(
      [
        "kubelet.service - kubelet: The Kubernetes Node Agent",
        "   Loaded: loaded (/lib/systemd/system/kubelet.service; enabled)",
        "   Active: active (running) (simulated)",
        `   Nodes reporting NotReady: ${notReadyNodes.map((node) => node.name).join(", ") || "none"}`,
      ].join("\n"),
      cluster,
      files,
      cwd,
      context,
    );
  }

  if (action === "restart") {
    const nextCluster = structuredClone(cluster);
    if (nextCluster.nodes?.["worker-2"]) {
      nextCluster.nodes["worker-2"] = {
        ...nextCluster.nodes["worker-2"],
        status: "Ready",
        cpu: nextCluster.nodes["worker-2"].cpu === "0%" ? "42%" : nextCluster.nodes["worker-2"].cpu,
        memory: nextCluster.nodes["worker-2"].memory === "0%" ? "61%" : nextCluster.nodes["worker-2"].memory,
      };
    }
    const nextFiles = structuredClone(files);
    appendToFile(nextFiles, "/var/log/kubelet.log", "Jun 26 09:05:42 worker-2 kubelet[1842]: kubelet restarted successfully\n");
    return ok("Restarted kubelet.service.", nextCluster, nextFiles, cwd, context);
  }

  return ok("systemctl: simulated support is limited to status kubelet and restart kubelet", cluster, files, cwd, context);
}

function runJournalctl(args, cluster, files, cwd, context) {
  const unit = normalizeUnit(findJournalUnit(args));
  if (!isKubeletUnit(unit)) {
    return ok("No journal entries for the requested unit.", cluster, files, cwd, context);
  }
  return ok(files["/var/log/kubelet.log"]?.content ?? "", cluster, files, cwd, context);
}

function writeFile(state, path, content, append) {
  const nextFiles = structuredClone(state.files);
  const existing = nextFiles[path];
  if (existing?.type === "dir") return ok(`${path}: Is a directory`, state.cluster, state.files, state.cwd, state.context);

  const parentResult = ensureParentDirs(nextFiles, path);
  if (!parentResult.ok) return ok(`${path}: ${parentResult.message}`, state.cluster, state.files, state.cwd, state.context);

  nextFiles[path] = {
    type: "file",
    content: append && existing?.type === "file" ? `${existing.content ?? ""}${content}` : content,
  };
  return ok("", state.cluster, nextFiles, state.cwd, state.context);
}

function appendToFile(files, path, content) {
  ensureParentDirs(files, path);
  const existing = files[path];
  files[path] = { type: "file", content: `${existing?.type === "file" ? existing.content ?? "" : ""}${content}` };
}

function findRedirect(args) {
  const index = args.findIndex((arg) => arg === ">" || arg === ">>");
  if (index < 0) return null;
  return { index, operator: args[index], target: args[index + 1] };
}

function splitFlagsAndPaths(args) {
  const flags = [];
  const paths = [];
  let forcePaths = false;
  for (const arg of args) {
    if (forcePaths) {
      paths.push(arg);
    } else if (arg === "--") {
      forcePaths = true;
    } else if (arg.startsWith("-") && arg !== "-") {
      flags.push(arg);
    } else {
      paths.push(arg);
    }
  }
  return { flags, paths };
}

function parseRmArgs(args) {
  const { flags, paths } = splitFlagsAndPaths(args);
  return {
    force: flags.some((flag) => flag === "--force" || flag.includes("f")),
    recursive: flags.some((flag) => flag === "--recursive" || flag.includes("r") || flag.includes("R")),
    paths,
  };
}

function parseHeredoc(command, cwd) {
  if (!command.includes("\n")) return null;
  const [firstLine, ...rest] = command.split("\n");
  const tokens = tokenize(firstLine);
  if (tokens[0] !== "cat") return null;

  const delimiter = heredocDelimiter(firstLine);
  const redirect = findRedirect(tokens);
  if (!delimiter || !redirect?.target) return null;

  const endIndex = rest.findIndex((line) => line.trim() === delimiter);
  if (endIndex < 0) return null;
  const contentLines = rest.slice(0, endIndex);
  return {
    path: normalizePath(cwd, redirect.target),
    content: contentLines.length ? `${contentLines.join("\n")}\n` : "",
  };
}

function heredocDelimiter(firstLine) {
  const match = firstLine.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_.-]*)\1/) ?? firstLine.match(/<<-?(['"]?)([A-Za-z_][A-Za-z0-9_.-]*)\1/);
  return match?.[2] ?? null;
}

function valueAfter(args, flag) {
  const direct = args.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) return direct.split("=").slice(1).join("=");
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function findJournalUnit(args) {
  const explicit = valueAfter(args, "-u") ?? valueAfter(args, "--unit");
  if (explicit) return explicit;
  const compact = args.find((arg) => arg.startsWith("-u") && arg.length > 2);
  if (compact) return compact.slice(2);
  const uFlagIndex = args.findIndex((arg) => /^-[A-Za-z]*u[A-Za-z]*$/.test(arg));
  if (uFlagIndex >= 0) return args.slice(uFlagIndex + 1).find((arg) => !arg.startsWith("-"));
  return "";
}

function normalizeUnit(unit) {
  if (!unit) return "";
  return unit.endsWith(".service") ? unit : `${unit}.service`;
}

function isKubeletUnit(unit) {
  return unit === "kubelet.service";
}

function ok(output, cluster, files, cwd, context) {
  return { output, cluster, files, cwd, context };
}
