# CKA Virtual Lab

Browser-only Kubernetes administration practice lab inspired by the public CKA curriculum.

This project simulates a terminal, filesystem, `kubectl`, Kubernetes resources, task grading, and Korean feedback entirely in the browser. It does not start a real Kubernetes cluster, SSH server, VM, or container.

## Features

- CKA-style workstation UI with task list, terminal, timer area, and grading panel
- Virtual shell commands such as `pwd`, `ls`, `cat`, `echo`, heredoc writes, `mkdir`, `rm`, `systemctl`, and `journalctl`
- Simulated `kubectl` support for common admin workflows
- 17 original practice tasks aligned to public curriculum domains
- Deterministic local grading with per-check feedback
- Responsive desktop and mobile layout

## Run Locally

```bash
npm install
npm run dev
```

Open http://localhost:5173/.

## Verify

```bash
npm test
npm run build
npm audit
```

## Note

The tasks are original simulator-friendly exercises based on public curriculum domains. They are not real CKA exam questions and do not copy real exam items or exam UI.
