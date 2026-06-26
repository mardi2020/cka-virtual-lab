# CKA Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-only CKA-style practice simulator with a virtual terminal, Kubernetes state engine, curriculum-based tasks, grading, and feedback.

**Architecture:** The app is a React + Vite single-page application. It does not start real Kubernetes, SSH, containers, or servers; it simulates a shell, filesystem, `kubectl`, and cluster state in client-side JavaScript. Feature slices communicate through plain data contracts so workers can implement independently.

**Tech Stack:** React, Vite, JavaScript modules, CSS, local in-memory state, Vitest.

---

## Public Contracts

### `src/simulator/createLabSession.js`

Exports:

```js
export function createLabSession({ questions, initialCluster }) {
  return {
    getSnapshot,
    runCommand,
    resetQuestion,
    activeQuestionId: questions[0]?.id ?? null,
  };
}
```

`runCommand(input: string)` returns:

```js
{
  command: string,
  output: string,
  cwd: string,
  prompt: string,
  cluster: object,
  files: object,
}
```

### `src/scoring/grader.js`

Exports:

```js
export function gradeQuestion(question, snapshot) {
  return {
    passed: boolean,
    score: number,
    checks: [{ id, label, passed, detail }],
    feedback: string,
  };
}
```

### `src/data/questions.js`

Exports:

```js
export const examDomains = [
  { name: "Storage", weight: 10 },
  { name: "Troubleshooting", weight: 30 },
  { name: "Workloads & Scheduling", weight: 15 },
  { name: "Cluster Architecture, Installation & Configuration", weight: 25 },
  { name: "Services & Networking", weight: 20 },
];

export const questions = [
  {
    id,
    title,
    domain,
    weight,
    prompt,
    namespace,
    startingFiles,
    checks,
    hints,
  },
];
```

---

## Worker Ownership

### Task 1: Frontend Shell

**Files:**
- Create/modify: `src/App.jsx`
- Create/modify: `src/styles.css`
- Create/modify: `src/main.jsx`
- Read only: public contracts above

- [ ] Build an app shell with a top exam bar, left question navigator, central terminal, and right feedback panel.
- [ ] Keep controls real: selected task, run grading, reset task, show hints, command history.
- [ ] Do not implement simulation logic in UI files. Call `createLabSession()` and `gradeQuestion()`.

### Task 2: Virtual Backend / Command Runtime

**Files:**
- Create/modify: `src/simulator/createLabSession.js`
- Create/modify: `src/simulator/shell.js`
- Create/modify: `src/simulator/filesystem.js`

- [ ] Implement `help`, `clear`, `pwd`, `ls`, `cd`, `cat`, `echo`, `touch`, `mkdir`, `rm`, `nano`, `vim`, and `vi` text-mode approximations.
- [ ] Support heredoc writes like `cat <<EOF > file.yaml ... EOF`.
- [ ] Route `kubectl` commands to `src/simulator/kubectl.js`.

### Task 3: Kubernetes Environment

**Files:**
- Create/modify: `src/simulator/clusterState.js`
- Create/modify: `src/simulator/kubectl.js`

- [ ] Model namespaces, pods, deployments, services, ingresses, storageclasses, pvcs, configmaps, secrets, nodes, roles, rolebindings, and networkpolicies.
- [ ] Implement practical `kubectl` subset: `get`, `describe`, `create`, `run`, `apply -f`, `delete`, `scale`, `set image`, `rollout status`, `logs`, `top nodes`, `cordon`, `uncordon`, `drain`, and `config use-context`.
- [ ] YAML parsing may be intentionally small but must handle the provided manifests.

### Task 4: 2026 Curriculum-Based Problem Set

**Files:**
- Create/modify: `src/data/questions.js`
- Create/modify: `docs/cka-curriculum-notes.md`

- [ ] Create 17 original CKA-style practice tasks aligned to the public curriculum weights.
- [ ] Avoid copying real exam questions or brand UI.
- [ ] Include common 2026-era Kubernetes admin topics: troubleshooting, Gateway/Ingress basics, NetworkPolicy, storage, RBAC, node maintenance, rollout repair, probes, resource requests, config, and scheduling.

### Task 5: Grading and Feedback

**Files:**
- Create/modify: `src/scoring/grader.js`

- [ ] Evaluate each question's `checks` against the current snapshot.
- [ ] Return actionable Korean feedback with pass/fail checks.
- [ ] Keep grading deterministic and local.

### Task 6: Integration and Verification

**Files:**
- Create/modify: `package.json`
- Create/modify: `index.html`
- Create/modify: `vite.config.js`
- Create/modify: `src/**/*.test.js`

- [ ] Add Vite, React, Vitest, and scripts.
- [ ] Add tests for command execution, `kubectl apply`, question grading, and at least one full task path.
- [ ] Run `npm install`, `npm test`, and `npm run build`.
