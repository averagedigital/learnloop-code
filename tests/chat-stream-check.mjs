import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "codelearn-chat-stream-"));
const appPort = 49320;
const providerPort = 49321;
const providerRequests = [];
const providerCompleted = new Map();
const providerCancelled = new Set();
let app;
let provider;

try {
  provider = await startProvider();
  app = await startApp();

  await settings("openrouter");
  const chatReasoning = await streamAsk("chat-reasoning", (event) => {
    if (event.type === "text_delta" && event.delta === "Первый ") {
      assert.equal(providerCompleted.get("chat-reasoning"), undefined, "text must reach the client before provider completion");
    }
  });
  assert.deepEqual(chatReasoning.events.map((event) => event.type), ["reasoning_delta", "text_delta", "text_delta", "complete"]);
  assert.equal(chatReasoning.complete.message.content, "Первый потоковый ответ");
  assert.equal(chatReasoning.complete.message.reasoning, "Краткое обоснование.");

  const noReasoning = await streamAsk("chat-no-reasoning");
  assert.equal(noReasoning.events.some((event) => event.type === "reasoning_delta"), false);
  assert.equal(noReasoning.complete.message.reasoning, "");

  const chatTool = await streamAsk("tool-chat");
  assert.equal(chatTool.complete.action.type, "open_test");
  assert.equal(chatTool.complete.test.questions.length, 4);
  assert.match(chatTool.complete.message.content, /Streaming Chat Tool/);
  assert.doesNotMatch(chatTool.complete.message.content, /Скрытый правильный ответ/);
  const chatToolFollowup = providerRequests.find((request) => request.path === "/chat/completions" && request.body.messages?.some((message) => message.role === "tool"));
  assert.ok(chatToolFollowup, "chat tool output must be returned to the provider");
  assert.equal(JSON.parse(chatToolFollowup.body.messages.find((message) => message.role === "tool").content).ok, true);

  await settings("openai");
  const responsesReasoning = await streamAsk("responses-reasoning", (event) => {
    if (event.type === "text_delta" && event.delta === "Responses ") {
      assert.equal(providerCompleted.get("responses-reasoning"), undefined, "Responses delta must arrive before completion");
    }
  });
  assert.equal(responsesReasoning.complete.message.content, "Responses поток работает");
  assert.equal(responsesReasoning.complete.message.reasoning, "Публичное summary.");

  const responsesTool = await streamAsk("tool-responses");
  assert.equal(responsesTool.complete.action.type, "open_test");
  assert.equal(responsesTool.complete.test.questions.length, 4);
  assert.match(responsesTool.complete.message.content, /Streaming Responses Tool/);
  assert.doesNotMatch(responsesTool.complete.message.content, /Скрытый правильный ответ/);
  const responsesToolFollowup = providerRequests.find((request) => request.path === "/responses" && request.body.input?.some((item) => item.type === "function_call_output"));
  assert.ok(responsesToolFollowup, "Responses tool output must be returned to the provider");

  const failed = await streamAsk("provider-stream-failure", undefined, 200);
  assert.equal(failed.events.at(-1).type, "error");
  assert.equal(failed.events.at(-1).error, "provider_request_failed");
  assert.equal(failed.events.some((event) => event.type === "complete"), false);

  await settings("openrouter");
  const cancelledChat = await createChat("cancel-stream");
  const controller = new AbortController();
  await assert.rejects(
    collectStream(cancelledChat.id, (event) => {
      if (event.type === "text_delta") controller.abort();
    }, controller.signal),
    (error) => error?.name === "AbortError"
  );
  await delay(80);
  assert.equal(providerCancelled.has("cancel-stream"), true);

  const chats = await json("/api/assistant/chats");
  const savedReasoning = chats.chats.find((chat) => chat.id === chatReasoning.chat.id);
  assert.equal(savedReasoning.messages.filter((message) => message.role === "assistant").length, 1, "completed stream must persist once");
  assert.equal(savedReasoning.messages.find((message) => message.content === "Первый потоковый ответ").reasoning, "Краткое обоснование.");
  const failedSaved = chats.chats.find((chat) => chat.id === failed.chat.id);
  assert.deepEqual(failedSaved.messages.map((message) => message.role), ["user"], "failed partial response must not persist");
  const cancelledSaved = chats.chats.find((chat) => chat.id === cancelledChat.id);
  assert.deepEqual(cancelledSaved.messages.map((message) => message.role), ["user"], "cancelled partial response must not persist");

  console.log("chat-stream-check passed");
} finally {
  if (app) await stopChild(app);
  if (provider) await closeServer(provider);
  rmSync(tmp, { recursive: true, force: true });
}

async function settings(providerId) {
  return json("/api/settings", {
    method: "PATCH",
    body: {
      providerId,
      providerBaseUrl: `http://127.0.0.1:${providerPort}`,
      providerModel: "test-model"
    }
  });
}

