import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "codelearn-chat-tools-"));
const appPort = 49220;
const providerPort = 49221;
const graphPort = 49222;
const providerRequests = [];
const graphSearches = [];
const graphEvents = [];
let app;
let provider;
let graph;

try {
  provider = await startProvider();
  graph = await startGraph();
  writeFileSync(join(tmp, "personality.md"), "# Предпочтения в ответах\n\nКороткие примеры на JavaScript\nOPENAI_API_KEY=should-not-reach-provider\n");
  app = await startApp();

  await json("/api/settings", {
    method: "PATCH",
    body: {
      providerId: "openrouter",
      providerBaseUrl: `http://127.0.0.1:${providerPort}`,
      providerModel: "test-model"
    }
  });
  const rejectedPersonality = await json("/api/personality", {
    method: "POST",
    body: { markdown: "# Предпочтения в ответах\n\nКороткие примеры на JavaScript\nOPENAI_API_KEY=should-not-reach-provider\n" }
  }, 400);
  assert.equal(rejectedPersonality.error, "sensitive_personality_data");
  const accepted = await json("/api/memory/events", {
    method: "POST",
    body: { kind: "response_preference", text: "Предпочитает JavaScript-примеры", source: "manual", evidence: { projectId: "local" } }
  });
  await json(`/api/memory/events/${accepted.event.id}`, { method: "PATCH", body: { reviewStatus: "accepted" } });
  await json("/api/memory/events", {
    method: "POST",
    body: { kind: "weak_topic", text: "PENDING_MEMORY_MUST_NOT_REACH_PROVIDER", source: "manual", evidence: {} }
  });

  const four = await ask("Сформируй тест по JavaScript, count=4");
  assert.equal(four.action.type, "open_test");
  assert.equal(four.memory.graph.configured, false);
  assert.equal(four.memory.graph.error, "missing_graph_memory_url");
  assert.deepEqual(four.toolErrors, []);
  assert.equal(four.test.questions.length, 4);
  assert.match(four.message.content, /JavaScript/);
  assert.match(four.message.content, /4 вопрос/);
  assert.doesNotMatch(four.message.content, /Вопрос 1|Вариант A|Объяснение 1|правильн/i);
  const firstChatRequest = providerRequests.find((request) => request.path === "/chat/completions" && !request.body.messages.some((message) => message.role === "tool"));
  assert.deepEqual(firstChatRequest.body.tools.map((tool) => tool.function.name), ["create_task", "create_test", "remember_context"]);
  assert.equal(firstChatRequest.body.parallel_tool_calls, false);
  assert.equal(firstChatRequest.body.tools[1].function.parameters.properties.questions.minItems, 4);
  assert.match(firstChatRequest.body.messages[0].content, /Короткие примеры на JavaScript/);
  assert.match(firstChatRequest.body.messages[0].content, /Предпочитает JavaScript-примеры/);
  assert.doesNotMatch(firstChatRequest.body.messages[0].content, /should-not-reach-provider|PENDING_MEMORY_MUST_NOT_REACH_PROVIDER/);
  const fourToolOutput = providerRequests.find((request) => request.path === "/chat/completions" && request.body.messages.some((message) => message.role === "tool"));
  const persistedToolOutput = JSON.parse(fourToolOutput.body.messages.find((message) => message.role === "tool").content);
  assert.equal(persistedToolOutput.ok, true);
  assert.equal(persistedToolOutput.test.id, four.test.id);
  assert.equal(persistedToolOutput.test.questionCount, 4);
  assert.equal(persistedToolOutput.test.questions, undefined);
  assert.doesNotMatch(JSON.stringify(persistedToolOutput), /correctAnswer|explanation|Вариант A/);

  await json("/api/settings", {
    method: "PATCH",
    body: {
      providerId: "openai",
      providerBaseUrl: `http://127.0.0.1:${providerPort}`,
      providerModel: "test-model",
      graphMemoryUrl: `http://127.0.0.1:${graphPort}`
    }
  });
  const fifteen = await ask("Сформируй тест по замыканиям JavaScript, count=15");
  assert.equal(fifteen.test.questions.length, 15);
  assert.equal(fifteen.memory.graph.ok, true);
  assert.ok(graphSearches.some((search) => search.query.includes("замыкания")));
  const responsesInitial = providerRequests.find((request) => request.path === "/responses" && !request.body.input.some((item) => item.type === "function_call_output"));
  assert.deepEqual(responsesInitial.body.tools.map((tool) => tool.name), ["create_task", "create_test", "remember_context"]);
  assert.equal(responsesInitial.body.parallel_tool_calls, false);
  assert.match(responsesInitial.body.instructions, /Graph memory: путает lexical scope/);
  const responsesFinal = providerRequests.find((request) => request.path === "/responses" && request.body.input.some((item) => item.type === "function_call_output"));
  assert.equal("previous_response_id" in responsesFinal.body, false);
  assert.ok(responsesFinal.body.input.some((item) => item.type === "function_call"));
  assert.ok(responsesFinal.body.input.some((item) => item.type === "function_call_output"));

  for (const count of [3, 16]) {
    const invalid = await ask(`Сформируй тест по границам, count=${count}`);
    assert.equal(invalid.action, null);
    assert.equal(invalid.test, null);
    assert.equal(invalid.toolErrors[0].error, "invalid_test_question_count");
  }
  const tests = await json("/api/tests");
  assert.equal(tests.tests.length, 2);
  const concrete = await json(`/api/tests/${four.test.id}`);
  assert.equal(concrete.test.id, four.action.targetId);
  assert.equal(concrete.test.questions.length, 4);
  const invalidAttempt = await json(`/api/tests/${four.test.id}/attempts`, { method: "POST", body: { answers: [0, 1, 2] } }, 400);
  assert.equal(invalidAttempt.error, "invalid_test_attempt_answers");
  const attempt = await json(`/api/tests/${four.test.id}/attempts`, { method: "POST", body: { answers: [0, 0, 2, 0] } });
  assert.equal(attempt.attempt.topic, "JavaScript");
  assert.equal(attempt.attempt.correctCount, 3);
  assert.equal(attempt.attempt.totalCount, 4);
  assert.equal(attempt.attempt.results.length, 4);
  assert.deepEqual(attempt.attempt.results.map((result) => result.correct), [true, false, true, true]);
  const stateWithAttempt = await json("/api/app-state");
  assert.equal(stateWithAttempt.quizAttempts[0].testId, four.test.id);
  assert.equal(stateWithAttempt.quizAttempts[0].topic, "JavaScript");
  assert.equal(stateWithAttempt.quizAttempts[0].correctCount, 3);

  const chats = await json("/api/assistant/chats");
  const savedAction = chats.chats.flatMap((chat) => chat.messages).find((message) => message.action?.targetId === four.test.id);
  assert.equal(savedAction.action.label, "Открыть в тестах");
  assert.doesNotMatch(savedAction.content, /Вопрос 1|Вариант A|Объяснение 1|правильн/i);

  const sensitive = await json("/api/memory/events", {
    method: "POST",
    body: { kind: "response_preference", text: "OPENAI_API_KEY=do-not-save", source: "manual", evidence: {} }
  }, 400);
  assert.equal(sensitive.error, "sensitive_memory_data");

  await json("/api/settings", {
    method: "PATCH",
    body: { providerId: "openrouter", providerBaseUrl: `http://127.0.0.1:${providerPort}`, providerModel: "test-model" }
  });
  const autonomousMemory = await ask("remember-autonomous: объясняй кратко; data leakage пока слабая тема");
  assert.equal(autonomousMemory.memoryWrites.length, 1);
  assert.equal(autonomousMemory.memoryWrites[0].ok, true);
  assert.equal(autonomousMemory.memoryWrites[0].memory.storedCount, 2);
  const generatedGraphEvents = graphEvents.flatMap((batch) => batch.events).filter((event) => event.evidence.assistantGenerated === true);
  assert.equal(generatedGraphEvents.length, 2);
  assert.equal(generatedGraphEvents.every((event) => event.reviewStatus === "accepted"), true);
  assert.deepEqual(generatedGraphEvents.map((event) => event.kind), ["response_preference", "skill_observation"]);
  assert.deepEqual(generatedGraphEvents.map((event) => event.evidence.graph), [
    { subject: "user", relation: "prefers", object: "short explanations first" },
    { subject: "user", relation: "struggles_with", object: "data leakage" }
  ]);
  const autonomousState = await json("/api/app-state");
  const generatedMemory = autonomousState.memoryEvents.filter((event) => event.evidence.assistantGenerated === true);
  assert.equal(generatedMemory.length, 2);
  assert.equal(generatedMemory.every((event) => event.reviewStatus === "accepted"), true);

  const graphEventCountBeforeSensitiveTool = generatedGraphEvents.length;
  const sensitiveMemory = await ask("remember-sensitive");
  assert.equal(sensitiveMemory.memoryWrites.length, 0);
  assert.equal(sensitiveMemory.toolErrors[0].error, "sensitive_memory_data");
  const graphEventCountAfterSensitiveTool = graphEvents.flatMap((batch) => batch.events).filter((event) => event.evidence.assistantGenerated === true).length;
  assert.equal(graphEventCountAfterSensitiveTool, graphEventCountBeforeSensitiveTool);

  const finalFailure = await ask("Сформируй тест по ошибкам, count=4 final-provider-failure");
  assert.equal(finalFailure.ok, false);
  assert.equal(finalFailure.providerError, "provider_request_failed");
  assert.equal(finalFailure.action.type, "open_test");
  assert.equal(finalFailure.message.role, "system");
  assert.match(finalFailure.message.content, /Тест сохранён, но provider не вернул финальный ответ/);
  assert.equal((await json("/api/tests")).tests.length, 3);

  const failure = await ask("provider-failure", 502);
  assert.equal(failure.error, "provider_request_failed");
  assert.equal((await json("/api/tests")).tests.length, 3);

  console.log("chat-tool-loop-check passed");
} finally {
  if (app) await stopChild(app);
  if (provider) await closeServer(provider);
  if (graph) await closeServer(graph);
  rmSync(tmp, { recursive: true, force: true });
}

