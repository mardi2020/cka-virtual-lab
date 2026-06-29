import { createFileSystem, resetFilesForQuestion } from "./filesystem.js";
import { runShellCommand } from "./shell.js";

export function createLabSession({ questions, initialCluster }) {
  let cluster = structuredClone(initialCluster);
  let files = createFileSystem(questions);
  let cwd = "/home/candidate";
  let context = "k8s-admin@sim-cluster";
  let editor = null;

  function getSnapshot() {
    return {
      cluster: structuredClone(cluster),
      files: structuredClone(files),
      cwd,
      context,
      editor: editor ? structuredClone(editor) : null,
      prompt: editor ? `vim:${editor.path} [${editor.mode}]` : `candidate@cka:${cwd}$`,
    };
  }

  function runCommand(command) {
    const result = runShellCommand({
      command,
      cluster,
      files,
      cwd,
      context,
      editor,
    });
    cluster = result.cluster;
    files = result.files;
    cwd = result.cwd;
    context = result.context;
    editor = result.editor ?? null;
    return {
      command,
      output: result.output,
      cwd,
      prompt: editor ? `vim:${editor.path} [${editor.mode}]` : `candidate@cka:${cwd}$`,
      cluster: structuredClone(cluster),
      files: structuredClone(files),
      editor: editor ? structuredClone(editor) : null,
    };
  }

  function resetQuestion(questionId) {
    files = resetFilesForQuestion(files, questions.find((question) => question.id === questionId));
    editor = null;
  }

  function updateEditorBuffer(nextBuffer) {
    if (!editor) return getSnapshot();

    const buffer = String(nextBuffer ?? "");
    editor = {
      ...editor,
      buffer,
      dirty: editor.dirty || buffer !== editor.buffer,
    };
    return getSnapshot();
  }

  return {
    getSnapshot,
    runCommand,
    resetQuestion,
    updateEditorBuffer,
    activeQuestionId: questions[0]?.id ?? null,
  };
}
