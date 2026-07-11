import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "codelearn-coding-task-"));
const appPort = 49420;
const providerPort = 49421;
const judgePort = 49422;
const judgeSubmissions = [];
const providerRequests = [];
let app;
let provider;
let judge;

try {
  provider = await startProvider();
  judge = await startJudge();
  app = await startApp();
  await json("/api/settings", { method: "PATCH", body: { providerId: "openrouter", providerBaseUrl: `http://127.0.0.1:${providerPort}`, providerModel: "test-model" } });

  const created = await streamAsk("Создай задачу: реализовать функцию-счётчик");
  assert.equal(created.complete.action.type, "open_task");
  assert.equal(created.complete.message.content, "Задача подготовлена.");
  assert.equal(created.complete.task.language, "python");
  assert.equal(created.complete.task.acceptanceCriteria.length, 2);
  const taskId = created.complete.task.id;

  const state = await json("/api/app-state");
  assert.ok(state.tasks.some((task) => task.id === taskId));
  const log = await json(`/api/tasks/${taskId}/log`);
  assert.equal(log.task.language, "python");
  assert.equal(log.task.acceptanceCriteria[0], "Первый вызов возвращает 1");
  assert.equal("hiddenChecks" in log.task, false);

  const code = "def make_counter():\n    value = 0\n    def counter():\n        nonlocal value\n        value += 1\n        return value\n    return counter\n";
  await json(`/api/tasks/${taskId}/progress`, { method: "PATCH", body: { code } });
  const run = await json(`/api/tasks/${taskId}/execute`, { method: "POST", body: { code, mode: "run" } });
  assert.equal(run.execution.status, "passed");
  assert.equal(run.feedback, "Код исполнился без ошибок, public checks прошли.");
  const submitted = await json(`/api/tasks/${taskId}/execute`, { method: "POST", body: { code, mode: "submit" } });
  assert.equal(submitted.execution.status, "passed");
  assert.equal(submitted.taskStatus, "passed");
  assert.equal(judgeSubmissions.length, 2);
  assert.equal(judgeSubmissions.every((submission) => submission.enable_network === false), true);
  assert.equal(judgeSubmissions.every((submission) => submission.max_processes_and_or_threads === 16), true);

  const review = await streamAsk("review-solution", taskId);
  assert.equal(review.complete.message.content, "LLM review: код исполняется, состояние замыкания реализовано корректно.");
  const reviewRequest = providerRequests.find((request) => request.content === "review-solution" && !request.toolOutput);
  assert.match(reviewRequest.system, /Первый вызов возвращает 1/);
  assert.match(reviewRequest.system, /def make_counter/);
  assert.match(reviewRequest.system, /passed/);
  assert.doesNotMatch(reviewRequest.system, /Скрытые проверки|hidden/);

  const timeout = await json(`/api/tasks/${taskId}/execute`, { method: "POST", body: { code: "# TIMEOUT", mode: "run" } });
  assert.equal(timeout.execution.status, "timeout");
  assert.match(timeout.feedback, /времени/);

  const forbidden = await fetch(`http://127.0.0.1:${appPort}/api/tasks/${taskId}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, mode: "run", path: "/tmp", command: ["sh"] })
  });
  assert.equal(forbidden.status, 400);
  assert.equal((await forbidden.json()).error, "invalid_task_execution_request");

  const invalid = await streamAsk("invalid-task-language");
  assert.equal(invalid.complete.task, null);
  assert.equal(invalid.complete.toolErrors[0].error, "invalid_task_language");
  assert.equal((await json("/api/app-state")).tasks.length, 1);

  const javascript = await streamAsk("javascript-task");
  assert.equal(javascript.complete.task.language, "javascript");
  const jsCode = "function makeCounter() { let value = 0; return () => ++value; }";
  const jsRun = await json(`/api/tasks/${javascript.complete.task.id}/execute`, { method: "POST", body: { code: jsCode, mode: "run" } });
  assert.equal(jsRun.execution.status, "passed");
  assert.equal(judgeSubmissions.at(-1).language_id, 63);

  await stopChild(app);
  app = await startApp();
  const restarted = await json(`/api/tasks/${taskId}/log`);
  assert.equal(restarted.userCode, "# TIMEOUT");
  assert.equal(restarted.task.id, taskId);
  assert.ok(restarted.agentEvents.some((event) => event.type === "task_execution"));

  console.log("coding-task-check passed");
} finally {
  if (app) await stopChild(app);
  if (provider) await closeServer(provider);
  if (judge) await closeServer(judge);
  rmSync(tmp, { recursive: true, force: true });
}

async function streamAsk(content, taskId = "") {
  const chat = await json("/api/assistant/chats", { method: "POST", body: { label: content, taskId } });
  await json(`/api/assistant/chats/${chat.chat.id}/messages`, { method: "POST", body: { role: "user", content } });
  const response = await fetch(`http://127.0.0.1:${appPort}/api/assistant/respond/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ chatId: chat.chat.id })
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  const events = text.split("\n\n").flatMap((frame) => {
    const data = frame.split("\n").find((line) => line.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5).trim())] : [];
  });
  return { events, complete: events.find((event) => event.type === "complete") };
}

