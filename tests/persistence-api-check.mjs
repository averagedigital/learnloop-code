import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const nodeBin = process.execPath;
const port = 49173;
const modelPort = 49174;
const graphPort = 49175;
const agentPort = 49176;
const judgePort = 49177;
const graphFact = "Graph retrieval remembers missing-flag order";
const tmp = await mkdtemp(join(tmpdir(), "codelearn-db-"));
const dbPath = join(tmp, "app.sqlite");
const envPath = join(tmp, ".env");
const workspaceRoot = join(tmp, "workspace");
const fakeBin = join(tmp, "bin");
const dockerCallLog = join(tmp, "docker-call.log");
let modelServer;
let graphServer;
let agentServer;
let judgeServer;
const graphEvents = [];
const graphSearches = [];
const agentCommands = [];
const judgeSubmissions = [];

try {
  await mkdir(fakeBin, { recursive: true });
  const fakeDocker = join(fakeBin, "docker");
  await writeFile(fakeDocker, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$DOCKER_CALL_LOG\"\n", "utf8");
  await chmod(fakeDocker, 0o700);
  modelServer = await startModelServer(modelPort);
  graphServer = await startGraphServer(graphPort, graphEvents, graphSearches);
  agentServer = await startAgentServer(agentPort, agentCommands);
  judgeServer = await startJudgeServer(judgePort, judgeSubmissions);
  let server = await startServer({ seed: "true", dbPath, port });
  let state = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);

  assert.equal(state.lesson.title, "Мини-практика по признакам в pandas");
  assert.equal(state.tasks.length, 4);
  assert.match(state.tasks[0].createdAt, /^\d{4}-\d{2}-\d{2}/);
  assert.equal(state.taskLogs.length, 4);
  assert.equal(state.taskLogs[0].label, "Задание 1 в работе");
  assert.equal(state.taskLogs[2].label, "Задание 3 в журнале");
  assert.equal(state.activity, undefined);
  assert.deepEqual(state.memory, []);
  assert.deepEqual(state.skillGraph, []);
  assert.equal(state.providerStatus.openai.configured, false);
  assert.equal(state.settings.workspaceRuntime, "code-server");
  assert.equal(state.settings.workspaceRuntimeUrl, `http://127.0.0.1:${agentPort}`);
  assert.equal(state.settings.agentRuntimeUrl, `http://127.0.0.1:${agentPort}`);
  assert.equal(state.settings.graphMemoryUrl, `http://127.0.0.1:${graphPort}`);
  const initialRuntimeHealth = await fetchJson(`http://127.0.0.1:${port}/api/runtime/health`);
  assert.equal(initialRuntimeHealth.workspace.ok, true);
  assert.equal(initialRuntimeHealth.agent.ok, true);
  assert.equal(initialRuntimeHealth.graph.ok, true);
  const hugePersonality = await fetch(`http://127.0.0.1:${port}/api/personality`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markdown: "x".repeat(100001) })
  });
  assert.equal(hugePersonality.status, 413);
  assert.equal((await hugePersonality.json()).error, "personality_too_large");
  const invalidPersonalityMarkdown = await fetch(`http://127.0.0.1:${port}/api/personality`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markdown: { bad: true } })
  });
  assert.equal(invalidPersonalityMarkdown.status, 400);
  assert.equal((await invalidPersonalityMarkdown.json()).error, "invalid_personality_markdown");
  const invalidPersonalityDelete = await fetch(`http://127.0.0.1:${port}/api/personality`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lines: [0, -1, "bad"] })
  });
  assert.equal(invalidPersonalityDelete.status, 400);
  assert.equal((await invalidPersonalityDelete.json()).error, "invalid_personality_lines");

  const taskId = state.lesson.tasks[0].id;
  const staticEnv = await fetch(`http://127.0.0.1:${port}/.env`);
  assert.equal(staticEnv.status, 403);
  assert.equal((await staticEnv.json()).error, "forbidden_static_path");
  const staticDb = await fetch(`http://127.0.0.1:${port}/data/codelearn.sqlite`);
  assert.equal(staticDb.status, 403);
  assert.equal((await staticDb.json()).error, "forbidden_static_path");
  const missingApi = await fetch(`http://127.0.0.1:${port}/api/missing-route`);
  assert.equal(missingApi.status, 404);
  assert.equal((await missingApi.json()).error, "api_not_found");
  const missingStatic = await fetch(`http://127.0.0.1:${port}/assets/missing.js`);
  assert.equal(missingStatic.status, 404);
  assert.equal((await missingStatic.json()).error, "not_found");
  const taskLog = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/log`);
  assert.equal(taskLog.task.id, taskId);
  assert.match(taskLog.assignedMarkdown, /# /);
  assert.equal(taskLog.userCode, state.lesson.tasks[0].starterCode);
  const workspaceFiles = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/files`);
  assert.deepEqual(workspaceFiles.files.map((file) => file.name), ["checks.json", "solution.py", "task.md"]);
  assert.equal(workspaceFiles.files.every((file) => !file.path.includes("..")), true);
  assert.match(await readFile(join(workspaceRoot, taskId, "task.md"), "utf8"), /Заполнить пропуски возраста/);
  const workspaceTask = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/files/task.md`);
  assert.equal(workspaceTask.name, "task.md");
  assert.equal(workspaceTask.path, `${taskId}/task.md`);
  assert.match(workspaceTask.content, /Заполнить пропуски возраста/);
  const traversalResponse = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/files/${encodeURIComponent("../.env")}`);
  assert.equal(traversalResponse.status, 403);
  assert.equal((await traversalResponse.json()).error, "workspace_path_escape");
  const executed = await fetchJson(`http://127.0.0.1:${port}/api/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source_code: "answer = 2 + 2",
      public_checks: [{ kind: "python_assert", message: "арифметика работает", code: "assert answer == 4" }],
      cpu_time_sec: 3,
      memory_mb: 128
    })
  });
  assert.equal(executed.status, "passed");
  assert.equal(executed.public_test_results.every((check) => check.passed), true);
  assert.equal(judgeSubmissions.length, 1);
  assert.equal(judgeSubmissions[0].language_id, 71);
  assert.match(judgeSubmissions[0].source_code, /answer = 2 \+ 2/);
  assert.match(judgeSubmissions[0].source_code, /assert answer == 4/);
  assert.equal(judgeSubmissions[0].cpu_time_limit, 3);
  assert.equal(judgeSubmissions[0].memory_limit, 131072);
  assert.equal(judgeSubmissions[0].enable_network, false);
  const invalidPublicChecks = await fetch(`http://127.0.0.1:${port}/api/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source_code: "answer = 1", public_checks: "bad" })
  });
  assert.equal(invalidPublicChecks.status, 400);
  assert.equal((await invalidPublicChecks.json()).error, "invalid_public_checks");
  const tooManyPublicChecks = await fetch(`http://127.0.0.1:${port}/api/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source_code: "answer = 1", public_checks: Array.from({ length: 51 }, () => ({ code: "assert answer == 1" })) })
  });
  assert.equal(tooManyPublicChecks.status, 413);
  assert.equal((await tooManyPublicChecks.json()).error, "public_checks_too_large");
  const hugePublicCheck = await fetch(`http://127.0.0.1:${port}/api/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source_code: "answer = 1", public_checks: [{ code: "x".repeat(4001) }] })
  });
  assert.equal(hugePublicCheck.status, 413);
  assert.equal((await hugePublicCheck.json()).error, "public_checks_too_large");

  await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/progress`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "print('persisted')", hintIndex: 2 })
  });
  assert.equal(await readFile(join(workspaceRoot, taskId, "solution.py"), "utf8"), "print('persisted')");
  const invalidProgressCode = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/progress`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: { bad: true } })
  });
  assert.equal(invalidProgressCode.status, 400);
  assert.equal((await invalidProgressCode.json()).error, "invalid_progress_code");
  assert.equal(await readFile(join(workspaceRoot, taskId, "solution.py"), "utf8"), "print('persisted')");
  const solutionWrite = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("solution.py")}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "print('from workspace')" })
  });
  assert.equal(solutionWrite.ok, true);
  await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files`);
  assert.equal(await readFile(join(workspaceRoot, taskId, "solution.py"), "utf8"), "print('from workspace')");
  const agentWrite = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("notes/result.txt")}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "agent note" })
  });
  assert.equal(agentWrite.ok, true);
  let fileSaveLog = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/log`);
  assert.ok(fileSaveLog.agentEvents.some((event) => event.type === "workspace_file_saved" && event.payload.name === "notes/result.txt"));
  const agentRead = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("notes/result.txt")}`);
  assert.equal(agentRead.content, "agent note");
  const invalidAgentFileContent = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("notes/bad.txt")}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: { bad: true } })
  });
  assert.equal(invalidAgentFileContent.status, 400);
  assert.equal((await invalidAgentFileContent.json()).error, "invalid_agent_file_content");
  await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("task.md")}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "# Edited task\n" })
  });
  await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files`);
  assert.equal(await readFile(join(workspaceRoot, taskId, "task.md"), "utf8"), "# Edited task\n");
  const missingAgentFile = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("notes/missing.txt")}`);
  assert.equal(missingAgentFile.status, 404);
  assert.equal((await missingAgentFile.json()).error, "workspace_file_not_found");
  const missingNestedAgentFile = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("missing-dir/missing.txt")}`);
  assert.equal(missingNestedAgentFile.status, 404);
  assert.equal((await missingNestedAgentFile.json()).error, "workspace_file_not_found");
  const agentFiles = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files`);
  assert.equal(agentFiles.files.includes("notes/result.txt"), true);
  const agentTraversal = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("../outside.txt")}`);
  assert.equal(agentTraversal.status, 403);
  assert.equal((await agentTraversal.json()).error, "workspace_path_escape");
  const outsideFile = join(tmp, "outside.txt");
  await writeFile(outsideFile, "outside", "utf8");
  await symlink(outsideFile, join(workspaceRoot, taskId, "notes/link.txt"));
  const symlinkWrite = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/files/${encodeURIComponent("notes/link.txt")}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "escaped" })
  });
  assert.equal(symlinkWrite.status, 403);
  assert.equal((await symlinkWrite.json()).error, "workspace_path_escape");
  assert.equal(await readFile(outsideFile, "utf8"), "outside");
  const agentRun = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: ["python3", "solution.py"] })
  });
  assert.equal(agentRun.result.status, "queued");
  assert.equal(agentCommands[0].cwd, `/workspaces/${taskId}`);
  assert.deepEqual(agentCommands[0].command, ["python3", "solution.py"]);
  let agentRunLog = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/log`);
  const queuedAgentCommand = agentRunLog.agentEvents.find((event) => event.type === "agent_command");
  assert.deepEqual(queuedAgentCommand.payload.command, ["python3", "solution.py"]);
  assert.equal(queuedAgentCommand.payload.resultStatus, "queued");
  const tooLongAgentCommand = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: ["python3", "x".repeat(201)] })
  });
  assert.equal(tooLongAgentCommand.status, 400);
  assert.equal((await tooLongAgentCommand.json()).error, "agent_command_too_long");
  const objectAgentCommand = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: ["python3", { bad: true }] })
  });
  assert.equal(objectAgentCommand.status, 400);
  assert.equal((await objectAgentCommand.json()).error, "invalid_agent_command");
  const invalidAgentRuntimeSetting = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentRuntimeUrl: "file:///tmp/agent" })
  });
  assert.equal(invalidAgentRuntimeSetting.status, 400);
  assert.equal((await invalidAgentRuntimeSetting.json()).error, "invalid_agent_runtime_url");
  await fetchJson(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentRuntimeUrl: "http://127.0.0.1:9" })
  });
  const unreachableAgentRun = await fetch(`http://127.0.0.1:${port}/api/workspace/tasks/${taskId}/agent/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: ["python3", "solution.py"] })
  });
  assert.equal(unreachableAgentRun.status, 502);
  assert.equal((await unreachableAgentRun.json()).error, "agent_runtime_unreachable");
  agentRunLog = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/log`);
  assert.equal(agentRunLog.agentEvents.at(-1).type, "agent_command_failed");
  assert.deepEqual(agentRunLog.agentEvents.at(-1).payload.command, ["python3", "solution.py"]);
  await fetchJson(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentRuntimeUrl: `http://127.0.0.1:${agentPort}` })
  });
  const invalidRuntimeHealth = await fetchJson(`http://127.0.0.1:${port}/api/runtime/health`);
  assert.equal(invalidRuntimeHealth.agent.ok, true);
  const invalidLesson = await fetch(`http://127.0.0.1:${port}/api/lessons`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lesson: { title: "broken" } })
  });
  assert.equal(invalidLesson.status, 400);
  assert.equal((await invalidLesson.json()).error, "invalid_lesson_spec");
  const tooManyTasksLesson = await fetch(`http://127.0.0.1:${port}/api/lessons`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lesson: {
        title: "Too many tasks",
        topic: "limits",
        level: "easy",
        objective: "Проверить лимиты.",
        tasks: Array.from({ length: 21 }, (_, index) => ({
          id: `task-${index}`,
          title: "Task",
          prompt: "Do it",
          starterCode: "print('x')",
          hiddenSummary: "Risk",
          publicChecks: [{ kind: "python_assert", message: "ok", code: "assert True" }],
          hints: ["hint"]
        }))
      }
    })
  });
  assert.equal(tooManyTasksLesson.status, 400);
  assert.match(JSON.stringify(await tooManyTasksLesson.json()), /tasks must not exceed 20/);
  const oversizedCheckLesson = await fetch(`http://127.0.0.1:${port}/api/lessons`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lesson: {
        title: "Huge check",
        topic: "limits",
        level: "easy",
        objective: "Проверить лимиты.",
        tasks: [{
          id: "huge-check",
          title: "Task",
          prompt: "Do it",
          starterCode: "print('x')",
          hiddenSummary: "Risk",
          publicChecks: [{ kind: "python_assert", message: "ok", code: "x".repeat(4001) }],
          hints: ["hint"]
        }]
      }
    })
  });
  assert.equal(oversizedCheckLesson.status, 400);
  assert.match(JSON.stringify(await oversizedCheckLesson.json()), /publicChecks.code is too large/);
  const invalidFileLesson = await fetch(`http://127.0.0.1:${port}/api/lessons`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lesson: {
        title: "Bad files",
        topic: "CLI",
        level: "легкий",
        objective: "Проверить unsafe path.",
        tasks: [{
          id: "bad-file",
          title: "Bad",
          prompt: "Bad",
          starterCode: "print('x')",
          hiddenSummary: "Bad",
          publicChecks: [{ kind: "python_assert", message: "ok", code: "assert True" }],
          hints: ["нет"],
          files: [{ path: "../secret.txt", content: "no" }]
        }]
      }
    })
  });
  assert.equal(invalidFileLesson.status, 400);
  assert.match(JSON.stringify(await invalidFileLesson.json()), /safe relative path/);
  const reservedFileLesson = await fetch(`http://127.0.0.1:${port}/api/lessons`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lesson: {
        title: "Reserved file",
        topic: "workspace",
        level: "easy",
        objective: "Проверить reserved path.",
        tasks: [{
          id: "reserved-file",
          title: "Reserved",
          prompt: "Reserved",
          starterCode: "print('x')",
          hiddenSummary: "Reserved",
          publicChecks: [{ kind: "python_assert", message: "ok", code: "assert True" }],
          hints: ["нет"],
          files: [{ path: "solution.py", content: "override" }]
        }]
      }
    })
  });
  assert.equal(reservedFileLesson.status, 400);
  assert.match(JSON.stringify(await reservedFileLesson.json()), /must not replace workspace system files/);
  const largeFileLesson = await fetch(`http://127.0.0.1:${port}/api/lessons`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lesson: {
        title: "Large file",
        topic: "workspace",
        level: "easy",
        objective: "Проверить file size.",
        tasks: [{
          id: "large-file",
          title: "Large",
          prompt: "Large",
          starterCode: "print('x')",
          hiddenSummary: "Large",
          publicChecks: [{ kind: "python_assert", message: "ok", code: "assert True" }],
          hints: ["нет"],
          files: [{ path: "notes.txt", content: "x".repeat(200001) }]
        }]
      }
    })
  });
  assert.equal(largeFileLesson.status, 400);
  assert.match(JSON.stringify(await largeFileLesson.json()), /files.content is too large/);
  const importedLesson = await fetchJson(`http://127.0.0.1:${port}/api/lessons`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourcePrompt: "Сделай CLI задачу",
      llmAnswer: '## ТЗ\n```json\n{"title":"Импортированное ТЗ"}\n```',
      lesson: {
        title: "Импортированное ТЗ",
        topic: "CLI",
        level: "легкий",
        objective: "Собрать проверяемый CLI скрипт.",
        tasks: [{
          id: "cli-task",
          title: "Сделать CLI",
          prompt: "Напишите скрипт, который печатает ok.",
          starterCode: "print('todo')",
          hiddenSummary: "Проверяется stdout.",
          publicChecks: [{ kind: "python_assert", message: "Скрипт запускается", code: "assert True" }],
          hints: ["Начните с print."],
          files: [
            { path: "README.md", content: "# CLI task\n" },
            { path: "config/settings.json", content: "{\"mode\":\"test\"}\n" }
          ]
        }]
      }
    })
  });
  assert.equal(importedLesson.lesson.title, "Импортированное ТЗ");
  assert.equal(importedLesson.lesson.tasks.length, 1);
  assert.match(importedLesson.lesson.tasks[0].id, /cli-task-/);
  assert.match(await readFile(join(workspaceRoot, importedLesson.lesson.tasks[0].id, "task.md"), "utf8"), /Сделать CLI/);
  assert.match(await readFile(join(workspaceRoot, importedLesson.lesson.tasks[0].id, "README.md"), "utf8"), /CLI task/);
  assert.match(await readFile(join(workspaceRoot, importedLesson.lesson.tasks[0].id, "config/settings.json"), "utf8"), /test/);
  const importedWorkspaceFiles = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${importedLesson.lesson.tasks[0].id}/files`);
  assert.deepEqual(importedWorkspaceFiles.files.map((file) => file.name).sort(), ["README.md", "checks.json", "config/settings.json", "solution.py", "task.md"]);
  const importedReadme = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${importedLesson.lesson.tasks[0].id}/files/${encodeURIComponent("README.md")}`);
  assert.equal(importedReadme.content, "# CLI task\n");
  const importedConfig = await fetchJson(`http://127.0.0.1:${port}/api/workspace/tasks/${importedLesson.lesson.tasks[0].id}/files/${encodeURIComponent("config/settings.json")}`);
  assert.equal(importedConfig.content, "{\"mode\":\"test\"}\n");
  const importedLog = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${importedLesson.lesson.tasks[0].id}/log`);
  assert.equal(importedLog.messages[0].content, "Сделай CLI задачу");
  assert.match(importedLog.llmAnswer, /Импортированное ТЗ/);
  state = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  const studioImportEvent = state.memoryReviewQueue.find((event) => event.source === "studio_import");
  assert.equal(studioImportEvent.kind, "project_reference");
  assert.match(studioImportEvent.text, /Импортированное ТЗ/);
  assert.equal(studioImportEvent.evidence.lessonId, importedLesson.lesson.id);
  assert.deepEqual(studioImportEvent.evidence.taskIds, [importedLesson.lesson.tasks[0].id]);
  const run = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "passed",
      finalResult: "Проверки прошли",
      messages: [
        { role: "user", content: "Почему тест падал?" },
        { role: "assistant", content: "Флаг нужно считать до заполнения." }
      ],
      agentEvents: [{ type: "check", payload: { command: "pytest", status: "passed" } }]
    })
  });
  assert.equal(run.run.status, "passed");
  const updatedTaskLog = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/log`);
  assert.equal(updatedTaskLog.finalResult, "Проверки прошли");
  assert.deepEqual(updatedTaskLog.messages.map((message) => message.role), ["user", "assistant"]);
  assert.ok(updatedTaskLog.agentEvents.some((event) => event.type === "check"));
  const invalidRunMessageRole = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "developer", content: "no" }] })
  });
  assert.equal(invalidRunMessageRole.status, 400);
  assert.equal((await invalidRunMessageRole.json()).error, "invalid_run_message_role");
  const invalidRunAgentEvent = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentEvents: [{ type: "check", payload: [] }] })
  });
  assert.equal(invalidRunAgentEvent.status, 400);
  assert.equal((await invalidRunAgentEvent.json()).error, "invalid_agent_event_payload");
  const hugeRunMessage = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(20001) }] })
  });
  assert.equal(hugeRunMessage.status, 413);
  assert.equal((await hugeRunMessage.json()).error, "task_run_too_large");
  const hugeRunAgentEvent = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentEvents: [{ type: "check", payload: { blob: "x".repeat(20001) } }] })
  });
  assert.equal(hugeRunAgentEvent.status, 413);
  assert.equal((await hugeRunAgentEvent.json()).error, "task_run_too_large");
  const eventHistoryLog = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/log`);
  assert.deepEqual(eventHistoryLog.agentEvents.map((event) => event.type), ["workspace_file_saved", "workspace_file_saved", "workspace_file_saved", "agent_command", "agent_command_failed", "check"]);
  let taskLogs = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  assert.equal(taskLogs.taskLogs.find((task) => task.id === taskId).label, "Задание 1 выполнено");
  const failedRun = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "test_failure", finalResult: "missing flag check failed" })
  });
  taskLogs = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  assert.equal(taskLogs.taskLogs.find((task) => task.id === taskId).label, "Задание 1 с ошибкой");
  let memoryEvents = await fetchJson(`http://127.0.0.1:${port}/api/memory/events`);
  const taskRunMemory = memoryEvents.reviewQueue.find((event) => event.source === "task_run");
  assert.equal(taskRunMemory.evidence.runId, failedRun.run.id);
  assert.match(taskRunMemory.text, /missing flag check failed/);
  await fetchJson(`http://127.0.0.1:${port}/api/memory/events/${taskRunMemory.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewStatus: "rejected" })
  });
  const memoryEvent = await fetchJson(`http://127.0.0.1:${port}/api/memory/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "weak_topic",
      text: "Путает порядок fillna и missing flag",
      source: "task_run",
      evidence: { taskId, runId: run.run.id }
    })
  });
  assert.equal(memoryEvent.event.reviewStatus, "pending");
  const invalidMemoryEvent = await fetch(`http://127.0.0.1:${port}/api/memory/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "random_note", text: "Неизвестный тип памяти" })
  });
  assert.equal(invalidMemoryEvent.status, 400);
  assert.equal((await invalidMemoryEvent.json()).error, "invalid_memory_event_kind");
  const invalidMemorySource = await fetch(`http://127.0.0.1:${port}/api/memory/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "weak_topic", text: "Плохой источник", source: "random_source" })
  });
  assert.equal(invalidMemorySource.status, 400);
  assert.equal((await invalidMemorySource.json()).error, "invalid_memory_event_source");
  const invalidMemoryEvidence = await fetch(`http://127.0.0.1:${port}/api/memory/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "weak_topic", text: "Плохой evidence", evidence: ["task"] })
  });
  assert.equal(invalidMemoryEvidence.status, 400);
  assert.equal((await invalidMemoryEvidence.json()).error, "invalid_memory_event_evidence");
  const hugeMemoryEvent = await fetch(`http://127.0.0.1:${port}/api/memory/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "weak_topic", text: "x".repeat(5001), evidence: { taskId } })
  });
  assert.equal(hugeMemoryEvent.status, 413);
  assert.equal((await hugeMemoryEvent.json()).error, "memory_event_too_large");
  const hugeMemoryEvidence = await fetch(`http://127.0.0.1:${port}/api/memory/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "weak_topic", text: "evidence too big", evidence: { blob: "x".repeat(20001) } })
  });
  assert.equal(hugeMemoryEvidence.status, 413);
  assert.equal((await hugeMemoryEvidence.json()).error, "memory_event_too_large");
  memoryEvents = await fetchJson(`http://127.0.0.1:${port}/api/memory/events`);
  assert.ok(memoryEvents.reviewQueue.some((event) => event.id === memoryEvent.event.id));
  assert.equal(memoryEvents.retrievedMemory[0].text, "Путает порядок fillna и missing flag");
  await fetchJson(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graphMemoryUrl: `http://127.0.0.1:${graphPort}` })
  });
  const reviewedMemory = await fetchJson(`http://127.0.0.1:${port}/api/memory/events/${memoryEvent.event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewStatus: "accepted", syncGraph: true })
  });
  assert.equal(reviewedMemory.event.reviewStatus, "accepted");
  assert.equal(reviewedMemory.graph.ok, true);
  assert.equal(reviewedMemory.graph.synced, 1);
  memoryEvents = await fetchJson(`http://127.0.0.1:${port}/api/memory/events`);
  assert.equal(memoryEvents.reviewQueue.some((event) => event.id === memoryEvent.event.id), false);
  state = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  assert.equal(state.skillGraph.length, 1);
  assert.equal(state.skillGraph[0].status, "weak");
  assert.equal(state.skillGraph[0].concept, "Путает порядок fillna и missing flag");
  const graphHealth = await fetchJson(`http://127.0.0.1:${port}/api/memory/graph-health`);
  assert.equal(graphHealth.ok, true);
  assert.equal(graphHealth.configured, true);
  assert.equal(graphHealth.graph.service, "codelearn-graph-memory");
  assert.equal(graphHealth.graph.ready, true);
  const graphItems = await fetchJson(`http://127.0.0.1:${port}/api/memory/graph-items`);
  assert.equal(graphItems.ok, true);
  assert.equal(graphItems.configured, true);
  assert.deepEqual(graphItems.groups, [taskId]);
  assert.deepEqual(graphItems.items[0], {
    uuid: "memory-edge-1",
    subject: "user",
    relation: "struggles_with",
    object: "missing value handling",
    fact: "Путает порядок fillna и missing flag",
    createdAt: "2026-07-03T10:00:00Z",
    groupId: taskId
  });
  await fetchJson(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graphMemoryUrl: `http://127.0.0.1:${graphPort}/missing-credentials` })
  });
  const missingGraphCredentials = await fetch(`http://127.0.0.1:${port}/api/memory/graph-health`);
  assert.equal(missingGraphCredentials.status, 502);
  assert.equal((await missingGraphCredentials.json()).error, "missing_graph_memory_credentials");
  await fetchJson(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graphMemoryUrl: `http://127.0.0.1:${graphPort}` })
  });
  const graphSync = await fetchJson(`http://127.0.0.1:${port}/api/memory/graph-sync`, { method: "POST" });
  assert.equal(graphSync.synced, 0);
  assert.equal(graphSync.graph.ok, true);
  assert.equal(graphEvents.length, 1);
  assert.equal(graphEvents[0].events.length, 1);
  assert.equal(graphEvents[0].events[0].id, memoryEvent.event.id);
  assert.equal(graphEvents[0].events[0].reviewStatus, "accepted");
  const graphSearch = await fetchJson(`http://127.0.0.1:${port}/api/memory/graph-search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "missing flag", taskId, limit: 3 })
  });
  assert.equal(graphSearch.graph.results[0].fact, graphFact);
  assert.equal(graphSearches.length, 1);
  assert.equal(graphSearches[0].groupId, taskId);
  assert.equal(graphSearches[0].limit, 3);
  const projectGraphSearch = await fetchJson(`http://127.0.0.1:${port}/api/memory/graph-search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "project memory", taskId, projectId: "lesson-project", limit: 2 })
  });
  assert.deepEqual(projectGraphSearch.graph.groups, [taskId, "lesson-project"]);
  assert.equal(graphSearches.at(-2).groupId, taskId);
  assert.equal(graphSearches.at(-1).groupId, "lesson-project");
  assert.equal(graphSearches.at(-1).limit, 2);
  state = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  assert.ok(state.retrievedMemory.some((memory) => memory.text === graphFact));
  await fetchJson(`http://127.0.0.1:${port}/api/memory/graph-search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "missing flag", taskId, limit: 5000 })
  });
  assert.equal(graphSearches.at(-1).limit, 50);
  const missingTaskGraphSearch = await fetch(`http://127.0.0.1:${port}/api/memory/graph-search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "missing flag", taskId: "missing-task" })
  });
  assert.equal(missingTaskGraphSearch.status, 404);
  assert.equal((await missingTaskGraphSearch.json()).error, "task_not_found");
  await fetchJson(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graphMemoryUrl: "http://127.0.0.1:9" })
  });
  const unreachableGraphSearch = await fetch(`http://127.0.0.1:${port}/api/memory/graph-search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "missing flag", taskId })
  });
  assert.equal(unreachableGraphSearch.status, 502);
  assert.equal((await unreachableGraphSearch.json()).error, "graph_memory_unreachable");
  const unreachableGraphSync = await fetchJson(`http://127.0.0.1:${port}/api/memory/graph-sync`, { method: "POST" });
  assert.equal(unreachableGraphSync.ok, true);
  assert.equal(unreachableGraphSync.synced, 0);
  assert.equal(unreachableGraphSync.graph.skipped, "no_unsynced_events");
  const invalidGraphSetting = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graphMemoryUrl: "file:///tmp/graph" })
  });
  assert.equal(invalidGraphSetting.status, 400);
  assert.equal((await invalidGraphSetting.json()).error, "invalid_graph_memory_url");
  const chat = await fetchJson(`http://127.0.0.1:${port}/api/assistant/chats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Разбор задачи", projectId: state.lesson.id, taskId })
  });
  assert.equal(chat.chat.label, "Разбор задачи");
  const invalidTaskChat = await fetch(`http://127.0.0.1:${port}/api/assistant/chats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Потерянная задача", projectId: state.lesson.id, taskId: "missing-task" })
  });
  assert.equal(invalidTaskChat.status, 404);
  assert.equal((await invalidTaskChat.json()).error, "task_not_found");
  const invalidChatLabel = await fetch(`http://127.0.0.1:${port}/api/assistant/chats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "x".repeat(121), projectId: state.lesson.id, taskId })
  });
  assert.equal(invalidChatLabel.status, 400);
  assert.equal((await invalidChatLabel.json()).error, "invalid_chat_label");
  await fetchJson(`http://127.0.0.1:${port}/api/assistant/chats/${chat.chat.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "user", content: "Отдельный контекст чата" })
  });
  await fetchJson(`http://127.0.0.1:${port}/api/assistant/chats/${chat.chat.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "assistant", content: "Контекст сохранен отдельно" })
  });
  const invalidChatRole = await fetch(`http://127.0.0.1:${port}/api/assistant/chats/${chat.chat.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "developer", content: "bad role" })
  });
  assert.equal(invalidChatRole.status, 400);
  assert.equal((await invalidChatRole.json()).error, "invalid_chat_message_role");
  const invalidChatContent = await fetch(`http://127.0.0.1:${port}/api/assistant/chats/${chat.chat.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "user", content: { bad: true } })
  });
  assert.equal(invalidChatContent.status, 400);
  assert.equal((await invalidChatContent.json()).error, "invalid_chat_message_content");
  const hugeChatMessage = await fetch(`http://127.0.0.1:${port}/api/assistant/chats/${chat.chat.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "user", content: "x".repeat(20001) })
  });
  assert.equal(hugeChatMessage.status, 413);
  assert.equal((await hugeChatMessage.json()).error, "chat_message_too_large");
  let chatState = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  assert.equal(chatState.assistantChats.length, 1);
  assert.deepEqual(chatState.assistantChats[0].messages.map((message) => message.role), ["user", "assistant"]);
  const chatTaskLog = await fetchJson(`http://127.0.0.1:${port}/api/tasks/${taskId}/log`);
  assert.deepEqual(chatTaskLog.messages.slice(-2).map((message) => message.content), ["Отдельный контекст чата", "Контекст сохранен отдельно"]);
  assert.equal(chatTaskLog.messages.at(-1).source, "assistant_chat");
  const explicitRememberMessage = await fetchJson(`http://127.0.0.1:${port}/api/assistant/chats/${chat.chat.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "user", content: "Запомни слабую тему: путаю reshape в pandas" })
  });
  assert.equal(explicitRememberMessage.memory, undefined);
  chatState = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  const assistantChatMemory = chatState.memoryReviewQueue.find((event) => event.source === "assistant_chat");
  assert.equal(assistantChatMemory, undefined);
  const models = await fetchJson(`http://127.0.0.1:${port}/api/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: `http://127.0.0.1:${modelPort}`, apiKeyEnv: "OPENROUTER_API_KEY" })
  });
  assert.deepEqual(models.data.map((model) => model.id), ["test-model"]);
  assert.doesNotMatch(JSON.stringify(models), /sk-test-secret/);
  const invalidModelsUrl = await fetch(`http://127.0.0.1:${port}/api/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "file:///tmp/models", apiKeyEnv: "OPENROUTER_API_KEY" })
  });
  assert.equal(invalidModelsUrl.status, 400);
  assert.equal((await invalidModelsUrl.json()).error, "invalid_provider_url");
  const invalidModelsSecretEnv = await fetch(`http://127.0.0.1:${port}/api/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: `http://127.0.0.1:${modelPort}`, apiKeyEnv: "CODELEARN_DB_PATH" })
  });
  assert.equal(invalidModelsSecretEnv.status, 400);
  assert.equal((await invalidModelsSecretEnv.json()).error, "invalid_api_key_env");
  const invalidModelsHeaderEnv = await fetch(`http://127.0.0.1:${port}/api/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: `http://127.0.0.1:${modelPort}`, apiKeyEnv: "OPENROUTER_API_KEY", envHeaders: { "x-leak": "CODELEARN_DB_PATH" } })
  });
  assert.equal(invalidModelsHeaderEnv.status, 400);
  assert.equal((await invalidModelsHeaderEnv.json()).error, "invalid_env_header");
  const invalidResponsesUrl = await fetch(`http://127.0.0.1:${port}/api/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "ftp://example.invalid/chat", apiKeyEnv: "OPENROUTER_API_KEY", body: {} })
  });
  assert.equal(invalidResponsesUrl.status, 400);
  assert.equal((await invalidResponsesUrl.json()).error, "invalid_provider_url");
  const invalidResponsesSecretEnv = await fetch(`http://127.0.0.1:${port}/api/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `http://127.0.0.1:${modelPort}/chat`, apiKeyEnv: "CODELEARN_DB_PATH", body: {} })
  });
  assert.equal(invalidResponsesSecretEnv.status, 400);
  assert.equal((await invalidResponsesSecretEnv.json()).error, "invalid_api_key_env");
  const pipelineSave = await fetchJson(`http://127.0.0.1:${port}/api/progress/pipeline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "mini-module",
      steps: [
        { stage: "theory", title: "Разобрать missing values", detail: "Короткая теория" },
        { stage: "tests", title: "Проверить edge cases", detail: "Мини-тест" },
        { stage: "project", title: "Собрать feature pipeline", detail: "Практика" },
        { stage: "review", title: "Разбор решения", detail: "Ревью" }
      ]
    })
  });
  assert.equal(pipelineSave.pipeline.scope, "mini-module");
  assert.equal(pipelineSave.pipeline.steps.length, 4);
  const invalidPipelineStage = await fetch(`http://127.0.0.1:${port}/api/progress/pipeline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "single",
      steps: [{ stage: "demo", title: "Неверный шаг", detail: "Не входит в контракт." }]
    })
  });
  assert.equal(invalidPipelineStage.status, 400);
  assert.equal((await invalidPipelineStage.json()).error, "invalid_pipeline_stage");
  const invalidPipelineSteps = await fetch(`http://127.0.0.1:${port}/api/progress/pipeline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "single", steps: "bad" })
  });
  assert.equal(invalidPipelineSteps.status, 400);
  assert.equal((await invalidPipelineSteps.json()).error, "invalid_pipeline_steps");
  const hugePipelineStep = await fetch(`http://127.0.0.1:${port}/api/progress/pipeline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "single", steps: [{ stage: "theory", title: "ok", detail: "x".repeat(4001) }] })
  });
  assert.equal(hugePipelineStep.status, 413);
  assert.equal((await hugePipelineStep.json()).error, "pipeline_step_too_large");
  const invalidPipelineOrder = await fetch(`http://127.0.0.1:${port}/api/progress/pipeline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "single",
      steps: [
        { stage: "tests", title: "Сначала тесты", detail: "Неверный порядок." },
        { stage: "theory", title: "Потом теория", detail: "Неверный порядок." }
      ]
    })
  });
  assert.equal(invalidPipelineOrder.status, 400);
  assert.equal((await invalidPipelineOrder.json()).error, "invalid_pipeline_order");
  const importedPipeline = await fetchJson(`http://127.0.0.1:${port}/api/progress/pipeline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "project",
      steps: [
        { stage: "theory", title: "LLM теория", detail: "Сгенерированный блок" },
        { stage: "tests", title: "LLM тесты", detail: "Сгенерированный блок" },
        { stage: "project", title: "LLM проект", detail: "Сгенерированный блок" },
        { stage: "review", title: "LLM ревью", detail: "Сгенерированный блок" }
      ]
    })
  });
  assert.equal(importedPipeline.pipeline.scope, "project");
  assert.equal(importedPipeline.pipeline.steps[0].title, "LLM теория");
  state = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  const pipelineEvents = state.memoryReviewQueue.filter((event) => event.source === "progress_pipeline");
  assert.equal(pipelineEvents.length, 2);
  assert.equal(pipelineEvents.at(-1).kind, "project_reference");
  assert.match(pipelineEvents.at(-1).text, /Разобрать missing values/);
  assert.equal(pipelineEvents[0].evidence.scope, "project");
  await writeFile(envPath, ["KEEP_ME=1", `${"OPENROUTER_API_KEY"}=old-value`, ""].join("\n"), "utf8");
  const settingsSave = await fetchJson(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerId: "openrouter",
      providerModel: "test-model",
      profileName: "Алексей",
      mascotId: "05_laptop_spiky",
      providerApiKeys: { openai: "oa-test-openai", openrouter: "sk-test-secret", yandex: "sk-test-yandex" },
      yandexFolderId: "folder-secret-123",
      workspaceRuntime: "code-server",
      workspaceRuntimeUrl: `http://127.0.0.1:${agentPort}`,
      agentRuntimeUrl: `http://127.0.0.1:${agentPort}`,
      graphMemoryUrl: `http://127.0.0.1:${graphPort}`,
      graphEmbeddingProvider: "openrouter",
      graphEmbeddingBaseUrl: "https://openrouter.ai/api/v1",
      graphEmbeddingModel: "openai/text-embedding-3-small",
      graphEmbeddingDim: "1536",
      graphApiKey: "graph-test-key",
      sandboxCpuTimeSec: "2",
      sandboxMemoryMb: "256",
      mascotAssistantSettings: JSON.stringify({ x: 22, y: 33, size: 144 })
    })
  });
  assert.equal(settingsSave.providerStatus.openrouter.configured, true);
  assert.equal(settingsSave.settings.profileName, "Алексей");
  assert.equal(settingsSave.providerStatus.openrouter.masked, "sk-t...cret");
  assert.equal(settingsSave.providerStatus.openai.configured, true);
  assert.equal(settingsSave.providerStatus.openai.masked, "oa-t...enai");
  assert.equal(settingsSave.providerStatus.yandex.configured, true);
  assert.equal(settingsSave.providerStatus.yandex.folder.configured, true);
  assert.equal(settingsSave.settings.graphEmbeddingProvider, "openrouter");
  assert.equal(settingsSave.settings.graphEmbeddingDim, "1536");
  assert.doesNotMatch(JSON.stringify(settingsSave), /oa-test-openai/);
  assert.doesNotMatch(JSON.stringify(settingsSave), /sk-test-secret/);
  assert.doesNotMatch(JSON.stringify(settingsSave), /folder-secret-123/);
  assert.doesNotMatch(JSON.stringify(settingsSave), /graph-test-key/);
  const savedEnv = await readFile(envPath, "utf8");
  const savedEnvMap = Object.fromEntries(savedEnv.trim().split("\n").map((line) => line.split("=", 2)));
  assert.equal(savedEnvMap.KEEP_ME, "1");
  assert.equal(savedEnvMap.OPENAI_API_KEY, "oa-test-openai");
  assert.equal(savedEnvMap.OPENROUTER_API_KEY, "sk-test-secret");
  assert.equal(savedEnvMap.YANDEX_AI_STUDIO_API_KEY, "sk-test-yandex");
  assert.equal(savedEnvMap.YANDEX_AI_STUDIO_FOLDER_ID, "folder-secret-123");
  assert.equal(savedEnvMap.GRAPH_EMBEDDING_PROVIDER, "openrouter");
  assert.equal(savedEnvMap.GRAPH_EMBEDDING_MODEL, "openai/text-embedding-3-small");
  assert.equal(savedEnvMap.GRAPH_EMBEDDING_DIM, "1536");
  assert.equal(savedEnvMap.GRAPHITI_LLM_PROVIDER, undefined);
  assert.equal(savedEnvMap.GRAPH_OPENROUTER_API_KEY, "graph-test-key");
  assert.notEqual(savedEnvMap.OPENROUTER_API_KEY, "old-value");
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  const runtimeStart = await fetchJson(`http://127.0.0.1:${port}/api/runtime/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(runtimeStart.ok, true);
  assert.deepEqual((await readFile(dockerCallLog, "utf8")).trim().split("\n"), [
    "compose", "-f", "docker-compose.workspace.yml", "up", "-d", "--build",
    "code-server", "openhands", "falkordb", "graph-memory"
  ]);
  const arbitraryRuntimeStart = await fetch(`http://127.0.0.1:${port}/api/runtime/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ services: ["untrusted-service"] })
  });
  assert.equal(arbitraryRuntimeStart.status, 400);
  assert.equal((await arbitraryRuntimeStart.json()).error, "invalid_runtime_start_request");
  const invalidGraphProvider = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graphEmbeddingProvider: "untrusted" })
  });
  assert.equal(invalidGraphProvider.status, 400);
  assert.equal((await invalidGraphProvider.json()).error, "invalid_graph_embedding_provider");
  const invalidGraphEmbeddingUrl = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graphEmbeddingBaseUrl: "file:///tmp/embedder" })
  });
  assert.equal(invalidGraphEmbeddingUrl.status, 400);
  assert.equal((await invalidGraphEmbeddingUrl.json()).error, "invalid_graph_embedding_url");
  const invalidGraphEmbeddingDim = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graphEmbeddingDim: 0 })
  });
  assert.equal(invalidGraphEmbeddingDim.status, 400);
  assert.equal((await invalidGraphEmbeddingDim.json()).error, "invalid_graph_embedding_dim");
  const invalidProfileName = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profileName: "x".repeat(81) })
  });
  assert.equal(invalidProfileName.status, 400);
  assert.equal((await invalidProfileName.json()).error, "invalid_profile_name");
  const unknownProviderId = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: "unknown" })
  });
  assert.equal(unknownProviderId.status, 400);
  assert.equal((await unknownProviderId.json()).error, "invalid_provider_id");
  const unknownProviderKey = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerApiKeys: { unknown: "sk-unknown-secret" } })
  });
  assert.equal(unknownProviderKey.status, 400);
  assert.equal((await unknownProviderKey.json()).error, "invalid_provider_id");
  const unknownProviderKeyWithSetting = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerModel: "must-not-persist", providerApiKeys: { unknown: "sk-unknown-secret" } })
  });
  assert.equal(unknownProviderKeyWithSetting.status, 400);
  assert.equal((await unknownProviderKeyWithSetting.json()).error, "invalid_provider_id");
  const stateAfterRejectedSettings = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);
  assert.equal(stateAfterRejectedSettings.settings.providerModel, "test-model");
  const invalidProviderKeysPayload = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerModel: "must-not-persist", providerApiKeys: "bad" })
  });
  assert.equal(invalidProviderKeysPayload.status, 400);
  assert.equal((await invalidProviderKeysPayload.json()).error, "invalid_provider_api_keys");
  assert.equal((await fetchJson(`http://127.0.0.1:${port}/api/app-state`)).settings.providerModel, "test-model");
  const multilineProviderKey = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerApiKeys: { openrouter: "sk-line\nBAD_ENV=value" } })
  });
  assert.equal(multilineProviderKey.status, 400);
  assert.equal((await multilineProviderKey.json()).error, "invalid_secret_value");
  const trailingNewlineProviderKey = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerApiKeys: { openrouter: "sk-trailing\n" } })
  });
  assert.equal(trailingNewlineProviderKey.status, 400);
  assert.equal((await trailingNewlineProviderKey.json()).error, "invalid_secret_value");
  const objectProviderKey = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerApiKeys: { openrouter: { secret: "sk-object" } } })
  });
  assert.equal(objectProviderKey.status, 400);
  assert.equal((await objectProviderKey.json()).error, "invalid_secret_value");
  const multilineYandexFolder = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ yandexFolderId: "folder\nBAD_ENV=value" })
  });
  assert.equal(multilineYandexFolder.status, 400);
  assert.equal((await multilineYandexFolder.json()).error, "invalid_secret_value");
  const trailingNewlineYandexFolder = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ yandexFolderId: "folder-trailing\n" })
  });
  assert.equal(trailingNewlineYandexFolder.status, 400);
  assert.equal((await trailingNewlineYandexFolder.json()).error, "invalid_secret_value");
  const objectYandexFolder = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ yandexFolderId: { folder: "bad" } })
  });
  assert.equal(objectYandexFolder.status, 400);
  assert.equal((await objectYandexFolder.json()).error, "invalid_secret_value");
  const invalidProviderBaseUrl = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerBaseUrl: "file:///tmp/provider" })
  });
  assert.equal(invalidProviderBaseUrl.status, 400);
  assert.equal((await invalidProviderBaseUrl.json()).error, "invalid_provider_url");
  const invalidWorkspaceRuntime = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceRuntime: "desktop-root" })
  });
  assert.equal(invalidWorkspaceRuntime.status, 400);
  assert.equal((await invalidWorkspaceRuntime.json()).error, "invalid_workspace_runtime");
  const invalidMascot = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mascotId: "missing_mascot" })
  });
  assert.equal(invalidMascot.status, 400);
  assert.equal((await invalidMascot.json()).error, "invalid_mascot_id");
  const invalidMascotSettings = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerModel: "must-not-persist", mascotAssistantSettings: "{bad" })
  });
  assert.equal(invalidMascotSettings.status, 400);
  assert.equal((await invalidMascotSettings.json()).error, "invalid_mascot_settings");
  assert.equal((await fetchJson(`http://127.0.0.1:${port}/api/app-state`)).settings.providerModel, "test-model");
  const invalidWorkspaceRuntimeUrl = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceRuntimeUrl: "file:///tmp/workspace" })
  });
  assert.equal(invalidWorkspaceRuntimeUrl.status, 400);
  assert.equal((await invalidWorkspaceRuntimeUrl.json()).error, "invalid_workspace_runtime_url");
  const invalidSandboxCpu = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sandboxCpuTimeSec: "0" })
  });
  assert.equal(invalidSandboxCpu.status, 400);
  assert.equal((await invalidSandboxCpu.json()).error, "invalid_sandbox_cpu_time");
  const invalidSandboxMemory = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sandboxMemoryMb: "63" })
  });
  assert.equal(invalidSandboxMemory.status, 400);
  assert.equal((await invalidSandboxMemory.json()).error, "invalid_sandbox_memory");
  const runtimeHealth = await fetchJson(`http://127.0.0.1:${port}/api/runtime/health`);
  assert.equal(runtimeHealth.ok, true);
  assert.equal(runtimeHealth.workspace.ok, true);
  assert.equal(runtimeHealth.agent.ok, true);
  assert.equal(runtimeHealth.judge.ok, true);
  assert.equal(runtimeHealth.graph.ok, true);
  const invalidJson = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: "{bad"
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error, "invalid_json");

  await stopServer(server);
  server = await startServer({ seed: "false", dbPath, port });
  state = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);

  assert.equal(state.progress[taskId].code, "print('from workspace')");
  assert.equal(state.progress[taskId].hintIndex, 2);
  assert.equal(state.settings.providerId, "openrouter");
  assert.equal(state.settings.providerModel, "test-model");
  assert.equal(state.settings.profileName, "Алексей");
  assert.equal(state.settings.mascotId, "05_laptop_spiky");
  assert.equal(state.settings.workspaceRuntime, "code-server");
  assert.equal(state.settings.workspaceRuntimeUrl, `http://127.0.0.1:${agentPort}`);
  assert.equal(state.settings.agentRuntimeUrl, `http://127.0.0.1:${agentPort}`);
  assert.equal(state.settings.graphMemoryUrl, `http://127.0.0.1:${graphPort}`);
  assert.equal(state.settings.sandboxCpuTimeSec, "2");
  assert.equal(state.settings.sandboxMemoryMb, "256");
  assert.equal(state.learningPipeline.scope, "project");
  assert.equal(state.learningPipeline.steps[0].title, "LLM теория");
  assert.equal(state.memoryEvents.length, 5);
  assert.equal(state.memoryReviewQueue.length, 3);
  assert.ok(state.retrievedMemory.some((memory) => memory.kind === "weak_topic"));
  assert.ok(state.retrievedMemory.some((memory) => memory.text === graphFact));
  assert.equal(state.skillGraph[0].status, "weak");
  assert.equal(state.assistantChats[0].label, "Разбор задачи");
  assert.equal(state.assistantChats[0].messages[1].content, "Контекст сохранен отдельно");
  assert.equal(state.settings.mascotAssistantSettings, JSON.stringify({ x: 22, y: 33, size: 144 }));
  assert.equal(state.providerStatus.openrouter.configured, true);
  assert.equal(state.providerStatus.openai.configured, true);
  assert.equal(state.providerStatus.yandex.folder.configured, true);
  assert.doesNotMatch(JSON.stringify(state), /oa-test-openai/);
  assert.doesNotMatch(JSON.stringify(state), /sk-test-secret/);
  assert.doesNotMatch(JSON.stringify(state), /folder-secret-123/);

  await stopServer(server);
  const emptyDbPath = join(tmp, "empty.sqlite");
  server = await startServer({ seed: "false", dbPath: emptyDbPath, port });
  state = await fetchJson(`http://127.0.0.1:${port}/api/app-state`);

  assert.equal(state.lesson, null);
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.memoryEvents, []);
  assert.deepEqual(state.memoryReviewQueue, []);
  assert.deepEqual(state.retrievedMemory, []);
  assert.deepEqual(state.skillGraph, []);
  assert.deepEqual(state.assistantChats, []);
  assert.equal(state.learningPipeline, null);
  assert.equal(state.activity, undefined);

  await stopServer(server);
  console.log("persistence-api-check passed");
} finally {
  if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
  if (graphServer) await new Promise((resolve) => graphServer.close(resolve));
  if (agentServer) await new Promise((resolve) => agentServer.close(resolve));
  if (judgeServer) await new Promise((resolve) => judgeServer.close(resolve));
  await rm(tmp, { recursive: true, force: true });
}