async function streamAsk(content, onEvent, expectedStatus = 200) {
  const chat = await createChat(content);
  const events = await collectStream(chat.id, onEvent, undefined, expectedStatus);
  return { chat, events, complete: events.find((event) => event.type === "complete") };
}

async function createChat(content) {
  const created = await json("/api/assistant/chats", { method: "POST", body: { label: content } });
  await json(`/api/assistant/chats/${created.chat.id}/messages`, { method: "POST", body: { role: "user", content } });
  return created.chat;
}

async function collectStream(chatId, onEvent, signal, expectedStatus = 200) {
  const response = await fetch(`http://127.0.0.1:${appPort}/api/assistant/respond/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ chatId }),
    signal
  });
  assert.equal(response.status, expectedStatus);
  assert.match(response.headers.get("content-type") || "", /^text\/event-stream/);
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      const event = JSON.parse(data);
      events.push(event);
      onEvent?.(event);
    }
    if (done) break;
  }
  return events;
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

function toolArguments(topic) {
  return JSON.stringify({
    topic,
    level: "средний",
    questions: Array.from({ length: 4 }, (_, index) => ({
      prompt: `Вопрос ${index + 1}`,
      options: ["A", "B"],
      correctAnswer: index % 2,
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
      ? body.input?.filter((item) => item.role === "user").at(-1)?.content || ""
      : body.messages?.filter((message) => message.role === "user").at(-1)?.content || "";

    if (content === "provider-stream-failure") return reply(res, 503, { error: { message: "provider down" } });
    if (req.url === "/chat/completions") return streamChat(res, body, content);
    if (req.url === "/responses") return streamResponses(res, body, content);
    return reply(res, 404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(providerPort, "127.0.0.1", resolve));
  return server;
}

async function streamChat(res, body, content) {
  assert.equal(body.stream, true);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const toolOutput = body.messages?.some((message) => message.role === "tool");

  if (content === "cancel-stream") {
    res.once("close", () => providerCancelled.add(content));
    send({ choices: [{ delta: { content: "частичный" } }] });
    await Promise.race([once(res, "close"), delay(500)]);
    if (!res.destroyed) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
    return;
  }
  if (content === "tool-chat" && !toolOutput) {
    const args = toolArguments("Streaming Chat Tool");
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "chat-call", type: "function", function: { name: "create_test", arguments: args.slice(0, 37) } }] } }] });
    send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(37, 91) } }] } }] });
    send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(91) } }] }, finish_reason: "tool_calls" }] });
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  if (toolOutput) {
    send({ choices: [{ delta: { content: "Скрытый правильный ответ" } }] });
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  if (content === "chat-reasoning") send({ choices: [{ delta: { reasoning: "Краткое обоснование." } }] });
  send({ choices: [{ delta: { content: "Первый " } }] });
  await delay(60);
  send({ choices: [{ delta: { content: content === "chat-no-reasoning" ? "ответ без reasoning" : "потоковый ответ" } }] });
  providerCompleted.set(content, true);
  res.write("data: [DONE]\n\n");
  res.end();
}

async function streamResponses(res, body, content) {
  assert.equal(body.stream, true);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const toolOutput = body.input?.some((item) => item.type === "function_call_output");
  if (content === "tool-responses" && !toolOutput) {
    const args = toolArguments("Streaming Responses Tool");
    send("response.output_item.added", { output_index: 0, item: { id: "item-1", type: "function_call", call_id: "responses-call", name: "create_test", arguments: "" } });
    send("response.function_call_arguments.delta", { item_id: "item-1", output_index: 0, delta: args.slice(0, 43) });
    send("response.function_call_arguments.delta", { item_id: "item-1", output_index: 0, delta: args.slice(43) });
    send("response.output_item.done", { output_index: 0, item: { id: "item-1", type: "function_call", call_id: "responses-call", name: "create_test", arguments: args } });
    send("response.completed", { response: { id: "response-tool", output: [] } });
    return res.end();
  }
  if (toolOutput) {
    send("response.output_text.delta", { delta: "Скрытый правильный ответ" });
    send("response.completed", { response: { id: "response-final", output: [] } });
    return res.end();
  }
  if (content === "responses-reasoning") send("response.reasoning_summary_text.delta", { delta: "Публичное summary." });
  send("response.output_text.delta", { delta: "Responses " });
  await delay(60);
  send("response.output_text.delta", { delta: "поток работает" });
  providerCompleted.set(content, true);
  send("response.completed", { response: { id: "response-direct", output: [] } });
  res.end();
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
    await delay(20);
  }
  return child;
}

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function stopChild(child) {
  child.kill("SIGTERM");
  await once(child, "exit");
}