async function json(path, options = {}, expectedStatus = 200) {
  const response = await fetch(`http://127.0.0.1:${appPort}${path}`, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify(data)}`);
  return data;
}

function taskSpec(language = "python") {
  const javascript = language === "javascript";
  return JSON.stringify({
    title: "Функция-счётчик",
    description: "Реализуйте замыкание, которое хранит число вызовов и увеличивает его на единицу.",
    language,
    starterCode: javascript ? "function makeCounter() {\n  // TODO\n}\n" : "def make_counter():\n    pass\n",
    acceptanceCriteria: ["Первый вызов возвращает 1", "Следующий вызов возвращает 2"],
    publicChecks: [{
      message: "Счётчик сохраняет состояние",
      code: javascript ? "const counter = makeCounter();\nassert.equal(counter(), 1);\nassert.equal(counter(), 2);" : "counter = make_counter()\nassert counter() == 1\nassert counter() == 2"
    }],
    hints: ["Используйте nonlocal."],
    difficulty: "средняя",
    estimatedMinutes: 20
  });
}

async function startProvider() {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const content = body.messages?.filter((message) => message.role === "user").at(-1)?.content || "";
    const toolOutput = body.messages?.some((message) => message.role === "tool");
    providerRequests.push({ content, toolOutput, system: body.messages?.[0]?.content || "" });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (content === "review-solution") {
      send({ choices: [{ delta: { content: "LLM review: код исполняется, состояние замыкания реализовано корректно." } }] });
    } else if (toolOutput) {
      send({ choices: [{ delta: { content: "Задача подготовлена." } }] });
    } else {
      const language = content === "invalid-task-language" ? "rust" : content === "javascript-task" ? "javascript" : "python";
      const args = taskSpec(language);
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${Date.now()}`, type: "function", function: { name: "create_task", arguments: args.slice(0, 83) } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(83) } }] } }] });
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(providerPort, "127.0.0.1", resolve));
  return server;
}

async function startJudge() {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    judgeSubmissions.push(body);
    const source = Buffer.from(body.source_code, "base64").toString("utf8");
    if (source.includes("# TIMEOUT")) return reply(res, 200, { status: { description: "Time Limit Exceeded" }, stdout: "", stderr: "", time: "5.0", memory: 2048 });
    return reply(res, 200, {
      status: { description: "Accepted" },
      stdout: Buffer.from(JSON.stringify({ status: "passed", stdout: "", stderr: "", public_test_results: [{ name: "Счётчик сохраняет состояние", passed: true, message: "прошла" }], hidden_test_summary: "", category: "accepted" }), "utf8").toString("base64"),
      stderr: "",
      time: "0.02",
      memory: 1024
    });
  });
  await new Promise((resolve) => server.listen(judgePort, "127.0.0.1", resolve));
  return server;
}

async function startApp() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(appPort),
      HOST: "127.0.0.1",
      CODELEARN_DB_PATH: join(tmp, "codelearn.sqlite"),
      CODELEARN_ENV_PATH: join(tmp, ".env"),
      CODELEARN_WORKSPACE_ROOT: join(tmp, "workspace"),
      PERSONALITY_PATH: join(tmp, "personality.md"),
      OPENROUTER_API_KEY: "test-provider-key",
      JUDGE0_BASE_URL: `http://127.0.0.1:${judgePort}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const started = Date.now();
  while (!output.includes("CodeLearn listening")) {
    if (Date.now() - started > 3000) throw new Error(output || "server start timeout");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return child;
}

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function stopChild(child) {
  child.kill("SIGTERM");
  await once(child, "exit");
}
