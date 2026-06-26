import { createFileSystem, resetFilesForQuestion } from "./filesystem.js";
import { runShellCommand } from "./shell.js";

export function createLabSession({ questions, initialCluster }) {
  let cluster = structuredClone(initialCluster);
  let files = createFileSystem(questions);
  let cwd = "/home/candidate";
  let context = "k8s-admin@sim-cluster";

  function getSnapshot() {
    return {
      cluster: structuredClone(cluster),
      files: structuredClone(files),
      cwd,
      context,
      prompt: `candidate@cka:${cwd}$`,
    };
  }

  function runCommand(command) {
    const result = runShellCommand({
      command,
      cluster,
      files,
      cwd,
      context,
    });
    cluster = result.cluster;
    files = result.files;
    cwd = result.cwd;
    context = result.context;
    return {
      command,
      output: result.output,
      cwd,
      prompt: `candidate@cka:${cwd}$`,
      cluster: structuredClone(cluster),
      files: structuredClone(files),
    };
  }

  function resetQuestion(questionId) {
    files = resetFilesForQuestion(files, questions.find((question) => question.id === questionId));
  }

  return {
    getSnapshot,
    runCommand,
    resetQuestion,
    activeQuestionId: questions[0]?.id ?? null,
  };
}
