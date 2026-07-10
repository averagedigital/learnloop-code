import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, readFile, writeFile, mkdir, readdir, lstat, realpath } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { modelControlPrompt, providers, toolsForProvider } from "./src/platform.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const staticRoot = normalize(join(root, "dist"));
const envPath = process.env.CODELEARN_ENV_PATH || join(root, ".env");
try {
  process.loadEnvFile?.(envPath);
} catch {
  // Local installs may start before .env exists; settings can create it later.
}
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const personalityPath = process.env.PERSONALITY_PATH || "/data/personality.md";
const dbPath = process.env.CODELEARN_DB_PATH || join(root, "data/codelearn.sqlite");
const workspaceRoot = normalize(process.env.CODELEARN_WORKSPACE_ROOT || join(root, "workspace"));
const providerEnv = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  yandex: "YANDEX_AI_STUDIO_API_KEY"
};
const providerEnvNames = new Set(Object.values(providerEnv));
const providerHeaderEnvNames = new Set(["YANDEX_AI_STUDIO_FOLDER_ID"]);
const graphProviderEnv = {
  openai: "GRAPH_OPENAI_API_KEY",
  openrouter: "GRAPH_OPENROUTER_API_KEY",
  yandex: "GRAPH_YANDEX_AI_STUDIO_API_KEY"
};
const graphSettingEnv = {
  graphEmbeddingProvider: "GRAPH_EMBEDDING_PROVIDER",
  graphEmbeddingBaseUrl: "GRAPH_EMBEDDING_BASE_URL",
  graphEmbeddingModel: "GRAPH_EMBEDDING_MODEL",
  graphEmbeddingDim: "GRAPH_EMBEDDING_DIM"
};
const runtimeComposeArgs = ["compose", "-f", "docker-compose.workspace.yml", "up", "-d", "--build", "code-server", "openhands", "falkordb", "graph-memory"];
const mascotIds = new Set(["organic_spiky_concept", "05_laptop_spiky"]);
const memoryEventKinds = new Set(["coding_habit", "weak_topic", "strong_topic", "skill_observation", "response_preference", "project_reference"]);
const autonomousMemoryKinds = {
  preference: "response_preference",
  skill: "skill_observation",
  project: "project_reference",
  habit: "coding_habit"
};
const memoryEventSources = new Set(["manual", "task_run", "assistant_chat", "progress_pipeline", "studio_import"]);
let db;
let runtimeStartInProgress = false;

class InvalidJsonError extends Error {
  constructor() {
    super("invalid_json");
    this.name = "InvalidJsonError";
  }
}

await initDatabase();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/app-state") return await appState(req, res);
    if (req.method === "POST" && url.pathname === "/api/lessons") return await importLesson(req, res);
    if (req.method === "GET" && url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/log")) return await taskLog(req, res, url);
    if (req.method === "POST" && url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/runs")) return await taskRun(req, res, url);
    if (url.pathname.startsWith("/api/workspace/tasks/") && url.pathname.includes("/agent/files")) return await workspaceAgentFiles(req, res, url);
    if (req.method === "POST" && url.pathname.startsWith("/api/workspace/tasks/") && url.pathname.endsWith("/agent/run")) return await workspaceAgentRun(req, res, url);
    if (req.method === "GET" && url.pathname.startsWith("/api/workspace/tasks/") && url.pathname.endsWith("/files")) return await workspaceFiles(req, res, url);
    if (req.method === "GET" && url.pathname.startsWith("/api/workspace/tasks/") && url.pathname.includes("/files/")) return await workspaceFileContent(req, res, url);
    if (req.method === "PATCH" && url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/progress")) return await taskProgress(req, res, url);
    if (url.pathname === "/api/progress/pipeline") return await progressPipeline(req, res);
    if (req.method === "PATCH" && url.pathname.startsWith("/api/memory/events/")) return await memoryEventReview(req, res, url);
    if (url.pathname === "/api/memory/events") return await memoryEvents(req, res);
    if (req.method === "GET" && url.pathname === "/api/memory/graph-health") return await graphMemoryHealth(req, res);
    if (req.method === "GET" && url.pathname === "/api/memory/graph-items") return await graphMemoryItems(req, res);
    if (req.method === "POST" && url.pathname === "/api/memory/graph-sync") return await graphMemorySync(req, res);
    if (req.method === "POST" && url.pathname === "/api/memory/graph-search") return await graphMemorySearch(req, res);
    if (url.pathname === "/api/assistant/chats") return await assistantChats(req, res);
    if (req.method === "POST" && url.pathname.startsWith("/api/assistant/chats/") && url.pathname.endsWith("/messages")) return await assistantChatMessage(req, res, url);
    if (req.method === "POST" && url.pathname === "/api/assistant/respond") return await assistantRespond(req, res);
    if (req.method === "GET" && url.pathname === "/api/tests") return await quizTests(req, res);
    if (req.method === "POST" && url.pathname.startsWith("/api/tests/") && url.pathname.endsWith("/attempts")) return await quizAttempt(req, res, url);
    if (req.method === "GET" && url.pathname.startsWith("/api/tests/")) return await quizTest(req, res, url);
    if (req.method === "PATCH" && url.pathname === "/api/settings") return await appSettings(req, res);
    if (req.method === "GET" && url.pathname === "/api/runtime/health") return await runtimeHealth(req, res);
    if (req.method === "POST" && url.pathname === "/api/runtime/start") return await runtimeStart(req, res);
    if (req.method === "POST" && url.pathname === "/api/execute") return await executeCode(req, res);
    if (req.method === "POST" && url.pathname === "/api/models") return await listModels(req, res);
    if (req.method === "POST" && url.pathname === "/api/responses") return await proxyAi(req, res);
    if (url.pathname === "/api/personality") return await personality(req, res);
    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "api_not_found" });
    return serveStatic(url.pathname, res);
  } catch (error) {
    if (error?.name === "InvalidJsonError") return sendJson(res, 400, { error: "invalid_json" });
    sendJson(res, 500, { error: "internal_error", message: error.message });
  }
}).listen(port, host, () => {
  console.log(`CodeLearn listening on ${host}:${port}`);
});