async function ask(content, expectedStatus = 200) {
  const chat = await json("/api/assistant/chats", { method: "POST", body: { label: content } });
  await json(`/api/assistant/chats/${chat.chat.id}/messages`, { method: "POST", body: { role: "user", content } });
  return json("/api/assistant/respond", { method: "POST", body: { chatId: chat.chat.id } }, expectedStatus);
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

function testArguments(count) {
  return JSON.stringify({
    topic: "JavaScript",
    level: "средний",
    questions: Array.from({ length: count }, (_, index) => ({
      prompt: `Вопрос ${index + 1}`,
      options: ["Вариант A", "Вариант B", "Вариант C"],
      correctAnswer: index % 3,
      explanation: `Объяснение ${index + 1}`
    }))
  });
}

async function startProvider() {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    providerRequests.push({ path: req.url, body });
    const content = req.url === "/responses"
      ? JSON.stringify(body.input || "")
      : body.messages?.filter((message) => message.role === "user").at(-1)?.content || "";
    if (content.trim() === "provider-failure") return reply(res, 503, { error: { message: "provider down" } });
    const count = Number(content.match(/count=(\d+)/)?.[1] || 4);
    const memoryArguments = content.includes("remember-sensitive")
      ? JSON.stringify({ memories: [{ category: "preference", text: "OPENAI_API_KEY=must-not-save", subject: "user", relation: "prefers", object: "unsafe value" }] })
      : JSON.stringify({ memories: [
        { category: "preference", text: "Предпочитает сначала получать краткое объяснение.", subject: "user", relation: "prefers", object: "short explanations first" },
        { category: "skill", text: "Пока путает data leakage при валидации моделей.", subject: "user", relation: "struggles_with", object: "data leakage" }
      ] });
    if (req.url === "/responses") {
      if (body.input.some((item) => item.type === "function_call_output")) return reply(res, 200, { id: "response-final", output_text: "## Вопросы и правильные ответы\n\n1. Вопрос 1 — Вариант A\n\nОбъяснение 1" });
      if (content.includes("remember-autonomous") || content.includes("remember-sensitive")) return reply(res, 200, {
        id: `response-${providerRequests.length}`,
        output: [{ type: "function_call", call_id: `call-${providerRequests.length}`, name: "remember_context", arguments: memoryArguments }]
      });
      return reply(res, 200, {
        id: `response-${providerRequests.length}`,
        output: [{ type: "function_call", call_id: `call-${providerRequests.length}`, name: "create_test", arguments: testArguments(count) }]
      });
    }
    if (req.url === "/chat/completions") {
      const toolMessage = body.messages.find((message) => message.role === "tool");
      if (toolMessage && content.includes("final-provider-failure")) return reply(res, 503, { error: { message: "provider final down" } });
      if (toolMessage) return reply(res, 200, { choices: [{ message: { role: "assistant", content: content.includes("remember") ? "Контекст сохранён в Graph Memory." : "## Вопросы и правильные ответы\n\n1. Вопрос 1 — Вариант A\n\nОбъяснение 1" } }] });
      if (content.includes("remember-autonomous") || content.includes("remember-sensitive")) return reply(res, 200, {
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `call-${providerRequests.length}`, type: "function", function: { name: "remember_context", arguments: memoryArguments } }] } }]
      });
      return reply(res, 200, {
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `call-${providerRequests.length}`, type: "function", function: { name: "create_test", arguments: testArguments(count) } }] } }]
      });
    }
    return reply(res, 404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(providerPort, "127.0.0.1", resolve));
  return server;
}

async function startGraph() {
  const server = createServer(async (req, res) => {
    if (req.url === "/health") return reply(res, 200, { ok: true });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (req.url === "/memory/events") {
      graphEvents.push(body);
      return reply(res, 200, { ok: true, ingested: body.events?.length || 0 });
    }
    graphSearches.push(body);
    reply(res, 200, { ok: true, results: [{ fact: "Graph memory: путает lexical scope", uuid: "graph-1" }] });
  });
  await new Promise((resolve) => server.listen(graphPort, "127.0.0.1", resolve));
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
      OPENAI_API_KEY: "test-provider-key"
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
  await new Promise((resolve) => child.once("exit", resolve));
}
