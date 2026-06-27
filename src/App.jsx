import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Gauge,
  Lightbulb,
  Play,
  RotateCcw,
  Terminal,
  TimerReset,
} from "lucide-react";
import { questions, examDomains } from "./data/questions.js";
import { createLabSession } from "./simulator/createLabSession.js";
import { createInitialCluster } from "./simulator/clusterState.js";
import { getCdCompletions } from "./simulator/completion.js";
import { gradeQuestion } from "./scoring/grader.js";

function createSession() {
  return createLabSession({ questions, initialCluster: createInitialCluster(questions) });
}

function splitSubmittedCommands(rawInput) {
  const trimmedInput = rawInput.trimEnd();
  if (!trimmedInput.trim()) return [];

  const lines = trimmedInput.split("\n");
  const commands = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heredoc = line.match(/^cat\s+<<(\w+)\s+>\s+.+/);

    if (!heredoc) {
      if (line.trim()) commands.push(line.trim());
      continue;
    }

    const delimiter = heredoc[1];
    const block = [line];

    while (index + 1 < lines.length) {
      index += 1;
      block.push(lines[index]);
      if (lines[index].trim() === delimiter) break;
    }

    commands.push(block.join("\n"));
  }

  return commands;
}

function statusFor(question, grade, attemptedIds) {
  if (grade?.passed) return { key: "passed", label: "Solved" };
  if (attemptedIds.has(question.id)) return { key: "working", label: "Working" };
  return { key: "ready", label: "Ready" };
}

function scoreForDomain(domainName, gradedQuestions) {
  return gradedQuestions.reduce(
    (result, item) => {
      if (item.question.domain !== domainName) return result;
      return {
        total: result.total + 1,
        passed: result.passed + (item.grade.passed ? 1 : 0),
      };
    },
    { total: 0, passed: 0 },
  );
}