async function initDatabase() {
  await mkdir(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      level TEXT NOT NULL,
      objective TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      starter_code TEXT NOT NULL,
      hidden_summary TEXT NOT NULL,
      topic TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      status TEXT NOT NULL,
      minutes INTEGER NOT NULL CHECK (minutes > 0),
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS public_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind = 'python_assert'),
      message TEXT NOT NULL,
      code TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_progress (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      hint_index INTEGER NOT NULL DEFAULT 0 CHECK (hint_index >= 0),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      final_result TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_pipelines (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      steps TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      evidence TEXT NOT NULL,
      review_status TEXT NOT NULL CHECK (review_status IN ('pending', 'accepted', 'rejected')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retrieved_memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      evidence TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS graph_synced_memory_events (
      event_id TEXT PRIMARY KEY REFERENCES memory_events(id) ON DELETE CASCADE,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assistant_chats (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assistant_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL REFERENCES assistant_chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_tests (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      level TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id TEXT NOT NULL REFERENCES quiz_tests(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      options TEXT NOT NULL,
      correct_answer INTEGER NOT NULL CHECK (correct_answer >= 0),
      explanation TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES quiz_tests(id) ON DELETE CASCADE,
      answers TEXT NOT NULL,
      correct_count INTEGER NOT NULL CHECK (correct_count >= 0),
      total_count INTEGER NOT NULL CHECK (total_count >= 4 AND total_count <= 15),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  if (!db.prepare("PRAGMA table_info(assistant_messages)").all().some((column) => column.name === "action")) {
    db.exec("ALTER TABLE assistant_messages ADD COLUMN action TEXT NOT NULL DEFAULT ''");
  }

  if (process.env.CODELEARN_SEED_DEV_DATA === "true" && scalar("SELECT COUNT(*) FROM lessons") === 0) {
    seedDevData();
  }
}

function seedDevData() {
  const now = new Date().toISOString();
  const lesson = devLesson();
  const insertLesson = db.prepare("INSERT INTO lessons (id, title, topic, level, objective, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const insertTask = db.prepare(`INSERT INTO tasks
    (id, lesson_id, title, prompt, starter_code, hidden_summary, topic, difficulty, status, minutes, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertCheck = db.prepare("INSERT INTO public_checks (task_id, kind, message, code, position) VALUES (?, ?, ?, ?, ?)");
  const insertHint = db.prepare("INSERT INTO hints (task_id, text, position) VALUES (?, ?, ?)");
  const insertProgress = db.prepare("INSERT INTO task_progress (task_id, code, hint_index, updated_at) VALUES (?, ?, 0, ?)");
  db.exec("BEGIN");
  try {
    insertLesson.run(lesson.id, lesson.title, lesson.topic, lesson.level, lesson.objective, now);
    lesson.tasks.forEach((task, index) => {
      insertTask.run(task.id, lesson.id, task.title, task.prompt, task.starterCode, task.hiddenSummary, task.topic, task.difficulty, task.status, task.minutes, index, now, now);
      task.publicChecks.forEach((check, checkIndex) => insertCheck.run(task.id, check.kind, check.message, check.code, checkIndex));
      task.hints.forEach((hint, hintIndex) => insertHint.run(task.id, hint, hintIndex));
      insertProgress.run(task.id, task.starterCode, now);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function importLesson(req, res) {
  const body = await readJson(req);
  const spec = body.lesson && typeof body.lesson === "object" ? body.lesson : body;
  const errors = validateLessonSpec(spec);
  if (errors.length) return sendJson(res, 400, { error: "invalid_lesson_spec", details: errors });
  const sourcePrompt = String(body.sourcePrompt || "").trim();
  const llmAnswer = String(body.llmAnswer || "").trim();
  const now = new Date().toISOString();
  const lessonId = uniqueId("lesson", spec.id || spec.title);
  const insertLesson = db.prepare("INSERT INTO lessons (id, title, topic, level, objective, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const insertTask = db.prepare(`INSERT INTO tasks
    (id, lesson_id, title, prompt, starter_code, hidden_summary, topic, difficulty, status, minutes, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertCheck = db.prepare("INSERT INTO public_checks (task_id, kind, message, code, position) VALUES (?, ?, ?, ?, ?)");
  const insertHint = db.prepare("INSERT INTO hints (task_id, text, position) VALUES (?, ?, ?)");
  const insertProgress = db.prepare("INSERT INTO task_progress (task_id, code, hint_index, updated_at) VALUES (?, ?, 0, ?)");
  const insertRun = db.prepare("INSERT INTO task_runs (id, task_id, status, final_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  const insertRunMessage = db.prepare("INSERT INTO run_messages (run_id, role, content, position, created_at) VALUES (?, ?, ?, ?, ?)");
  const insertMemoryEvent = db.prepare("INSERT INTO memory_events (id, kind, text, source, evidence, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const taskIds = [];
  db.exec("BEGIN");
  try {
    insertLesson.run(lessonId, spec.title.trim(), spec.topic.trim(), spec.level.trim(), spec.objective.trim(), now);
    spec.tasks.forEach((task, index) => {
      const taskId = uniqueId("task", task.id);
      taskIds.push(taskId);
      insertTask.run(taskId, lessonId, task.title.trim(), task.prompt.trim(), task.starterCode, task.hiddenSummary.trim(), (task.topic || spec.topic).trim(), task.difficulty || spec.difficulty || "легкая", task.status || "в работе", Number(task.minutes || 20), index, now, now);
      task.publicChecks.forEach((check, checkIndex) => insertCheck.run(taskId, check.kind, check.message || "Проверка", check.code, checkIndex));
      task.hints.forEach((hint, hintIndex) => insertHint.run(taskId, String(hint), hintIndex));
      insertProgress.run(taskId, task.starterCode, now);
      if (sourcePrompt || llmAnswer) {
        const runId = crypto.randomUUID();
        insertRun.run(runId, taskId, "assigned", "ТЗ импортировано из Session", now, now);
        if (sourcePrompt) insertRunMessage.run(runId, "user", sourcePrompt, 0, now);
        if (llmAnswer) insertRunMessage.run(runId, "assistant", llmAnswer, 1, now);
      }
    });
    const memoryCandidate = memoryCandidateFromSessionImport(lessonId, spec, taskIds, sourcePrompt, llmAnswer);
    if (memoryCandidate && !containsSensitiveData(memoryCandidate.text)) {
      insertMemoryEvent.run(crypto.randomUUID(), memoryCandidate.kind, memoryCandidate.text, "studio_import", JSON.stringify(memoryCandidate.evidence), "pending", now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const lesson = readCurrentLesson();
  await Promise.all(lesson.tasks.map((task) => writeWorkspaceFiles(task.id)));
  await Promise.all(lesson.tasks.map((task, index) => writeImportedWorkspaceFiles(task.id, spec.tasks[index]?.files || [])));
  sendJson(res, 200, { ok: true, lesson });
}

function memoryCandidateFromSessionImport(lessonId, spec, taskIds, sourcePrompt, llmAnswer) {
  if (!sourcePrompt && !llmAnswer) return null;
  return {
    kind: "project_reference",
    text: `Session import: ${spec.title.trim()} — ${spec.objective.trim()}`.slice(0, 5000),
    evidence: { lessonId, topic: spec.topic.trim(), taskIds, hasSourcePrompt: Boolean(sourcePrompt), hasLlmAnswer: Boolean(llmAnswer) }
  };
}

async function writeImportedWorkspaceFiles(taskId, files) {
  for (const file of files) {
    const target = safeWorkspaceFilePath(taskId, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
}

function devLesson() {
  return {
    id: "pandas-feature-engineering",
    title: "Мини-практика по признакам в pandas",
    topic: "pandas feature engineering для ML",
    level: "средний",
    objective: "Потренироваться превращать сырые табличные поля в проверяемые признаки для модели.",
    tasks: [
      {
        id: "fill-and-flag",
        title: "Заполнить пропуски возраста",
        prompt: "Реализуй prepare_features(df). Заполни пропуски age медианой и добавь age_was_missing со значениями 0/1.",
        starterCode: `import pandas as pd

def prepare_features(df: pd.DataFrame) -> pd.DataFrame:
    return df.copy()
`,
        publicChecks: [
          { kind: "python_assert", message: "Функция prepare_features должна существовать.", code: "assert callable(prepare_features)" },
          { kind: "python_assert", message: "Пропуски age заполняются медианой.", code: "import pandas as pd\\ndf = pd.DataFrame({'age': [10.0, None, 30.0]})\\nout = prepare_features(df)\\nassert out['age'].tolist() == [10.0, 20.0, 30.0]" },
          { kind: "python_assert", message: "Добавляется индикатор пропуска age_was_missing.", code: "import pandas as pd\\ndf = pd.DataFrame({'age': [10.0, None, 30.0]})\\nout = prepare_features(df)\\nassert out['age_was_missing'].tolist() == [0, 1, 0]" }
        ],
        hiddenSummary: "Скрытые проверки валидируют, что строки не теряются и набор колонок стабилен.",
        hints: ["Создай флаг пропуска до заполнения значений.", "Бери медиану из входного датафрейма.", "Верни новый датафрейм, не меняй объект вызывающего кода."],
        difficulty: "средняя",
        status: "в работе",
        minutes: 18,
        topic: "pandas"
      },
      seedQueueTask("fastapi-validation", "Проверить входной JSON", "FastAPI", "легкая", "следующая", 14),
      seedQueueTask("sql-window", "Найти повторные покупки", "SQL", "средняя", "в журнале", 24),
      seedQueueTask("metric-drift", "Поймать drift метрики", "ML", "сложная", "разбор", 32)
    ]
  };
}

function seedQueueTask(id, title, topic, difficulty, status, minutes) {
  return {
    id,
    title,
    topic,
    difficulty,
    status,
    minutes,
    prompt: `Короткая практика: ${title}.`,
    starterCode: "",
    publicChecks: [{ kind: "python_assert", message: "Добавьте реализацию.", code: "assert True" }],
    hiddenSummary: "Скрытые проверки будут добавлены при генерации полноценного задания.",
    hints: ["Сформулируйте минимальный контракт.", "Покройте граничный случай.", "Проверьте результат наблюдаемым assert."]
  };
}

async function appState(_req, res) {
  sendJson(res, 200, {
    lesson: readCurrentLesson(),
    tasks: readTaskQueue(),
    taskLogs: readTaskLogs(),
    progress: readProgress(),
    memory: readRetrievedMemory(),
    memoryEvents: readMemoryEvents(),
    memoryReviewQueue: readMemoryEvents("pending"),
    retrievedMemory: readRetrievedMemory(),
    skillGraph: readSkillGraph(),
    assistantChats: readAssistantChats(),
    quizAttempts: readQuizAttempts(),
    learningPipeline: readLearningPipeline(),
    providerStatus: readProviderStatus(),
    settings: readSettings()
  });
}

async function taskProgress(req, res, url) {
  const taskId = decodeURIComponent(url.pathname.slice("/api/tasks/".length, -"/progress".length));
  if (!db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) return sendJson(res, 404, { error: "task_not_found" });
  const body = await readJson(req);
  const current = db.prepare("SELECT code, hint_index AS hintIndex FROM task_progress WHERE task_id = ?").get(taskId) || {};
  if (body.code !== undefined && typeof body.code !== "string") return sendJson(res, 400, { error: "invalid_progress_code" });
  const code = body.code === undefined ? String(current.code || "") : body.code;
  const hintIndex = body.hintIndex === undefined ? Number(current.hintIndex || 0) : Number(body.hintIndex);
  if (!Number.isInteger(hintIndex) || hintIndex < 0) return sendJson(res, 400, { error: "invalid_hint_index" });
  const updatedAt = new Date().toISOString();
  db.prepare(`INSERT INTO task_progress (task_id, code, hint_index, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET code = excluded.code, hint_index = excluded.hint_index, updated_at = excluded.updated_at`)
    .run(taskId, code, hintIndex, updatedAt);
  await writeWorkspaceFiles(taskId, { overwriteSolution: true });
  sendJson(res, 200, { ok: true, progress: { taskId, code, hintIndex, updatedAt } });
}

async function appSettings(req, res) {
  const allowed = new Set([
    "providerId",
    "providerBaseUrl",
    "providerModel",
    "profileName",
    "mascotId",
    "mascotAssistantSettings",
    "workspaceRuntime",
    "workspaceRuntimeUrl",
    "agentRuntimeUrl",
    "graphMemoryUrl",
    ...Object.keys(graphSettingEnv),
    "sandboxCpuTimeSec",
    "sandboxMemoryMb"
  ]);
  const body = await readJson(req);
  if (body.profileName !== undefined && (typeof body.profileName !== "string" || body.profileName.trim().length < 2 || body.profileName.trim().length > 80 || hasLineBreak(body.profileName))) {
    return sendJson(res, 400, { error: "invalid_profile_name" });
  }
  if (body.providerId !== undefined && !providerEnv[String(body.providerId || "")]) return sendJson(res, 400, { error: "invalid_provider_id" });
  if (body.mascotId !== undefined && !mascotIds.has(String(body.mascotId))) return sendJson(res, 400, { error: "invalid_mascot_id" });
  if (body.mascotAssistantSettings !== undefined && !validMascotSettings(body.mascotAssistantSettings)) return sendJson(res, 400, { error: "invalid_mascot_settings" });
  if (body.providerBaseUrl !== undefined && String(body.providerBaseUrl).trim() && !httpServiceUrl(body.providerBaseUrl)) return sendJson(res, 400, { error: "invalid_provider_url" });
  if (body.workspaceRuntime !== undefined && !["code-server", "openvscode-server"].includes(String(body.workspaceRuntime))) return sendJson(res, 400, { error: "invalid_workspace_runtime" });
  if (body.workspaceRuntimeUrl !== undefined && String(body.workspaceRuntimeUrl).trim() && !httpServiceUrl(body.workspaceRuntimeUrl)) return sendJson(res, 400, { error: "invalid_workspace_runtime_url" });
  if (body.agentRuntimeUrl !== undefined && String(body.agentRuntimeUrl).trim() && !httpServiceUrl(body.agentRuntimeUrl)) return sendJson(res, 400, { error: "invalid_agent_runtime_url" });
  if (body.graphMemoryUrl !== undefined && String(body.graphMemoryUrl).trim() && !httpServiceUrl(body.graphMemoryUrl)) return sendJson(res, 400, { error: "invalid_graph_memory_url" });
  if (body.graphEmbeddingProvider !== undefined && !["auto", ...Object.keys(graphProviderEnv)].includes(String(body.graphEmbeddingProvider))) return sendJson(res, 400, { error: "invalid_graph_embedding_provider" });
  if (body.graphEmbeddingBaseUrl !== undefined && String(body.graphEmbeddingBaseUrl).trim() && !httpServiceUrl(body.graphEmbeddingBaseUrl)) return sendJson(res, 400, { error: "invalid_graph_embedding_url" });
  for (const key of ["graphEmbeddingModel"]) {
    if (body[key] !== undefined && !validGraphTextSetting(body[key])) return sendJson(res, 400, { error: `invalid_${key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)}` });
  }
  if (body.graphEmbeddingDim !== undefined && !boundedIntegerSetting(body.graphEmbeddingDim, 1, 8192)) return sendJson(res, 400, { error: "invalid_graph_embedding_dim" });
  if (body.sandboxCpuTimeSec !== undefined && !positiveSetting(body.sandboxCpuTimeSec, 1)) return sendJson(res, 400, { error: "invalid_sandbox_cpu_time" });
  if (body.sandboxMemoryMb !== undefined && !positiveSetting(body.sandboxMemoryMb, 64)) return sendJson(res, 400, { error: "invalid_sandbox_memory" });
  if (body.providerApiKeys !== undefined && (!body.providerApiKeys || typeof body.providerApiKeys !== "object" || Array.isArray(body.providerApiKeys))) return sendJson(res, 400, { error: "invalid_provider_api_keys" });
  if (body.providerApiKeys) {
    for (const [providerId, key] of Object.entries(body.providerApiKeys)) {
      if (!providerEnv[providerId]) return sendJson(res, 400, { error: "invalid_provider_id" });
      if (!validSecretInput(key)) return sendJson(res, 400, { error: "invalid_secret_value" });
    }
  }
  if (body.yandexFolderId !== undefined && !validSecretInput(body.yandexFolderId)) return sendJson(res, 400, { error: "invalid_secret_value" });
  if (body.graphApiKey !== undefined && !validSecretInput(body.graphApiKey)) return sendJson(res, 400, { error: "invalid_secret_value" });
  if (body.graphYandexFolderId !== undefined && !validSecretInput(body.graphYandexFolderId)) return sendJson(res, 400, { error: "invalid_secret_value" });
  const effectiveGraphProvider = String(body.graphEmbeddingProvider || readSetting("graphEmbeddingProvider") || readSetting("graphProvider") || process.env.GRAPH_EMBEDDING_PROVIDER || process.env.GRAPHITI_LLM_PROVIDER || "openrouter");
  if (String(body.graphApiKey || "").trim() && !graphProviderEnv[effectiveGraphProvider]) return sendJson(res, 400, { error: "graph_provider_required_for_key" });
  const yandexFolderId = String(body.yandexFolderId || "").trim();
  const updated = {};
  const stmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) continue;
    updated[key] = key === "profileName" ? String(value).trim() : String(value);
    stmt.run(key, updated[key]);
  }
  if (body.providerApiKeys) {
    for (const [providerId, key] of Object.entries(body.providerApiKeys)) {
      const envName = providerEnv[providerId];
      const value = String(key || "").trim();
      if (value) await writeEnvValue(envName, value);
    }
  }
  if (yandexFolderId) await writeEnvValue("YANDEX_AI_STUDIO_FOLDER_ID", yandexFolderId);
  for (const [key, envName] of Object.entries(graphSettingEnv)) {
    if (body[key] !== undefined) await writeEnvValue(envName, String(body[key]).trim());
  }
  const graphApiKey = String(body.graphApiKey || "").trim();
  if (graphApiKey) await writeEnvValue(graphProviderEnv[effectiveGraphProvider], graphApiKey);
  const graphYandexFolderId = String(body.graphYandexFolderId || "").trim();
  if (graphYandexFolderId) await writeEnvValue("GRAPH_YANDEX_AI_STUDIO_FOLDER_ID", graphYandexFolderId);
  sendJson(res, 200, { ok: true, settings: updated, providerStatus: readProviderStatus() });
}

function validGraphTextSetting(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 300 && !hasLineBreak(value);
}

function validMascotSettings(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (text.length > 2000) return false;
  try {
    const settings = JSON.parse(text);
    return Boolean(settings && typeof settings === "object" && !Array.isArray(settings));
  } catch {
    return false;
  }
}

function readCurrentLesson() {
  const lesson = db.prepare("SELECT * FROM lessons ORDER BY created_at DESC, id DESC LIMIT 1").get();
  if (!lesson) return null;
  return {
    id: lesson.id,
    title: lesson.title,
    topic: lesson.topic,
    level: lesson.level,
    objective: lesson.objective,
    tasks: db.prepare("SELECT * FROM tasks WHERE lesson_id = ? ORDER BY position").all(lesson.id).map(readTaskDetails)
  };
}

function validateLessonSpec(spec) {
  if (!spec || typeof spec !== "object") return ["lesson must be an object"];
  const errors = [];
  for (const key of ["title", "topic", "level", "objective"]) {
    if (typeof spec[key] !== "string" || !spec[key].trim()) errors.push(`${key} is required`);
  }
  if (tooLong(spec.title, 200)) errors.push("title is too large");
  if (tooLong(spec.topic, 200)) errors.push("topic is too large");
  if (tooLong(spec.level, 80)) errors.push("level is too large");
  if (tooLong(spec.objective, 2000)) errors.push("objective is too large");
  if (!Array.isArray(spec.tasks) || spec.tasks.length === 0) return [...errors, "tasks must not be empty"];
  if (spec.tasks.length > 20) errors.push("tasks must not exceed 20");
  spec.tasks.forEach((task, index) => {
    for (const key of ["id", "title", "prompt", "starterCode", "hiddenSummary"]) {
      if (typeof task?.[key] !== "string" || !task[key].trim()) errors.push(`tasks[${index}].${key} is required`);
    }
    if (tooLong(task?.id, 120)) errors.push(`tasks[${index}].id is too large`);
    if (tooLong(task?.title, 200)) errors.push(`tasks[${index}].title is too large`);
    if (tooLong(task?.prompt, 10000)) errors.push(`tasks[${index}].prompt is too large`);
    if (tooLong(task?.starterCode, 20000)) errors.push(`tasks[${index}].starterCode is too large`);
    if (tooLong(task?.hiddenSummary, 4000)) errors.push(`tasks[${index}].hiddenSummary is too large`);
    if (!Array.isArray(task?.publicChecks) || task.publicChecks.length === 0) errors.push(`tasks[${index}].publicChecks is required`);
    if (!Array.isArray(task?.hints) || task.hints.length === 0) errors.push(`tasks[${index}].hints is required`);
    if (Array.isArray(task?.publicChecks) && task.publicChecks.length > 50) errors.push(`tasks[${index}].publicChecks must not exceed 50`);
    if (Array.isArray(task?.hints) && task.hints.length > 20) errors.push(`tasks[${index}].hints must not exceed 20`);
    if (Array.isArray(task?.files) && task.files.length > 50) errors.push(`tasks[${index}].files must not exceed 50`);
    for (const check of task?.publicChecks || []) {
      if (check.kind !== "python_assert") errors.push(`tasks[${index}].publicChecks only supports python_assert`);
      if (typeof check.code !== "string" || !check.code.trim()) errors.push(`tasks[${index}].publicChecks.code is required`);
      if (tooLong(check.code, 4000)) errors.push(`tasks[${index}].publicChecks.code is too large`);
      if (tooLong(check.message, 400)) errors.push(`tasks[${index}].publicChecks.message is too large`);
    }
    for (const hint of task?.hints || []) {
      if (tooLong(hint, 1000)) errors.push(`tasks[${index}].hints item is too large`);
    }
    for (const file of task?.files || []) {
      if (typeof file.path !== "string" || !file.path.trim()) errors.push(`tasks[${index}].files.path is required`);
      if (file.path?.startsWith("/") || file.path?.includes("..")) errors.push(`tasks[${index}].files.path must be a safe relative path`);
      if (workspaceFileNames().includes(file.path)) errors.push(`tasks[${index}].files.path must not replace workspace system files`);
      if (typeof file.content !== "string") errors.push(`tasks[${index}].files.content is required`);
      if (typeof file.content === "string" && file.content.length > 200000) errors.push(`tasks[${index}].files.content is too large`);
    }
  });
  return errors;
}

function tooLong(value, max) {
  return typeof value === "string" && value.length > max;
}

function uniqueId(prefix, value) {
  const base = String(value || prefix).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || prefix;
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function readTaskQueue() {
  return db.prepare("SELECT id, title, topic, difficulty, status, minutes, created_at AS createdAt, updated_at AS updatedAt FROM tasks ORDER BY position").all();
}

function readTaskLogs() {
  return db.prepare(`
    SELECT t.id, t.title, t.topic, t.difficulty, t.status, t.minutes, t.created_at AS createdAt, t.updated_at AS updatedAt,
      p.updated_at AS progressUpdatedAt,
      r.status AS runStatus,
      r.final_result AS finalResult,
      r.updated_at AS runUpdatedAt
    FROM tasks t
    LEFT JOIN task_progress p ON p.task_id = t.id
    LEFT JOIN task_runs r ON r.id = (
      SELECT id FROM task_runs WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    ORDER BY t.position
  `).all().map((task, index) => ({
    id: task.id,
    label: `Задание ${index + 1} ${statusWord(task.runStatus || task.status)}`,
    title: task.title,
    topic: task.topic,
    difficulty: task.difficulty,
    status: task.runStatus || task.status,
    finalResult: task.finalResult || "",
    minutes: task.minutes,
    createdAt: task.createdAt,
    updatedAt: task.runUpdatedAt || task.progressUpdatedAt || task.updatedAt
  }));
}

async function taskLog(_req, res, url) {
  const taskId = decodeURIComponent(url.pathname.slice("/api/tasks/".length, -"/log".length));
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return sendJson(res, 404, { error: "task_not_found" });
  const details = readTaskDetails(task);
  const progress = db.prepare("SELECT code, hint_index AS hintIndex, updated_at AS updatedAt FROM task_progress WHERE task_id = ?").get(taskId);
  const run = readLatestTaskRun(taskId);
  const messages = readTaskRunMessages(taskId);
  sendJson(res, 200, {
    task: details,
    assignedMarkdown: taskMarkdown(details),
    userCode: progress?.code ?? details.starterCode,
    messages,
    llmAnswer: messages.filter((message) => message.role === "assistant").at(-1)?.content || "",
    checks: details.publicChecks,
    finalResult: run.run?.finalResult || "",
    agentEvents: readTaskAgentEvents(taskId),
    timestamps: {
      assignedAt: task.created_at,
      updatedAt: run.run?.updatedAt || progress?.updatedAt || task.updated_at
    }
  });
}

async function taskRun(req, res, url) {
  const taskId = decodeURIComponent(url.pathname.slice("/api/tasks/".length, -"/runs".length));
  if (!db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) return sendJson(res, 404, { error: "task_not_found" });
  const body = await readJson(req);
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const status = String(body.status || "created");
  const finalResult = String(body.finalResult || "");
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const agentEvents = Array.isArray(body.agentEvents) ? body.agentEvents : [];
  if (messages.some((message) => !["user", "assistant", "system"].includes(message?.role))) return sendJson(res, 400, { error: "invalid_run_message_role" });
  if (agentEvents.some((event) => event?.payload !== undefined && (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)))) return sendJson(res, 400, { error: "invalid_agent_event_payload" });
  if (taskRunTooLarge({ status, finalResult, messages, agentEvents })) return sendJson(res, 413, { error: "task_run_too_large" });
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO task_runs (id, task_id, status, final_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(runId, taskId, status, finalResult, now, now);
    const insertMessage = db.prepare("INSERT INTO run_messages (run_id, role, content, position, created_at) VALUES (?, ?, ?, ?, ?)");
    messages.forEach((message, index) => {
      insertMessage.run(runId, message.role, String(message?.content || ""), index, now);
    });
    const insertEvent = db.prepare("INSERT INTO agent_events (run_id, type, payload, created_at) VALUES (?, ?, ?, ?)");
    agentEvents.forEach((event) => {
      insertEvent.run(runId, String(event?.type || "event"), JSON.stringify(event?.payload || {}), now);
    });
    const memoryCandidate = memoryCandidateFromRun(taskId, runId, status, finalResult);
    if (memoryCandidate) {
      db.prepare("INSERT INTO memory_events (id, kind, text, source, evidence, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), memoryCandidate.kind, memoryCandidate.text, "task_run", JSON.stringify(memoryCandidate.evidence), "pending", now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  sendJson(res, 200, { ok: true, run: { id: runId, taskId, status, finalResult, createdAt: now, updatedAt: now } });
}

function taskRunTooLarge({ status, finalResult, messages, agentEvents }) {
  return status.length > 120 ||
    finalResult.length > 5000 ||
    messages.length > 100 ||
    messages.some((message) => String(message?.content || "").length > 20000) ||
    agentEvents.length > 100 ||
    agentEvents.some((event) => String(event?.type || "").length > 120 || JSON.stringify(event?.payload || {}).length > 20000);
}

function memoryCandidateFromRun(taskId, runId, status, finalResult) {
  const value = `${status} ${finalResult}`.toLowerCase();
  if (!/(fail|error|ошиб|провал)/.test(value)) return null;
  const task = db.prepare("SELECT title, topic FROM tasks WHERE id = ?").get(taskId);
  const text = `${task?.title || taskId}: ${finalResult || status}`;
  if (containsSensitiveData(text)) return null;
  return {
    kind: "weak_topic",
    text,
    evidence: { taskId, runId, status, finalResult, topic: task?.topic || "" }
  };
}

async function progressPipeline(req, res) {
  if (req.method === "GET") return sendJson(res, 200, { pipeline: readLearningPipeline() });
  if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
  const body = await readJson(req);
  const scope = String(body.scope || "single");
  if (!Array.isArray(body.steps)) return sendJson(res, 400, { error: "invalid_pipeline_steps" });
  const steps = body.steps.map((step) => ({
    stage: String(step?.stage || ""),
    title: String(step?.title || ""),
    detail: String(step?.detail || "")
  })).filter((step) => step.stage && step.title);
  if (!["single", "mini-module", "project"].includes(scope)) return sendJson(res, 400, { error: "invalid_pipeline_scope" });
  if (steps.length === 0) return sendJson(res, 400, { error: "empty_pipeline_steps" });
  if (steps.some((step) => !["theory", "tests", "project", "review"].includes(step.stage))) return sendJson(res, 400, { error: "invalid_pipeline_stage" });
  if (steps.some((step) => step.title.length > 300 || step.detail.length > 4000)) return sendJson(res, 413, { error: "pipeline_step_too_large" });
  if (!hasPipelineStageOrder(steps)) return sendJson(res, 400, { error: "invalid_pipeline_order" });
  const now = new Date().toISOString();
  const id = "current";
  db.prepare(`INSERT INTO learning_pipelines (id, scope, steps, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, steps = excluded.steps, updated_at = excluded.updated_at`)
    .run(id, scope, JSON.stringify(steps), now, now);
  const memoryCandidate = memoryCandidateFromPipeline(scope, steps);
  if (!containsSensitiveData(memoryCandidate.text)) {
    db.prepare("INSERT INTO memory_events (id, kind, text, source, evidence, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), memoryCandidate.kind, memoryCandidate.text, "progress_pipeline", JSON.stringify(memoryCandidate.evidence), "pending", now);
  }
  sendJson(res, 200, { ok: true, pipeline: readLearningPipeline() });
}

function memoryCandidateFromPipeline(scope, steps) {
  return {
    kind: "project_reference",
    text: `Pipeline ${scope}: ${steps.map((step) => step.title).join(" -> ")}`.slice(0, 5000),
    evidence: { scope, stages: steps.map((step) => step.stage) }
  };
}

function hasPipelineStageOrder(steps) {
  const order = ["theory", "tests", "project", "review"];
  let previous = -1;
  for (const step of steps) {
    const current = order.indexOf(step.stage);
    if (current <= previous) return false;
    previous = current;
  }
  return true;
}

async function memoryEvents(req, res) {
  if (req.method === "GET") {
    return sendJson(res, 200, {
      events: readMemoryEvents(),
      reviewQueue: readMemoryEvents("pending"),
      retrievedMemory: readRetrievedMemory()
    });
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
  const body = await readJson(req);
  const kind = String(body.kind || "").trim();
  const text = String(body.text || "").trim();
  const source = String(body.source || "manual").trim();
  if (!kind || !text) return sendJson(res, 400, { error: "invalid_memory_event" });
  if (!memoryEventKinds.has(kind)) return sendJson(res, 400, { error: "invalid_memory_event_kind" });
  if (!memoryEventSources.has(source)) return sendJson(res, 400, { error: "invalid_memory_event_source" });
  if (containsSensitiveData(text)) return sendJson(res, 400, { error: "sensitive_memory_data" });
  if (body.evidence !== undefined && (!body.evidence || typeof body.evidence !== "object" || Array.isArray(body.evidence))) {
    return sendJson(res, 400, { error: "invalid_memory_event_evidence" });
  }
  if (text.length > 5000 || JSON.stringify(body.evidence || {}).length > 20000) {
    return sendJson(res, 413, { error: "memory_event_too_large" });
  }
  const now = new Date().toISOString();
  const event = {
    id: crypto.randomUUID(),
    kind,
    text,
    source,
    evidence: body.evidence || {},
    reviewStatus: "pending",
    createdAt: now
  };
  db.prepare("INSERT INTO memory_events (id, kind, text, source, evidence, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(event.id, event.kind, event.text, event.source, JSON.stringify(event.evidence), event.reviewStatus, event.createdAt);
  sendJson(res, 200, { ok: true, event });
}

async function memoryEventReview(req, res, url) {
  const eventId = decodeURIComponent(url.pathname.slice("/api/memory/events/".length));
  const body = await readJson(req);
  const reviewStatus = String(body.reviewStatus || "");
  if (!["accepted", "rejected", "pending"].includes(reviewStatus)) return sendJson(res, 400, { error: "invalid_memory_review_status" });
  const result = db.prepare("UPDATE memory_events SET review_status = ? WHERE id = ?").run(reviewStatus, eventId);
  if (result.changes === 0) return sendJson(res, 404, { error: "memory_event_not_found" });
  const event = readMemoryEvent(eventId);
  let graph = null;
  if (reviewStatus === "accepted" && body.syncGraph === true) graph = await syncAcceptedMemoryEvents();
  sendJson(res, 200, { ok: true, event, graph });
}

async function graphMemorySync(_req, res) {
  const graph = await syncAcceptedMemoryEvents();
  sendJson(res, 200, graph);
}

async function syncAcceptedMemoryEvents() {
  const graphMemoryUrl = graphMemoryBaseUrl();
  if (!graphMemoryUrl) return { ok: false, error: "missing_graph_memory_url" };
  const graphUrl = httpServiceUrl(graphMemoryUrl);
  if (!graphUrl) return { ok: false, error: "invalid_graph_memory_url" };
  const events = readUnsyncedAcceptedMemoryEvents();
  if (events.length === 0) return { ok: true, synced: 0, graph: { ok: true, skipped: "no_unsynced_events" } };
  try {
    const graph = await fetchJson(`${graphUrl}/memory/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events })
    });
    markGraphSyncedMemoryEvents(events);
    return { ok: true, synced: events.length, graph };
  } catch (error) {
    return { ok: false, error: graphMemoryError(error), message: error.message };
  }
}

function readUnsyncedAcceptedMemoryEvents() {
  return db.prepare(`
    SELECT e.id, e.kind, e.text, e.source, e.evidence, e.review_status AS reviewStatus, e.created_at AS createdAt
    FROM memory_events e
    LEFT JOIN graph_synced_memory_events s ON s.event_id = e.id
    WHERE e.review_status = 'accepted' AND s.event_id IS NULL
    ORDER BY e.created_at DESC
  `).all().map((row) => ({ ...row, evidence: parseJson(row.evidence) })).filter((event) => !containsSensitiveData(event.text));
}

function markGraphSyncedMemoryEvents(events) {
  const now = new Date().toISOString();
  const stmt = db.prepare("INSERT OR IGNORE INTO graph_synced_memory_events (event_id, synced_at) VALUES (?, ?)");
  events.forEach((event) => stmt.run(event.id, now));
}

async function graphMemoryHealth(_req, res) {
  const graphMemoryUrl = graphMemoryBaseUrl();
  if (!graphMemoryUrl) return sendJson(res, 200, { ok: false, configured: false, error: "missing_graph_memory_url" });
  const graphUrl = httpServiceUrl(graphMemoryUrl);
  if (!graphUrl) return sendJson(res, 400, { ok: false, configured: true, error: "invalid_graph_memory_url" });
  try {
    const graph = await fetchJson(`${graphUrl}/health`);
    return sendJson(res, 200, { ok: true, configured: true, graph });
  } catch (error) {
    return sendJson(res, 502, { ok: false, configured: true, error: graphMemoryError(error), message: error.message });
  }
}

async function graphMemoryItems(_req, res) {
  const configured = graphMemoryBaseUrl();
  if (!configured) return sendJson(res, 200, { ok: false, configured: false, error: "missing_graph_memory_url", groups: [], items: [] });
  const graphUrl = httpServiceUrl(configured);
  if (!graphUrl) return sendJson(res, 400, { ok: false, configured: true, error: "invalid_graph_memory_url", groups: [], items: [] });
  const groups = graphMemoryGroups();
  try {
    const items = [];
    for (const groupId of groups) {
      const graph = await fetchJson(`${graphUrl}/memory/items?groupId=${encodeURIComponent(groupId)}&limit=100`);
      for (const item of Array.isArray(graph.items) ? graph.items : []) {
        const safe = graphMemoryItemForUi(item, groupId);
        if (safe) items.push(safe);
      }
    }
    sendJson(res, 200, { ok: true, configured: true, groups, items });
  } catch (error) {
    sendJson(res, 502, { ok: false, configured: true, error: graphMemoryError(error), message: error.message, groups, items: [] });
  }
}

function graphMemoryGroups() {
  const groups = readMemoryEvents("accepted").map((event) => {
    const evidence = event.evidence || {};
    return String(evidence.projectId || evidence.lessonId || evidence.taskId || "codelearn-local");
  });
  return groups.length ? [...new Set(groups)] : ["codelearn-local"];
}

function graphMemoryItemForUi(item, groupId) {
  const fact = String(item?.fact || "").trim();
  const subject = String(item?.subject || "").trim();
  const relation = String(item?.relation || "").trim();
  const object = String(item?.object || "").trim();
  if (!fact || containsSensitiveData([fact, subject, relation, object].join("\n"))) return null;
  return {
    uuid: String(item?.uuid || "").slice(0, 200),
    subject: subject.slice(0, 200),
    relation: relation.slice(0, 120),
    object: object.slice(0, 500),
    fact: fact.slice(0, 1000),
    createdAt: String(item?.createdAt || "").slice(0, 100),
    groupId
  };
}

async function graphMemorySearch(req, res) {
  const graphMemoryUrl = graphMemoryBaseUrl();
  if (!graphMemoryUrl) return sendJson(res, 400, { error: "missing_graph_memory_url" });
  const graphUrl = httpServiceUrl(graphMemoryUrl);
  if (!graphUrl) return sendJson(res, 400, { error: "invalid_graph_memory_url" });
  const body = await readJson(req);
  const query = String(body.query || "").trim();
  if (!query) return sendJson(res, 400, { error: "empty_graph_memory_query" });
  const taskId = String(body.taskId || "").trim();
  if (taskId && !db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) return sendJson(res, 404, { error: "task_not_found" });
  try {
    const limit = boundedLimit(body.limit);
    const groupIds = graphSearchGroups(taskId, body.projectId);
    const results = [];
    for (const groupId of groupIds) {
      const graph = await fetchJson(`${graphUrl}/memory/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, groupId, limit })
      });
      cacheRetrievedGraphMemory(query, groupId, graph.results);
      results.push(...(Array.isArray(graph.results) ? graph.results : []));
    }
    sendJson(res, 200, { ok: true, graph: { ok: true, groups: groupIds, results: dedupeGraphResults(results) } });
  } catch (error) {
    sendJson(res, 502, { ok: false, error: graphMemoryError(error), message: error.message });
  }
}

function graphSearchGroups(taskId, projectId) {
  const groups = [taskId, String(projectId || "").trim()].filter(Boolean);
  return groups.length ? [...new Set(groups)] : ["codelearn-local"];
}

function dedupeGraphResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    const key = String(result?.uuid || result?.fact || result?.name || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cacheRetrievedGraphMemory(_query, groupId, results) {
  if (!Array.isArray(results)) return;
  const now = new Date().toISOString();
  const exists = db.prepare("SELECT 1 FROM retrieved_memory WHERE text = ? AND source = ? AND evidence = ?");
  const insert = db.prepare("INSERT INTO retrieved_memory (id, kind, text, source, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const result of results.slice(0, 8)) {
    const text = String(result?.fact || result?.name || "").trim();
    if (!text || text.length > 5000 || containsSensitiveData(text)) continue;
    const evidence = JSON.stringify({
      groupId,
      uuid: String(result?.uuid || ""),
      validAt: String(result?.validAt || ""),
      invalidAt: String(result?.invalidAt || "")
    });
    if (exists.get(text, "graph_memory", evidence)) continue;
    insert.run(crypto.randomUUID(), "project_reference", text, "graph_memory", evidence, now);
  }
}

function graphMemoryError(error) {
  return String(error?.message || "").includes("missing_graph_memory_credentials")
    ? "missing_graph_memory_credentials"
    : "graph_memory_unreachable";
}

function boundedLimit(value, fallback = 8, max = 50) {
  const limit = Number(value || fallback);
  return Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : fallback, max));
}

async function runtimeHealth(_req, res) {
  sendJson(res, 200, await readRuntimeHealth());
}

async function readRuntimeHealth() {
  const workspaceUrl = readSetting("workspaceRuntimeUrl") || process.env.WORKSPACE_RUNTIME_URL || "http://127.0.0.1:8080";
  const agentUrl = readSetting("agentRuntimeUrl") || process.env.AGENT_RUNTIME_URL || "http://127.0.0.1:3000";
  const judgeUrl = process.env.JUDGE0_BASE_URL || "";
  const graphUrl = graphMemoryBaseUrl();
  const [workspace, agent, judge, graph] = await Promise.all([
    runtimeProbe("workspace", workspaceUrl, ""),
    runtimeProbe("agent", agentUrl, "/health"),
    runtimeProbe("judge0", judgeUrl, ""),
    runtimeProbe("graphMemory", graphUrl, "/health")
  ]);
  return { ok: [workspace, agent, judge, graph].every((item) => !item.configured || item.ok), workspace, agent, judge, graph };
}

async function runtimeStart(req, res) {
  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0) return sendJson(res, 400, { error: "invalid_runtime_start_request" });
  if (runtimeStartInProgress) return sendJson(res, 409, { error: "runtime_start_in_progress" });
  runtimeStartInProgress = true;
  try {
    await runRuntimeCompose();
    return sendJson(res, 200, { ok: true, runtime: await readRuntimeHealth() });
  } catch (error) {
    return sendJson(res, 502, { error: "runtime_start_failed", message: String(error.message || "").slice(-500) });
  } finally {
    runtimeStartInProgress = false;
  }
}

function runRuntimeCompose() {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", runtimeComposeArgs, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk) => {
      output = `${output}${chunk}`.slice(-20000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(output.trim() || `docker_compose_exit_${code}`)));
  });
}

function graphMemoryBaseUrl() {
  return String(readSetting("graphMemoryUrl") || process.env.GRAPH_MEMORY_URL || "").trim();
}

async function runtimeProbe(name, baseUrl, path) {
  const url = httpServiceUrl(baseUrl);
  if (String(baseUrl || "").trim() && !url) return { name, configured: true, ok: false, error: "invalid_service_url" };
  if (!url) return { name, configured: false, ok: false };
  try {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(1500) });
    return { name, configured: true, ok: response.status < 500, status: response.status };
  } catch (error) {
    return { name, configured: true, ok: false, error: error.message };
  }
}

async function assistantChats(req, res) {
  if (req.method === "GET") return sendJson(res, 200, { chats: readAssistantChats() });
  if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });
  const body = await readJson(req);
  const now = new Date().toISOString();
  const taskId = String(body.taskId || "");
  if (taskId && !db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) return sendJson(res, 404, { error: "task_not_found" });
  const label = String(body.label || "Новый чат").trim() || "Новый чат";
  if (label.length > 120) return sendJson(res, 400, { error: "invalid_chat_label" });
  const chat = {
    id: crypto.randomUUID(),
    label,
    projectId: String(body.projectId || "local"),
    taskId,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  db.prepare("INSERT INTO assistant_chats (id, label, project_id, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(chat.id, chat.label, chat.projectId, chat.taskId, chat.createdAt, chat.updatedAt);
  sendJson(res, 200, { ok: true, chat });
}

async function assistantChatMessage(req, res, url) {
  const chatId = decodeURIComponent(url.pathname.slice("/api/assistant/chats/".length, -"/messages".length));
  if (!db.prepare("SELECT 1 FROM assistant_chats WHERE id = ?").get(chatId)) return sendJson(res, 404, { error: "chat_not_found" });
  const body = await readJson(req);
  const role = String(body.role || "");
  if (!["user", "assistant", "system"].includes(role)) return sendJson(res, 400, { error: "invalid_chat_message_role" });
  if (body.content !== undefined && typeof body.content !== "string") return sendJson(res, 400, { error: "invalid_chat_message_content" });
  const content = (body.content || "").trim();
  if (!content) return sendJson(res, 400, { error: "empty_message" });
  if (content.length > 20000) return sendJson(res, 413, { error: "chat_message_too_large" });
  const now = new Date().toISOString();
  db.prepare("INSERT INTO assistant_messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)")
    .run(chatId, role, content, now);
  db.prepare("UPDATE assistant_chats SET updated_at = ? WHERE id = ?").run(now, chatId);
  sendJson(res, 200, {
    ok: true,
    message: { role, content, createdAt: now }
  });
}

async function assistantRespond(req, res) {
  const { chatId } = await readJson(req);
  const chat = db.prepare("SELECT id, project_id AS projectId, task_id AS taskId FROM assistant_chats WHERE id = ?").get(String(chatId || ""));
  if (!chat) return sendJson(res, 404, { error: "chat_not_found" });
  const history = boundedChatMessages(chat.id);
  const latestUser = [...history].reverse().find((message) => message.role === "user");
  if (!latestUser) return sendJson(res, 400, { error: "missing_user_message" });

  const providerId = readSetting("providerId") || "openrouter";
  const provider = providers.find((item) => item.id === providerId);
  const model = readSetting("providerModel").trim();
  const baseUrl = httpServiceUrl(readSetting("providerBaseUrl") || provider?.baseUrl);
  const apiKey = provider ? process.env[provider.apiKeyEnv] : "";
  if (!provider || !model || !baseUrl || !apiKey) return sendJson(res, 400, { error: "provider_not_configured" });

  const memory = await assistantMemoryContext(latestUser.content, chat);
  const instructions = assistantInstructions(memory);
  const tools = toolsForProvider(provider.mode);
  let initial;
  try {
    initial = await requestProvider(provider, baseUrl, apiKey, {
      model,
      instructions,
      history,
      tools
    });
  } catch (error) {
    return sendJson(res, 502, { error: "provider_request_failed", message: error.message, memory: memory.status });
  }

  const calls = providerToolCalls(provider.mode, initial.data);
  let finalData = initial.data;
  const outputs = [];
  let successfulTest = null;
  let memoryWrites = [];
  let action = null;
  if (calls.length) {
    const seenTools = new Set();
    for (const [index, call] of calls.entries()) {
      if (index >= 3) outputs.push({ ok: false, error: "too_many_tool_calls" });
      else if (seenTools.has(call.name)) outputs.push({ ok: false, error: "duplicate_tool_call" });
      else {
        seenTools.add(call.name);
        outputs.push(await executeAssistantTool(call, chat));
      }
    }
    successfulTest = outputs.find((output) => output.ok && output.test) || null;
    memoryWrites = outputs.filter((output) => output.ok && output.memory);
    action = successfulTest ? { type: "open_test", targetId: successfulTest.test.id, label: "Открыть в тестах" } : null;
    try {
      finalData = await continueProvider(provider, baseUrl, apiKey, {
        model,
        instructions,
        history,
        tools,
        initial: initial.data,
        calls,
        outputs
      });
    } catch (error) {
      if (successfulTest || memoryWrites.length) {
        const content = successfulTest
          ? "Тест сохранён, но provider не вернул финальный ответ. Откройте тест или повторите запрос для текстового ответа."
          : "Graph Memory обновлена, но provider не вернул финальный текстовый ответ.";
        const message = persistAssistantMessage(chat.id, "system", content, action);
        return sendJson(res, 200, {
          ok: false,
          providerError: "provider_request_failed",
          message,
          action,
          test: successfulTest?.test || null,
          memoryWrites,
          toolErrors: outputs.filter((output) => !output.ok),
          memory: memory.status
        });
      }
      return sendJson(res, 502, { error: "provider_request_failed", message: error.message, memory: memory.status });
    }
  }

  const content = successfulTest ? testCreatedChatMessage(successfulTest.test) : assistantResponseText(finalData).trim();
  if (!content) return sendJson(res, 502, { error: "empty_provider_response", memory: memory.status });
  const message = persistAssistantMessage(chat.id, "assistant", content, action);
  sendJson(res, 200, {
    ok: true,
    message,
    action,
    test: successfulTest?.test || null,
    memoryWrites,
    toolErrors: outputs.filter((output) => !output.ok),
    memory: memory.status
  });
}

function persistAssistantMessage(chatId, role, content, action) {
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO assistant_messages (chat_id, role, content, action, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(chatId, role, content, action ? JSON.stringify(action) : "", createdAt);
  db.prepare("UPDATE assistant_chats SET updated_at = ? WHERE id = ?").run(createdAt, chatId);
  return { role, content, action, createdAt };
}

function boundedChatMessages(chatId) {
  const rows = db.prepare("SELECT role, content FROM assistant_messages WHERE chat_id = ? AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT 30").all(chatId);
  const messages = [];
  let length = 0;
  for (const message of rows) {
    if (length + message.content.length > 24000 && messages.length) break;
    messages.push({ role: message.role, content: message.content.slice(0, 12000) });
    length += message.content.length;
  }
  return messages.reverse();
}

async function assistantMemoryContext(query, chat) {
  const personality = relevantPersonality(await readPersonality(), query);
  const accepted = relevantAcceptedMemory(query);
  const graph = await retrieveGraphContext(query, chat);
  return {
    personality,
    preferences: accepted.filter((item) => ["coding_habit", "response_preference"].includes(item.kind)).map((item) => item.text),
    skills: accepted.filter((item) => ["weak_topic", "strong_topic", "skill_observation"].includes(item.kind)).map((item) => `${item.kind}: ${item.text}`),
    graph: graph.results,
    status: { graph: graph.status }
  };
}

function relevantPersonality(markdown) {
  const document = String(markdown || "").split("\n").filter((line) => !containsSensitiveData(line)).join("\n").trim();
  return document ? [document.slice(0, 5000)] : [];
}

function relevantAcceptedMemory(query) {
  return readMemoryEvents("accepted")
    .filter((item) => !containsSensitiveData(item.text))
    .filter((item) => ["coding_habit", "response_preference"].includes(item.kind) || relevantText(item.text, query))
    .slice(0, 8);
}

function relevantText(text, query) {
  const terms = new Set(String(query || "").toLowerCase().match(/[a-zа-яё0-9_+-]{3,}/gi) || []);
  return (String(text || "").toLowerCase().match(/[a-zа-яё0-9_+-]{3,}/gi) || []).some((term) => terms.has(term));
}

async function retrieveGraphContext(query, chat) {
  const configured = graphMemoryBaseUrl();
  if (!configured) return { status: { configured: false, ok: false, error: "missing_graph_memory_url" }, results: [] };
  const graphUrl = httpServiceUrl(configured);
  if (!graphUrl) return { status: { configured: true, ok: false, error: "invalid_graph_memory_url" }, results: [] };
  if (containsSensitiveData(query)) return { status: { configured: true, ok: false, error: "sensitive_memory_query" }, results: [] };
  try {
    const results = [];
    for (const groupId of graphSearchGroups(chat.taskId, chat.projectId)) {
      const graph = await fetchJson(`${graphUrl}/memory/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: String(query).slice(0, 1000), groupId, limit: 4 })
      });
      cacheRetrievedGraphMemory(query, groupId, graph.results);
      results.push(...(graph.results || []));
    }
    return {
      status: { configured: true, ok: true },
      results: dedupeGraphResults(results).map((item) => String(item.fact || item.name || "").trim()).filter((text) => text && !containsSensitiveData(text)).slice(0, 4)
    };
  } catch (error) {
    return { status: { configured: true, ok: false, error: graphMemoryError(error), message: error.message }, results: [] };
  }
}

function assistantInstructions(memory) {
  const section = (title, items) => [`# ${title}`, ...(items.length ? items.map((item) => `- ${item}`) : ["- нет релевантных подтверждённых данных"])].join("\n");
  const graphState = memory.status.graph.ok
    ? "Graph memory доступна; ниже только результаты текущего поиска."
    : `Graph memory недоступна: ${memory.status.graph.error}. Не выдумывай graph results.`;
  return [
    modelControlPrompt,
    "",
    "Контекст памяти ограничен текущим запросом. Не цитируй его как скрытый профиль и не сохраняй новые данные без исполняемого tool.",
    section("Пользовательская персонализация", [...memory.personality, ...memory.preferences].slice(0, 8)),
    section("Наблюдения о навыках", memory.skills.slice(0, 6)),
    `# Graph memory\n${graphState}`,
    ...memory.graph.map((item) => `- ${item}`)
  ].join("\n").slice(0, 7000);
}

async function requestProvider(provider, baseUrl, apiKey, { model, instructions, history, tools }) {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...headersFromEnv(provider.envHeaders) };
  if (provider.mode === "openai-responses") {
    const body = { model, instructions, input: history, tools, parallel_tool_calls: false };
    return { data: await fetchJson(`${baseUrl}/responses`, { method: "POST", headers, body: JSON.stringify(body) }), body };
  }
  const body = { model, messages: [{ role: "system", content: instructions }, ...history], tools, parallel_tool_calls: false };
  return { data: await fetchJson(`${baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) }), body };
}

function providerToolCalls(mode, data) {
  if (mode === "openai-responses") {
    return (data?.output || []).filter((item) => item?.type === "function_call").map((item) => ({ id: item.call_id, name: item.name, arguments: item.arguments }));
  }
  return (data?.choices?.[0]?.message?.tool_calls || []).map((item) => ({ id: item.id, name: item.function?.name, arguments: item.function?.arguments }));
}

async function continueProvider(provider, baseUrl, apiKey, { model, instructions, history, tools, initial, calls, outputs }) {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...headersFromEnv(provider.envHeaders) };
  if (provider.mode === "openai-responses") {
    return fetchJson(`${baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        instructions,
        input: [
          ...history,
          ...(Array.isArray(initial?.output) ? initial.output : []),
          ...calls.map((call, index) => ({ type: "function_call_output", call_id: call.id, output: JSON.stringify(providerToolOutput(outputs[index])) }))
        ],
        tools,
        parallel_tool_calls: false
      })
    });
  }
  const assistant = initial?.choices?.[0]?.message || {};
  return fetchJson(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: instructions },
        ...history,
        { role: "assistant", content: assistant.content || null, tool_calls: assistant.tool_calls || [] },
        ...calls.map((call, index) => ({ role: "tool", tool_call_id: call.id, content: JSON.stringify(providerToolOutput(outputs[index])) }))
      ],
      tools,
      parallel_tool_calls: false
    })
  });
}

function providerToolOutput(output) {
  if (!output?.ok) return output;
  if (output.memory) {
    return {
      ok: true,
      memory: {
        storedCount: output.memory.storedCount,
        categories: output.memory.categories,
        reviewStatus: "accepted"
      },
      graph: { ok: true, synced: output.graph.synced }
    };
  }
  return {
    ok: true,
    test: {
      id: output.test.id,
      topic: output.test.topic,
      level: output.test.level,
      questionCount: output.test.questions.length
    },
    action: { type: "open_test", targetId: output.test.id }
  };
}

function testCreatedChatMessage(test) {
  if (!test) return "Тест создан и сохранён во вкладке «Тесты».";
  return `Тест «${test.topic}» создан: ${test.questions.length} вопросов. Он сохранён во вкладке «Тесты».`;
}

async function executeAssistantTool(call, chat) {
  if (!["create_test", "remember_context"].includes(call.name)) return { ok: false, error: "tool_not_allowed" };
  let spec;
  try {
    spec = JSON.parse(String(call.arguments || ""));
  } catch {
    return { ok: false, error: "invalid_tool_arguments_json" };
  }
  if (call.name === "create_test") {
    const error = validateQuizSpec(spec);
    if (error) return { ok: false, error };
    return { ok: true, test: saveQuiz(spec) };
  }
  return saveAutonomousMemory(spec, chat);
}

async function saveAutonomousMemory(spec, chat) {
  const error = validateAutonomousMemory(spec);
  if (error) return { ok: false, error };
  const now = new Date().toISOString();
  const evidence = {
    chatId: chat.id,
    projectId: chat.projectId || "local",
    taskId: chat.taskId || "",
    assistantGenerated: true
  };
  const inserted = [];
  const statement = db.prepare("INSERT INTO memory_events (id, kind, text, source, evidence, review_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    for (const memory of spec.memories) {
      const event = {
        id: crypto.randomUUID(),
        kind: autonomousMemoryKinds[memory.category],
        text: memory.text.trim(),
        source: "assistant_chat",
        evidence: {
          ...evidence,
          graph: {
            subject: memory.subject.trim(),
            relation: memory.relation.trim(),
            object: memory.object.trim()
          }
        },
        reviewStatus: "accepted",
        createdAt: now
      };
      statement.run(event.id, event.kind, event.text, event.source, JSON.stringify(event.evidence), event.reviewStatus, event.createdAt);
      inserted.push(event);
    }
    db.exec("COMMIT");
  } catch (insertError) {
    db.exec("ROLLBACK");
    throw insertError;
  }
  const graph = await syncAcceptedMemoryEvents();
  const memory = {
    storedCount: inserted.length,
    ids: inserted.map((event) => event.id),
    categories: [...new Set(spec.memories.map((memory) => memory.category))],
    reviewStatus: "accepted"
  };
  return graph.ok ? { ok: true, memory, graph } : { ok: false, error: "graph_memory_write_failed", memory, graph };
}

function validateAutonomousMemory(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec) || Object.keys(spec).some((key) => key !== "memories")) return "invalid_memory_tool_arguments";
  if (!Array.isArray(spec.memories) || spec.memories.length < 1 || spec.memories.length > 4) return "invalid_memory_tool_count";
  const texts = new Set();
  for (const memory of spec.memories) {
    if (!memory || typeof memory !== "object" || Array.isArray(memory) || Object.keys(memory).some((key) => !["category", "text", "subject", "relation", "object"].includes(key))) return "invalid_memory_tool_item";
    if (!autonomousMemoryKinds[memory.category]) return "invalid_memory_tool_category";
    if (typeof memory.text !== "string" || memory.text.trim().length < 2 || memory.text.trim().length > 1000) return "invalid_memory_tool_text";
    if (typeof memory.subject !== "string" || memory.subject.trim().length < 1 || memory.subject.trim().length > 200) return "invalid_memory_tool_subject";
    if (typeof memory.relation !== "string" || memory.relation.trim().length < 1 || memory.relation.trim().length > 120) return "invalid_memory_tool_relation";
    if (typeof memory.object !== "string" || memory.object.trim().length < 1 || memory.object.trim().length > 500) return "invalid_memory_tool_object";
    if (containsSensitiveData([memory.text, memory.subject, memory.relation, memory.object].join("\n"))) return "sensitive_memory_data";
    const normalized = memory.text.trim().toLowerCase();
    if (texts.has(normalized)) return "duplicate_memory_tool_text";
    texts.add(normalized);
  }
  return "";
}

function validateQuizSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return "invalid_test";
  if (typeof spec.topic !== "string" || spec.topic.trim().length < 2 || spec.topic.trim().length > 200) return "invalid_test_topic";
  if (typeof spec.level !== "string" || spec.level.trim().length < 2 || spec.level.trim().length > 80) return "invalid_test_level";
  if (!Array.isArray(spec.questions) || spec.questions.length < 4 || spec.questions.length > 15) return "invalid_test_question_count";
  if (containsSensitiveData(JSON.stringify(spec))) return "sensitive_test_data";
  for (const question of spec.questions) {
    if (!question || typeof question.prompt !== "string" || !question.prompt.trim() || question.prompt.length > 2000) return "invalid_test_question";
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6) return "invalid_test_options";
    if (question.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 500)) return "invalid_test_option";
    if (new Set(question.options.map((option) => option.trim())).size !== question.options.length) return "duplicate_test_options";
    if (!Number.isInteger(question.correctAnswer) || question.correctAnswer < 0 || question.correctAnswer >= question.options.length) return "invalid_test_correct_answer";
    if (typeof question.explanation !== "string" || !question.explanation.trim() || question.explanation.length > 2000) return "invalid_test_explanation";
  }
  return "";
}

function saveQuiz(spec) {
  const test = { id: crypto.randomUUID(), topic: spec.topic.trim(), level: spec.level.trim(), createdAt: new Date().toISOString() };
  const insertQuestion = db.prepare("INSERT INTO quiz_questions (test_id, prompt, options, correct_answer, explanation, position) VALUES (?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO quiz_tests (id, topic, level, created_at) VALUES (?, ?, ?, ?)").run(test.id, test.topic, test.level, test.createdAt);
    spec.questions.forEach((question, index) => insertQuestion.run(test.id, question.prompt.trim(), JSON.stringify(question.options.map((option) => option.trim())), question.correctAnswer, question.explanation.trim(), index));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return readQuiz(test.id);
}

function assistantResponseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  if (typeof data?.choices?.[0]?.message?.content === "string") return data.choices[0].message.content;
  return (data?.output || []).flatMap((item) => item.content || []).find((item) => typeof item?.text === "string")?.text || "";
}

function quizTests(_req, res) {
  sendJson(res, 200, { tests: readQuizzes() });
}

function quizTest(_req, res, url) {
  const test = readQuiz(decodeURIComponent(url.pathname.slice("/api/tests/".length)));
  if (!test) return sendJson(res, 404, { error: "test_not_found" });
  sendJson(res, 200, { test });
}

async function quizAttempt(req, res, url) {
  const testId = decodeURIComponent(url.pathname.slice("/api/tests/".length, -"/attempts".length));
  const test = readQuiz(testId);
  if (!test) return sendJson(res, 404, { error: "test_not_found" });
  const body = await readJson(req);
  if (!Array.isArray(body.answers) || body.answers.length !== test.questions.length) return sendJson(res, 400, { error: "invalid_test_attempt_answers" });
  if (body.answers.some((answer, index) => !Number.isInteger(answer) || answer < 0 || answer >= test.questions[index].options.length)) {
    return sendJson(res, 400, { error: "invalid_test_attempt_answers" });
  }
  const results = test.questions.map((question, index) => ({
    correct: body.answers[index] === question.correctAnswer,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation
  }));
  const attempt = {
    id: crypto.randomUUID(),
    testId,
    topic: test.topic,
    correctCount: results.filter((result) => result.correct).length,
    totalCount: test.questions.length,
    createdAt: new Date().toISOString()
  };
  db.prepare("INSERT INTO quiz_attempts (id, test_id, answers, correct_count, total_count, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(attempt.id, testId, JSON.stringify(body.answers), attempt.correctCount, attempt.totalCount, attempt.createdAt);
  sendJson(res, 200, { ok: true, attempt: { ...attempt, results } });
}

function readQuizzes() {
  return db.prepare("SELECT id, topic, level, created_at AS createdAt FROM quiz_tests ORDER BY created_at DESC").all().map((test) => readQuiz(test.id));
}

function readQuiz(id) {
  const test = db.prepare("SELECT id, topic, level, created_at AS createdAt FROM quiz_tests WHERE id = ?").get(id);
  if (!test) return null;
  return {
    ...test,
    questions: db.prepare("SELECT prompt, options, correct_answer AS correctAnswer, explanation FROM quiz_questions WHERE test_id = ? ORDER BY position").all(id)
      .map((question) => ({ ...question, options: parseJson(question.options) }))
  };
}

function readQuizAttempts() {
  return db.prepare(`SELECT a.id, a.test_id AS testId, t.topic, a.correct_count AS correctCount,
    a.total_count AS totalCount, a.created_at AS createdAt
    FROM quiz_attempts a JOIN quiz_tests t ON t.id = a.test_id
    ORDER BY a.created_at DESC`).all();
}

function containsSensitiveData(value) {
  const text = String(value || "");
  return /\b[a-z0-9_-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)[a-z0-9_-]*\s*[:=]\s*\S+/i.test(text)
    || /\bsk-[a-z0-9_-]{12,}\b/i.test(text)
    || /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text)
    || /(?:\+?\d[\s().-]*){10,}/.test(text);
}

async function workspaceFiles(_req, res, url) {
  const taskId = decodeURIComponent(url.pathname.slice("/api/workspace/tasks/".length, -"/files".length));
  if (!db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) return sendJson(res, 404, { error: "task_not_found" });
  const dir = await writeWorkspaceFiles(taskId);
  const files = (await listWorkspaceFiles(dir)).sort();
  sendJson(res, 200, {
    root: workspaceRoot,
    taskDir: dir,
    files: files.map((name) => ({
      name,
      path: join(taskId, name)
    }))
  });
}

async function workspaceFileContent(_req, res, url) {
  const prefix = "/api/workspace/tasks/";
  const marker = "/files/";
  const rest = url.pathname.slice(prefix.length);
  const markerIndex = rest.indexOf(marker);
  const taskId = decodeURIComponent(rest.slice(0, markerIndex));
  const name = decodeURIComponent(rest.slice(markerIndex + marker.length));
  if (!db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) return sendJson(res, 404, { error: "task_not_found" });
  let file;
  try {
    file = safeWorkspaceFilePath(taskId, name);
  } catch (error) {
    return sendJson(res, 403, { error: error.message });
  }
  await writeWorkspaceFiles(taskId);
  try {
    sendJson(res, 200, {
      name,
      path: join(taskId, name),
      content: await readFile(file, "utf8")
    });
  } catch (error) {
    if (error?.code === "ENOENT") return sendJson(res, 404, { error: "workspace_file_not_found" });
    throw error;
  }
}

function readTaskDetails(task) {
  return {
    id: task.id,
    title: task.title,
    topic: task.topic,
    difficulty: task.difficulty,
    status: task.status,
    minutes: task.minutes,
    prompt: task.prompt,
    starterCode: task.starter_code,
    hiddenSummary: task.hidden_summary,
    publicChecks: db.prepare("SELECT kind, message, code FROM public_checks WHERE task_id = ? ORDER BY position").all(task.id),
    hints: db.prepare("SELECT text FROM hints WHERE task_id = ? ORDER BY position").all(task.id).map((hint) => hint.text)
  };
}

function readLatestTaskRun(taskId) {
  const run = db.prepare("SELECT id, task_id AS taskId, status, final_result AS finalResult, created_at AS createdAt, updated_at AS updatedAt FROM task_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1").get(taskId);
  if (!run) return { run: null, messages: [], agentEvents: [] };
  return {
    run,
    messages: db.prepare("SELECT role, content, created_at AS createdAt FROM run_messages WHERE run_id = ? ORDER BY position").all(run.id),
    agentEvents: db.prepare("SELECT type, payload, created_at AS createdAt FROM agent_events WHERE run_id = ? ORDER BY id").all(run.id)
      .map((event) => ({ ...event, payload: parseJson(event.payload) }))
  };
}

function readTaskRunMessages(taskId) {
  return db.prepare(`
    SELECT m.role, m.content, m.created_at AS createdAt, 'task_run' AS source
    FROM run_messages m
    JOIN task_runs r ON r.id = m.run_id
    WHERE r.task_id = ?
    UNION ALL
    SELECT m.role, m.content, m.created_at AS createdAt, 'assistant_chat' AS source
    FROM assistant_messages m
    JOIN assistant_chats c ON c.id = m.chat_id
    WHERE c.task_id = ?
    ORDER BY createdAt
  `).all(taskId, taskId);
}

function readTaskAgentEvents(taskId) {
  return db.prepare(`
    SELECT e.type, e.payload, e.created_at AS createdAt
    FROM agent_events e
    JOIN task_runs r ON r.id = e.run_id
    WHERE r.task_id = ?
    ORDER BY r.created_at, e.id
  `).all(taskId).map((event) => ({ ...event, payload: parseJson(event.payload) }));
}

function readLearningPipeline() {
  const row = db.prepare("SELECT scope, steps, created_at AS createdAt, updated_at AS updatedAt FROM learning_pipelines WHERE id = 'current'").get();
  if (!row) return null;
  return { ...row, steps: parseJson(row.steps) };
}

function readMemoryEvents(status) {
  const rows = status
    ? db.prepare("SELECT id, kind, text, source, evidence, review_status AS reviewStatus, created_at AS createdAt FROM memory_events WHERE review_status = ? ORDER BY created_at DESC").all(status)
    : db.prepare("SELECT id, kind, text, source, evidence, review_status AS reviewStatus, created_at AS createdAt FROM memory_events ORDER BY created_at DESC").all();
  return rows.map((row) => ({ ...row, evidence: parseJson(row.evidence) }));
}

function readMemoryEvent(id) {
  const row = db.prepare("SELECT id, kind, text, source, evidence, review_status AS reviewStatus, created_at AS createdAt FROM memory_events WHERE id = ?").get(id);
  return row ? { ...row, evidence: parseJson(row.evidence) } : null;
}

function readRetrievedMemory() {
  const graphRows = db.prepare("SELECT id, kind, text, source, evidence, created_at AS createdAt FROM retrieved_memory ORDER BY created_at DESC LIMIT 8").all()
    .map((row) => ({ ...row, evidence: parseJson(row.evidence) }));
  const seen = new Set(graphRows.map((row) => row.text));
  const eventRows = readMemoryEvents()
    .filter((event) => !seen.has(event.text))
    .map(({ id, kind, text, source, evidence, createdAt }) => ({ id, kind, text, source, evidence, createdAt }));
  return [...graphRows, ...eventRows].slice(0, 8);
}

function readSkillGraph() {
  return readMemoryEvents("accepted").map((event) => ({
    id: event.id,
    concept: event.text,
    status: skillStatus(event.kind),
    evidence: event.evidence,
    source: event.source,
    createdAt: event.createdAt
  }));
}

function skillStatus(kind) {
  const value = String(kind || "").toLowerCase();
  if (value.includes("weak") || value.includes("problem") || value.includes("проблем")) return "weak";
  if (value.includes("strong") || value.includes("strength") || value.includes("силь")) return "strong";
  return "observed";
}

function readAssistantChats() {
  return db.prepare("SELECT id, label, project_id AS projectId, task_id AS taskId, created_at AS createdAt, updated_at AS updatedAt FROM assistant_chats ORDER BY updated_at DESC").all()
    .map((chat) => ({
      ...chat,
      messages: db.prepare("SELECT role, content, action, created_at AS createdAt FROM assistant_messages WHERE chat_id = ? ORDER BY id").all(chat.id)
        .map((message) => {
          const action = message.action ? parseJson(message.action) : null;
          const test = action?.type === "open_test" ? readQuiz(action.targetId) : null;
          return { ...message, content: test ? testCreatedChatMessage(test) : message.content, action };
        })
    }));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function taskMarkdown(task) {
  return [
    `# ${task.title}`,
    "",
    task.prompt,
    "",
    `- Тема: ${task.topic}`,
    `- Сложность: ${task.difficulty}`,
    `- Готово: проходят public checks`,
    "",
    "## Public checks",
    ...task.publicChecks.map((check) => `- ${check.message}`)
  ].join("\n");
}

async function writeWorkspaceFiles(taskId, options = {}) {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error("task_not_found");
  const details = readTaskDetails(task);
  const progress = db.prepare("SELECT code FROM task_progress WHERE task_id = ?").get(taskId);
  const dir = safeWorkspaceTaskDir(taskId);
  await mkdir(dir, { recursive: true });
  await writeFileIfMissing(join(dir, "task.md"), taskMarkdown(details));
  if (options.overwriteSolution) await writeFile(join(dir, "solution.py"), progress?.code ?? details.starterCode, "utf8");
  else await writeFileIfMissing(join(dir, "solution.py"), progress?.code ?? details.starterCode);
  await writeFileIfMissing(join(dir, "checks.json"), JSON.stringify(details.publicChecks, null, 2));
  return dir;
}

async function writeFileIfMissing(file, content) {
  try {
    await writeFile(file, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

function workspaceFileNames() {
  return ["checks.json", "solution.py", "task.md"];
}

async function workspaceAgentFiles(req, res, url) {
  const { taskId, fileName } = agentFileRoute(url);
  if (!db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) return sendJson(res, 404, { error: "task_not_found" });
  if (!fileName && req.method === "GET") {
    const dir = await writeWorkspaceFiles(taskId);
    return sendJson(res, 200, { files: await listWorkspaceFiles(dir) });
  }
  if (!fileName) return sendJson(res, 400, { error: "missing_agent_file" });
  let file;
  try {
    file = safeWorkspaceFilePath(taskId, fileName);
  } catch (error) {
    return sendJson(res, 403, { error: error.message });
  }
  if (req.method === "GET") {
    try {
      await assertWorkspaceRealPath(taskId, file, { allowMissingParent: true });
      return sendJson(res, 200, { name: fileName, content: await readFile(file, "utf8") });
    } catch (error) {
      if (error?.message === "workspace_path_escape") return sendJson(res, 403, { error: error.message });
      if (error?.code === "ENOENT") return sendJson(res, 404, { error: "workspace_file_not_found" });
      throw error;
    }
  }
  if (req.method === "PATCH") {
    const body = await readJson(req);
    if (typeof body.content !== "string") return sendJson(res, 400, { error: "invalid_agent_file_content" });
    const content = body.content;
    if (content.length > 200000) return sendJson(res, 413, { error: "agent_file_too_large" });
    await mkdir(dirname(file), { recursive: true });
    try {
      await assertWorkspaceRealPath(taskId, file);
    } catch (error) {
      if (error?.message === "workspace_path_escape") return sendJson(res, 403, { error: error.message });
      throw error;
    }
    await writeFile(file, content, "utf8");
    if (fileName === "solution.py") {
      const current = db.prepare("SELECT hint_index AS hintIndex FROM task_progress WHERE task_id = ?").get(taskId) || {};
      const updatedAt = new Date().toISOString();
      db.prepare(`INSERT INTO task_progress (task_id, code, hint_index, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET code = excluded.code, updated_at = excluded.updated_at`)
        .run(taskId, content, Number(current.hintIndex || 0), updatedAt);
    }
    recordWorkspaceFileSave(taskId, fileName);
    return sendJson(res, 200, { ok: true, name: fileName });
  }
  sendJson(res, 405, { error: "method_not_allowed" });
}

function recordWorkspaceFileSave(taskId, fileName) {
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  db.prepare("INSERT INTO task_runs (id, task_id, status, final_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(runId, taskId, "file_saved", fileName, now, now);
  db.prepare("INSERT INTO agent_events (run_id, type, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(runId, "workspace_file_saved", JSON.stringify({ name: fileName }), now);
}

async function workspaceAgentRun(req, res, url) {
  const taskId = decodeURIComponent(url.pathname.slice("/api/workspace/tasks/".length, -"/agent/run".length));
  if (!db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)) return sendJson(res, 404, { error: "task_not_found" });
  const agentRuntimeUrl = readSetting("agentRuntimeUrl") || process.env.AGENT_RUNTIME_URL || "";
  if (!agentRuntimeUrl) return sendJson(res, 400, { error: "missing_agent_runtime_url" });
  const body = await readJson(req);
  if (!Array.isArray(body.command) || body.command.some((part) => typeof part !== "string" || !part)) return sendJson(res, 400, { error: "invalid_agent_command" });
  const command = body.command;
  if (command.length === 0) return sendJson(res, 400, { error: "invalid_agent_command" });
  if (command.length > 16 || command.some((part) => part.length > 200)) return sendJson(res, 400, { error: "agent_command_too_long" });
  const runtimeUrl = httpServiceUrl(agentRuntimeUrl);
  if (!runtimeUrl) return sendJson(res, 400, { error: "invalid_agent_runtime_url" });
  await writeWorkspaceFiles(taskId);
  try {
    const result = await fetchJson(`${runtimeUrl}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, cwd: `/workspaces/${safeWorkspaceTaskId(taskId)}` })
    });
    recordWorkspaceAgentRun(taskId, command, result);
    return sendJson(res, 200, { ok: true, result });
  } catch (error) {
    recordWorkspaceAgentRun(taskId, command, { status: "agent_runtime_unreachable", error: error.message }, "agent_command_failed");
    return sendJson(res, 502, { error: "agent_runtime_unreachable", message: error.message });
  }
}

function recordWorkspaceAgentRun(taskId, command, result, eventType = "agent_command") {
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const resultStatus = String(result?.status || "agent_run");
  db.prepare("INSERT INTO task_runs (id, task_id, status, final_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(runId, taskId, resultStatus, resultStatus, now, now);
  db.prepare("INSERT INTO agent_events (run_id, type, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(runId, eventType, JSON.stringify({ command, resultStatus }), now);
}

function agentFileRoute(url) {
  const prefix = "/api/workspace/tasks/";
  const marker = "/agent/files";
  const rest = url.pathname.slice(prefix.length);
  const markerIndex = rest.indexOf(marker);
  const taskId = decodeURIComponent(rest.slice(0, markerIndex));
  const fileName = rest.length > markerIndex + marker.length + 1
    ? decodeURIComponent(rest.slice(markerIndex + marker.length + 1))
    : "";
  return { taskId, fileName };
}

async function listWorkspaceFiles(dir, base = "") {
  const entries = await readdir(join(dir, base), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listWorkspaceFiles(dir, relative));
    else files.push(relative);
    if (files.length >= 200) break;
  }
  return files;
}

function safeWorkspaceFilePath(taskId, fileName) {
  const dir = safeWorkspaceTaskDir(taskId);
  const file = normalize(join(dir, String(fileName || "")));
  if (!file.startsWith(`${dir}/`)) throw new Error("workspace_path_escape");
  return file;
}

async function assertWorkspaceRealPath(taskId, file, options = {}) {
  const realDir = await realpath(safeWorkspaceTaskDir(taskId));
  let realParent;
  try {
    realParent = await realpath(dirname(file));
  } catch (error) {
    if (options.allowMissingParent && error?.code === "ENOENT") return;
    throw error;
  }
  if (!realParent.startsWith(`${realDir}/`) && realParent !== realDir) throw new Error("workspace_path_escape");
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error("workspace_path_escape");
    const realFile = await realpath(file);
    if (!realFile.startsWith(`${realDir}/`)) throw new Error("workspace_path_escape");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function safeWorkspaceTaskId(taskId) {
  return String(taskId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function safeWorkspaceTaskDir(taskId) {
  const safeId = safeWorkspaceTaskId(taskId);
  const dir = normalize(join(workspaceRoot, safeId));
  if (!dir.startsWith(`${workspaceRoot}/`) && dir !== workspaceRoot) throw new Error("workspace_path_escape");
  return dir;
}

function statusWord(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("готов") || value.includes("выполн") || value === "done" || value === "passed") return "выполнено";
  if (value.includes("fail") || value.includes("error") || value.includes("ошиб") || value.includes("провал")) return "с ошибкой";
  if (value.includes("работ") || value === "file_saved" || value === "agent_run" || value === "created") return "в работе";
  return "в журнале";
}

function readProgress() {
  return Object.fromEntries(db.prepare("SELECT task_id AS taskId, code, hint_index AS hintIndex, updated_at AS updatedAt FROM task_progress").all()
    .map((row) => [row.taskId, { code: row.code, hintIndex: row.hintIndex, updatedAt: row.updatedAt }]));
}

function scalar(sql) {
  return Object.values(db.prepare(sql).get())[0];
}

async function executeCode(req, res) {
  const body = await readJson(req);
  const source = String(body.source_code || "");
  if (source.length > 20000) return sendJson(res, 413, { error: "source_too_large" });
  const publicChecks = body.public_checks === undefined ? [] : body.public_checks;
  if (!Array.isArray(publicChecks)) return sendJson(res, 400, { error: "invalid_public_checks" });
  if (!validPublicChecks(publicChecks)) return sendJson(res, 413, { error: "public_checks_too_large" });
  const judgeUrl = String(process.env.JUDGE0_BASE_URL || "").trim();
  if (!judgeUrl) return sendJson(res, 400, { error: "sandbox_not_configured" });
  const sandboxUrl = httpServiceUrl(judgeUrl);
  if (!sandboxUrl) return sendJson(res, 400, { error: "invalid_sandbox_url" });
  const cpuTimeSec = positiveNumber(process.env.SANDBOX_CPU_TIME_SEC || body.cpu_time_sec, 2);
  const wallTimeSec = positiveNumber(process.env.SANDBOX_WALL_TIME_SEC, 5);
  const memoryKb = positiveNumber(process.env.SANDBOX_MEMORY_KB, positiveNumber(body.memory_mb, 256) * 1024);
  const data = await fetchJson(`${sandboxUrl}/submissions?base64_encoded=false&wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      language_id: Number(process.env.JUDGE0_PYTHON_LANGUAGE_ID || 71),
      source_code: sandboxScript(source, publicChecks),
      cpu_time_limit: cpuTimeSec,
      wall_time_limit: wallTimeSec,
      memory_limit: memoryKb,
      max_processes_and_or_threads: Number(process.env.SANDBOX_MAX_PROCESSES || 1),
      enable_network: String(process.env.SANDBOX_NETWORK_ENABLED || "false") === "true"
    })
  });
  sendJson(res, 200, parseSandboxResult(data));
}

function validPublicChecks(checks) {
  return checks.length <= 50 && checks.every((check) => (
    String(check?.code || "").length <= 4000 &&
    String(check?.message || "").length <= 400
  ));
}

async function listModels(req, res) {
  const { baseUrl, apiKeyEnv, envHeaders } = await readJson(req);
  if (!providerEnvNames.has(String(apiKeyEnv || ""))) return sendJson(res, 400, { error: "invalid_api_key_env" });
  if (!validEnvHeaders(envHeaders)) return sendJson(res, 400, { error: "invalid_env_header" });
  const apiKey = process.env[String(apiKeyEnv || "")];
  if (!apiKey) return sendJson(res, 400, { error: "missing_api_key_env" });
  const providerUrl = httpServiceUrl(baseUrl);
  if (!providerUrl) return sendJson(res, 400, { error: "invalid_provider_url" });
  const data = await fetchJson(`${providerUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}`, ...headersFromEnv(envHeaders) }
  });
  sendJson(res, 200, data);
}

async function proxyAi(req, res) {
  const { url, apiKeyEnv, envHeaders, body } = await readJson(req);
  if (!providerEnvNames.has(String(apiKeyEnv || ""))) return sendJson(res, 400, { error: "invalid_api_key_env" });
  if (!validEnvHeaders(envHeaders)) return sendJson(res, 400, { error: "invalid_env_header" });
  const apiKey = process.env[String(apiKeyEnv || "")];
  if (!apiKey) return sendJson(res, 400, { error: "missing_api_key_env" });
  const providerUrl = httpServiceUrl(url);
  if (!providerUrl) return sendJson(res, 400, { error: "invalid_provider_url" });
  const data = await fetchJson(providerUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...headersFromEnv(envHeaders) },
    body: JSON.stringify(body)
  });
  sendJson(res, 200, data);
}

async function personality(req, res) {
  if (req.method === "GET") return sendJson(res, 200, { markdown: await readPersonality() });
  if (req.method === "POST") {
    const { markdown } = await readJson(req);
    if (markdown !== undefined && typeof markdown !== "string") return sendJson(res, 400, { error: "invalid_personality_markdown" });
    const text = markdown || "";
    if (text.length > 100000) return sendJson(res, 413, { error: "personality_too_large" });
    if (containsSensitiveData(text)) return sendJson(res, 400, { error: "sensitive_personality_data" });
    await writePersonality(text);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "DELETE") {
    const { lines } = await readJson(req);
    if (!Array.isArray(lines) || lines.some((line) => !Number.isInteger(Number(line)) || Number(line) < 1)) {
      return sendJson(res, 400, { error: "invalid_personality_lines" });
    }
    const remove = new Set((Array.isArray(lines) ? lines : []).map(Number));
    const next = (await readPersonality()).split("\n").filter((_, index) => !remove.has(index + 1)).join("\n");
    await writePersonality(next);
    return sendJson(res, 200, { ok: true, markdown: next });
  }
  sendJson(res, 405, { error: "method_not_allowed" });
}

async function readPersonality() {
  try {
    return await readFile(personalityPath, "utf8");
  } catch {
    return `# Кодовые привычки\n\n# Проблемные темы/места\n\n# Сильные стороны\n\n# Предпочтения в ответах\n`;
  }
}

async function writePersonality(markdown) {
  await mkdir(personalityPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(personalityPath, markdown, "utf8");
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  if (forbiddenStaticPath(requested)) return sendJson(res, 403, { error: "forbidden_static_path" });
  const file = normalize(join(staticRoot, requested));
  if (!file.startsWith(staticRoot)) return sendJson(res, 403, { error: "forbidden" });
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };
  let content;
  try {
    content = await readFile(file);
  } catch {
    if (requested.startsWith("/assets/")) {
      const assetFile = normalize(join(root, requested));
      if (!assetFile.startsWith(root)) return sendJson(res, 403, { error: "forbidden" });
      try {
        content = await readFile(assetFile);
      } catch {
        return sendJson(res, 404, { error: "not_found" });
      }
      res.writeHead(200, { "content-type": types[extname(assetFile)] || "application/octet-stream" });
      return res.end(content);
    }
    if (!extname(requested)) return serveStatic("/", res);
    return sendJson(res, 404, { error: "not_found" });
  }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
  res.end(content);
}

function forbiddenStaticPath(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  return parts.some((part) => part.startsWith(".")) || ["data", "workspace", "node_modules"].includes(parts[0]);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidJsonError();
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

function trimSlash(value) {
  return value.replace(/\/$/, "");
}

function httpServiceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? trimSlash(url.toString()) : "";
  } catch {
    return "";
  }
}

function headersFromEnv(envHeaders) {
  return Object.fromEntries(Object.entries(envHeaders || {}).flatMap(([header, envName]) => {
    const value = process.env[String(envName || "")];
    return value ? [[header, value]] : [];
  }));
}

function validEnvHeaders(envHeaders) {
  return Object.values(envHeaders || {}).every((envName) => providerHeaderEnvNames.has(String(envName || "")));
}

function readProviderStatus() {
  return Object.fromEntries(Object.entries(providerEnv).map(([id, envName]) => {
    const value = process.env[envName] || "";
    const status = { envName, configured: Boolean(value), masked: value ? maskSecret(value) : "" };
    if (id === "yandex") {
      const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID || "";
      status.folder = { envName: "YANDEX_AI_STUDIO_FOLDER_ID", configured: Boolean(folderId), masked: folderId ? maskSecret(folderId) : "" };
    }
    return [id, status];
  }));
}

function readSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value || "";
}

function readSettings() {
  const stored = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((row) => [row.key, row.value]));
  const {
    graphProvider: _graphProvider,
    graphLlmBaseUrl: _graphLlmBaseUrl,
    graphLlmModel: _graphLlmModel,
    graphSmallModel: _graphSmallModel,
    graphMaxTokens: _graphMaxTokens,
    ...visible
  } = stored;
  return {
    ...visible,
    workspaceRuntime: stored.workspaceRuntime || "code-server",
    workspaceRuntimeUrl: stored.workspaceRuntimeUrl || process.env.WORKSPACE_RUNTIME_URL || "http://127.0.0.1:8080",
    agentRuntimeUrl: stored.agentRuntimeUrl || process.env.AGENT_RUNTIME_URL || "http://127.0.0.1:3000",
    graphMemoryUrl: stored.graphMemoryUrl || process.env.GRAPH_MEMORY_URL || "http://127.0.0.1:8008",
    graphEmbeddingProvider: stored.graphEmbeddingProvider || stored.graphProvider || process.env.GRAPH_EMBEDDING_PROVIDER || process.env.GRAPHITI_LLM_PROVIDER || "openrouter",
    graphEmbeddingBaseUrl: stored.graphEmbeddingBaseUrl || process.env.GRAPH_EMBEDDING_BASE_URL || process.env.GRAPHITI_EMBEDDING_BASE_URL || "https://openrouter.ai/api/v1",
    graphEmbeddingModel: stored.graphEmbeddingModel || process.env.GRAPH_EMBEDDING_MODEL || process.env.GRAPHITI_EMBEDDING_MODEL || "openai/text-embedding-3-small",
    graphEmbeddingDim: stored.graphEmbeddingDim || process.env.GRAPH_EMBEDDING_DIM || process.env.GRAPHITI_EMBEDDING_DIM || "1536"
  };
}