async function startServer({ seed, dbPath, port }) {
  const child = spawn(nodeBin, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      CODELEARN_DB_PATH: dbPath,
      CODELEARN_ENV_PATH: envPath,
      CODELEARN_WORKSPACE_ROOT: workspaceRoot,
      WORKSPACE_RUNTIME_URL: `http://127.0.0.1:${agentPort}`,
      AGENT_RUNTIME_URL: `http://127.0.0.1:${agentPort}`,
      GRAPH_MEMORY_URL: `http://127.0.0.1:${graphPort}`,
      JUDGE0_BASE_URL: `http://127.0.0.1:${judgePort}`,
      OPENROUTER_API_KEY: "sk-test-secret",
      CODELEARN_SEED_DEV_DATA: seed,
      PERSONALITY_PATH: join(tmp, "personality.md"),
      PATH: `${fakeBin}:${process.env.PATH || ""}`,
      DOCKER_CALL_LOG: dockerCallLog
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  await waitFor(() => output.includes("CodeLearn listening"), 3000, () => output);
  return child;
}

async function startModelServer(port) {
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer sk-test-secret");
    assert.equal(req.url, "/models");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

async function startGraphServer(port, receivedEvents, receivedSearches) {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "codelearn-graph-memory", ready: true }));
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/memory/items?")) {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const groupId = url.searchParams.get("groupId");
      assert.equal(url.searchParams.get("limit"), "100");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        groupId,
        items: [{
          uuid: "memory-edge-1",
          subject: "user",
          relation: "struggles_with",
          object: "missing value handling",
          fact: "Путает порядок fillna и missing flag",
          createdAt: "2026-07-03T10:00:00Z"
        }]
      }));
      return;
    }
    if (req.method === "GET" && req.url === "/missing-credentials/health") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, service: "codelearn-graph-memory", ready: false, error: "missing_graph_memory_credentials" }));
      return;
    }
    assert.equal(req.method, "POST");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (req.url === "/memory/events") {
      receivedEvents.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    assert.equal(req.url, "/memory/search");
    receivedSearches.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, results: [{ fact: graphFact }] }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

async function startJudgeServer(port, receivedSubmissions) {
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/submissions?base64_encoded=false&wait=true");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    receivedSubmissions.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      stdout: JSON.stringify({
        status: "passed",
        stdout: "",
        stderr: "",
        public_test_results: [{ name: "арифметика работает", passed: true, message: "прошла" }],
        hidden_test_summary: "Скрытые проверки не раскрываются.",
        category: "accepted"
      }),
      stderr: "",
      time: "0.01",
      memory: 1024,
      status: { description: "Accepted" }
    }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

async function startAgentServer(port, receivedCommands) {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/commands");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    receivedCommands.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "queued" }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  return data;
}

async function waitFor(check, timeoutMs, debug) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(debug());
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