export default function App() {
  const [session, setSession] = useState(() => createSession());
  const [activeId, setActiveId] = useState(questions[0]?.id ?? null);
  const [history, setHistory] = useState(() => []);
  const [input, setInput] = useState("");
  const [snapshot, setSnapshot] = useState(() => session.getSnapshot());
  const [showHints, setShowHints] = useState(false);
  const [attemptedIds, setAttemptedIds] = useState(() => new Set());
  const [completionIndex, setCompletionIndex] = useState(0);
  const [shouldAutoFocusTerminal] = useState(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 881px)").matches,
  );
  const terminalOutputRef = useRef(null);

  const activeQuestion = questions.find((question) => question.id === activeId) ?? questions[0] ?? null;
  const activeIndex = activeQuestion
    ? questions.findIndex((question) => question.id === activeQuestion.id)
    : -1;

  const gradedQuestions = useMemo(
    () => questions.map((question) => ({ question, grade: gradeQuestion(question, snapshot) })),
    [snapshot],
  );
  const gradeById = useMemo(
    () => new Map(gradedQuestions.map((item) => [item.question.id, item.grade])),
    [gradedQuestions],
  );
  const activeGrade = activeQuestion ? gradeById.get(activeQuestion.id) : null;
  const activeStatus = activeQuestion
    ? statusFor(activeQuestion, activeGrade, attemptedIds)
    : { key: "empty", label: "No task" };
  const completed = gradedQuestions.filter((item) => item.grade.passed).length;
  const completionPercent = questions.length ? Math.round((completed / questions.length) * 100) : 0;
  const commandCount = history.filter((entry) => entry.command && !entry.command.startsWith("#")).length;
  const isEditorActive = Boolean(snapshot.editor);
  const isEditorInsert = snapshot.editor?.mode === "insert";
  const completions = useMemo(
    () => (isEditorActive ? [] : getCdCompletions(input, { files: snapshot.files, cwd: snapshot.cwd })),
    [input, isEditorActive, snapshot.cwd, snapshot.files],
  );
  const inputRows = isEditorInsert
    ? Math.min(Math.max(input.split("\n").length, 5), 14)
    : Math.min(Math.max(input.split("\n").length, 1), 8);

  useEffect(() => {
    const output = terminalOutputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [history]);

  useEffect(() => {
    setCompletionIndex(0);
  }, [input, completions.length]);

  function applyCompletion(completion = completions[completionIndex]) {
    if (!completion) return;
    setInput(completion.replacement);
  }

  function runCommands(commands, labels = commands) {
    if (!commands.length) return;

    const entries = [];
    let nextSnapshot = snapshot;

    for (const [index, command] of commands.entries()) {
      const wasEditorActive = Boolean(nextSnapshot.editor);
      const result = session.runCommand(command);
      entries.push({
        command: labels[index] ?? command,
        output: result.output,
        prompt: nextSnapshot.prompt,
        clear: !wasEditorActive && command === "clear",
      });
      nextSnapshot = session.getSnapshot();
    }

    setSnapshot(nextSnapshot);
    setHistory((items) => {
      let nextItems = [...items];
      for (const entry of entries) {
        nextItems = entry.clear ? [] : [...nextItems, entry];
      }
      return nextItems;
    });
    setInput("");

    if (activeQuestion) {
      setAttemptedIds((ids) => {
        const next = new Set(ids);
        next.add(activeQuestion.id);
        return next;
      });
    }
  }

  function submitCommand(event) {
    event.preventDefault();
    const commands = isEditorActive ? [input] : splitSubmittedCommands(input);
    if (!commands.length || (isEditorInsert && input.length === 0)) return;
    runCommands(commands);
  }

  function handleCommandKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (!isEditorActive && completions.length && event.key === "Tab") {
      event.preventDefault();
      applyCompletion();
      return;
    }
    if (!isEditorActive && completions.length && event.key === "ArrowDown") {
      event.preventDefault();
      setCompletionIndex((index) => (index + 1) % completions.length);
      return;
    }
    if (!isEditorActive && completions.length && event.key === "ArrowUp") {
      event.preventDefault();
      setCompletionIndex((index) => (index - 1 + completions.length) % completions.length);
      return;
    }
    if (isEditorInsert && event.key === "Escape") {
      event.preventDefault();
      runCommands(["\u001b"], ["Esc"]);
      return;
    }
    if (isEditorInsert) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function resetCurrentQuestion() {
    if (!activeQuestion) return;

    session.resetQuestion(activeQuestion.id);
    const nextSnapshot = session.getSnapshot();
    setSnapshot(nextSnapshot);
    setAttemptedIds((ids) => {
      const next = new Set(ids);
      next.delete(activeQuestion.id);
      return next;
    });
    setHistory((items) => [
      ...items,
      {
        command: "# reset task",
        output: `${activeQuestion.title} 상태를 초기화했습니다.`,
        prompt: nextSnapshot.prompt,
      },
    ]);
  }

  function resetLab() {
    const nextSession = createSession();
    setSession(nextSession);
    setSnapshot(nextSession.getSnapshot());
    setHistory([]);
    setInput("");
    setShowHints(false);
    setAttemptedIds(new Set());
  }

  return (
    <main className="app-shell">
      <header className="exam-bar">
        <div className="brand-lockup">
          <span className="brand-icon" aria-hidden="true">
            <Terminal size={22} />
          </span>
          <div>
            <strong>CKA Virtual Lab</strong>
            <span>client-side Kubernetes simulator</span>
          </div>
        </div>

        <div className="exam-status" aria-label="시험 상태">
          <span className="status-pill">
            <TimerReset size={16} />
            <strong>02:00:00</strong>
            <small>Practice clock</small>
          </span>
          <span className="status-pill wide">
            <Terminal size={16} />
            <strong>{snapshot.context}</strong>
            <small>{snapshot.cwd}</small>
          </span>
          <span className="status-pill">
            <CheckCircle2 size={16} />
            <strong>
              {completed}/{questions.length}
            </strong>
            <small>{completionPercent}% solved</small>
          </span>
          <button className="top-action" type="button" onClick={resetLab}>
            <RotateCcw size={16} />
            Reset test
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="question-rail" aria-label="문제 목록">
          <div className="rail-header">
            <div>
              <span className="section-kicker">
                <ClipboardCheck size={15} />
                Tasks
              </span>
              <strong>
                {completed}/{questions.length} complete
              </strong>
            </div>
            <div className="overall-progress" aria-label={`전체 진행률 ${completionPercent}%`}>
              <span style={{ width: `${completionPercent}%` }} />
            </div>
          </div>

          <div className="domain-strip">
            {examDomains.map((domain) => {
              const domainScore = scoreForDomain(domain.name, gradedQuestions);
              return (
                <div key={domain.name}>
                  <span>{domain.name}</span>
                  <strong>
                    {domainScore.passed}/{domainScore.total} · {domain.weight}%
                  </strong>
                </div>
              );
            })}
          </div>

          <div className="question-list">
            {questions.length ? (
              questions.map((question, index) => {
                const itemGrade = gradeById.get(question.id);
                const itemStatus = statusFor(question, itemGrade, attemptedIds);
                const isActive = question.id === activeQuestion?.id;

                return (
                  <button
                    key={question.id}
                    className={`question-button ${isActive ? "active" : ""} ${itemStatus.key}`}
                    onClick={() => {
                      setActiveId(question.id);
                      setShowHints(false);
                    }}
                    aria-current={isActive ? "true" : undefined}
                    type="button"
                  >
                    <span className="task-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="task-copy">
                      <strong>{question.title}</strong>
                      <small>{question.domain}</small>
                    </span>
                    <span className="task-state" aria-label={itemStatus.label}>
                      {itemGrade?.passed ? <CheckCircle2 size={17} /> : <Circle size={15} />}
                    </span>
                    <span className="task-progress">
                      <span style={{ width: `${itemGrade?.score ?? 0}%` }} />
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="empty-panel compact">
                <AlertCircle size={18} />
                <strong>No tasks loaded</strong>
                <p>Question set is empty.</p>
              </div>
            )}
          </div>
        </aside>

        <section className="lab-panel">
          <article className="task-card">
            {activeQuestion ? (
              <>
                <div className="task-heading">
                  <span className="section-kicker">
                    Question {activeIndex + 1} · {activeQuestion.domain}
                  </span>
                  <h1>{activeQuestion.title}</h1>
                </div>
                <span className={`task-badge ${activeStatus.key}`}>{activeStatus.label}</span>
                <p className="task-prompt">{activeQuestion.prompt}</p>
                <div className="task-actions">
                  <button
                    type="button"
                    className={showHints ? "active" : ""}
                    onClick={() => setShowHints((value) => !value)}
                    aria-pressed={showHints}
                  >
                    <Lightbulb size={16} />
                    Hints
                  </button>
                  <button type="button" onClick={resetCurrentQuestion}>
                    <RotateCcw size={16} />
                    Reset task
                  </button>
                </div>
                {showHints ? (
                  <ul className="hint-list">
                    {(activeQuestion.hints ?? []).map((hint) => (
                      <li key={hint}>{hint}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className="empty-panel task-empty">
                <AlertCircle size={20} />
                <strong>No active task</strong>
                <p>Load questions to start a practice session.</p>
              </div>
            )}
          </article>

          <article className="terminal-panel">
            <div className="terminal-title">
              <div className="terminal-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <strong>sim-terminal</strong>
              <span className="terminal-context">{snapshot.context}</span>
            </div>
            <div className="terminal-output" role="log" aria-live="polite" ref={terminalOutputRef}>
              {history.map((entry, index) => (
                <div key={`${entry.command}-${index}`} className="terminal-entry">
                  {entry.command ? (
                    <div className="prompt-line">
                      <span>{entry.prompt}</span>
                      <code>{entry.command}</code>
                    </div>
                  ) : null}
                  {entry.output ? <pre>{entry.output}</pre> : null}
                </div>
              ))}
              {completions.length ? (
                <div className="completion-menu" role="listbox" aria-label="cd 자동완성 후보">
                  {completions.map((completion, index) => (
                    <button
                      key={completion.replacement}
                      type="button"
                      className={index === completionIndex ? "active" : ""}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyCompletion(completion);
                      }}
                    >
                      {completion.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <form
                className={`command-line ${isEditorActive ? "editor-mode" : ""} ${isEditorInsert ? "insert-mode" : ""}`}
                onSubmit={submitCommand}
              >
                <span>{snapshot.prompt}</span>
                <textarea
                  value={input}
                  rows={inputRows}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleCommandKeyDown}
                  autoFocus={shouldAutoFocusTerminal}
                  spellCheck={false}
                  aria-label="터미널 명령 입력"
                  placeholder={isEditorInsert ? "" : "kubectl get pods -A"}
                />
                <button type="submit" aria-label="명령 실행" title="Run command">
                  <Play size={15} />
                </button>
              </form>
            </div>
          </article>
        </section>

        <aside className="feedback-panel" aria-label="채점 피드백">
          <div className="feedback-header">
            <span className="section-kicker">
              <Gauge size={15} />
              Grading
            </span>
            <strong>{activeQuestion ? activeQuestion.title : "No task"}</strong>
          </div>

          {activeGrade ? (
            <>
              <div className={`score-card ${activeGrade.passed ? "passed" : ""}`}>
                <div className="score-heading">
                  <span>Score</span>
                  <strong>{activeGrade.score}%</strong>
                </div>
                <div className="score-meter" aria-label={`현재 점수 ${activeGrade.score}%`}>
                  <span style={{ width: `${activeGrade.score}%` }} />
                </div>
                <p>{activeGrade.feedback}</p>
              </div>

              <div className="check-list">
                {activeGrade.checks.length ? (
                  activeGrade.checks.map((check) => (
                    <div key={check.id} className={check.passed ? "check pass" : "check"}>
                      <span>{check.passed ? "PASS" : "MISS"}</span>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                    </div>
                  ))
                ) : (
                  <div className="empty-panel compact">
                    <AlertCircle size={18} />
                    <strong>No checks loaded</strong>
                    <p>This task has no grading criteria.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-panel">
              <AlertCircle size={20} />
              <strong>No grading target</strong>
              <p>Select a task to view live checks.</p>
            </div>
          )}

          <div className="session-card">
            <span className="section-kicker">Session</span>
            <dl>
              <div>
                <dt>Context</dt>
                <dd>{snapshot.context}</dd>
              </div>
              <div>
                <dt>Working dir</dt>
                <dd>{snapshot.cwd}</dd>
              </div>
              <div>
                <dt>Commands</dt>
                <dd>{commandCount}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </section>
    </main>
  );
}