async function writeEnvValue(name, value) {
  let text = "";
  try {
    text = await readFile(envPath, "utf8");
  } catch {
    text = "";
  }
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${escapeRegExp(name)}=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, line) : `${text}${text.endsWith("\n") || !text ? "" : "\n"}${line}\n`;
  await writeFile(envPath, text, { encoding: "utf8", mode: 0o600 });
  await chmod(envPath, 0o600);
  process.env[name] = value;
}

function maskSecret(value) {
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasLineBreak(value) {
  return /[\r\n]/.test(value);
}

function validSecretInput(value) {
  return typeof value === "string" && !hasLineBreak(value);
}

function sandboxScript(source, publicChecks) {
  return `
import contextlib
import io
import json
import traceback

source = ${JSON.stringify(source)}
checks = ${JSON.stringify(publicChecks)}
stdout = io.StringIO()
stderr = io.StringIO()
namespace = {}
results = []
status = "passed"
category = "accepted"

try:
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        exec(source, namespace)
except SyntaxError:
    status = "syntax_error"
    category = "syntax_error"
    stderr.write(traceback.format_exc())
except Exception:
    status = "runtime_error"
    category = "runtime_error"
    stderr.write(traceback.format_exc())

if status == "passed":
    for check in checks:
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                exec(check.get("code", ""), namespace)
            results.append({"name": check.get("message", "check"), "passed": True, "message": "прошла"})
        except AssertionError as error:
            status = "test_failure"
            category = "test_failure"
            results.append({"name": check.get("message", "check"), "passed": False, "message": str(error) or "assertion failed"})
        except Exception:
            status = "runtime_error"
            category = "runtime_error"
            results.append({"name": check.get("message", "check"), "passed": False, "message": traceback.format_exc()})

print(json.dumps({
    "status": status,
    "stdout": stdout.getvalue(),
    "stderr": stderr.getvalue(),
    "public_test_results": results,
    "hidden_test_summary": "Скрытые проверки не раскрываются.",
    "category": category
}, ensure_ascii=False))
`;
}

function parseSandboxResult(data) {
  const stdout = String(data.stdout || "");
  try {
    const parsed = JSON.parse(stdout.trim().split("\n").at(-1) || "{}");
    if (parsed.status) return { ...parsed, execution_time: Number(data.time || parsed.execution_time || 0), memory_used: Number(data.memory || parsed.memory_used || 0) };
  } catch {
    // Sandbox responded, but stdout did not match the JSON contract.
  }
  const statusText = String(data.status?.description || "").toLowerCase();
  const timeout = statusText.includes("time");
  return {
    status: timeout ? "timeout" : "runtime_error",
    stdout,
    stderr: String(data.stderr || data.compile_output || ""),
    execution_time: Number(data.time || 0),
    memory_used: Number(data.memory || 0),
    public_test_results: [],
    hidden_test_summary: "Скрытые проверки не запускались.",
    category: timeout ? "timeout" : "runtime_error"
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveSetting(value, min) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min;
}

function boundedIntegerSetting(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max;
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
