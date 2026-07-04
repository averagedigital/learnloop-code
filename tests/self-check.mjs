import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { assistantMarkdownToHtml, buildMascotAssistantPrompt, extractAssistantText } from "../src/mascot-assistant.js";
import { buildAdaptiveDrillPrompt, buildCodebaseLessonPrompt, buildLessonPrompt, buildModelListRequest, buildProviderPayload, buildSkillGraphPrompt, buildSocraticHintPrompt, buildTeamLeadTaskPrompt, buildTutorPrompt, createMemoryStore, gradeByLessonSpec, llmTools, modelControlPrompt, parseGeneratedJson, personalityTemplate, providers, sampleLesson, toolsForProvider, validateLessonSpec } from "../src/platform.js";

globalThis.performance = { now: () => 10 };

const storage = new Map();
const memory = createMemoryStore({
  getItem: (key) => storage.get(key),
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
});

memory.add("weak_topic", "precision and recall");
assert.equal(memory.list().length, 1);
memory.remove(memory.list()[0].id);
assert.deepEqual(memory.list(), []);

assert.deepEqual(validateLessonSpec(sampleLesson), []);
assert.ok(buildLessonPrompt("хочу pandas", []).includes("Цель ученика"));
assert.ok(buildTeamLeadTaskPrompt({ goal: "FastAPI auth", difficulty: "medium", memory: [] }).includes("small microservice"));
assert.ok(buildTeamLeadTaskPrompt({ goal: "CLI", difficulty: "easy", memory: [] }).includes("one script"));
assert.ok(buildTeamLeadTaskPrompt({ goal: "platform", difficulty: "hard", memory: [] }).includes("multiple files"));
assert.ok(buildTeamLeadTaskPrompt({ goal: "CLI", difficulty: "easy", memory: [] }).includes("Markdown-ТЗ"));
assert.ok(buildTeamLeadTaskPrompt({ goal: "CLI", difficulty: "easy", memory: [] }).includes("JSON-спецификацию"));
assert.ok(buildTeamLeadTaskPrompt({ goal: "platform", difficulty: "hard", memory: [] }).includes("files опционален"));
assert.equal(validateLessonSpec({ ...sampleLesson, tasks: [{ ...sampleLesson.tasks[0], files: [{ path: "../x", content: "" }] }] }).some((error) => error.includes("безопасным")), true);
assert.equal(validateLessonSpec({ ...sampleLesson, tasks: [{ ...sampleLesson.tasks[0], files: [{ path: "solution.py", content: "" }] }] }).some((error) => error.includes("системный workspace-файл")), true);
assert.equal(validateLessonSpec({ ...sampleLesson, tasks: [{ ...sampleLesson.tasks[0], files: [{ path: "notes.txt", content: "x".repeat(200001) }] }] }).some((error) => error.includes("слишком большой")), true);
assert.equal(validateLessonSpec({ ...sampleLesson, tasks: Array.from({ length: 21 }, (_, index) => ({ ...sampleLesson.tasks[0], id: `task-${index}` })) }).some((error) => error.includes("не больше 20")), true);
assert.equal(validateLessonSpec({ ...sampleLesson, tasks: [{ ...sampleLesson.tasks[0], publicChecks: [{ kind: "python_assert", code: "x".repeat(4001), message: "bad" }] }] }).some((error) => error.includes("publicChecks.code слишком большой")), true);
assert.ok(modelControlPrompt.includes("#task"));
assert.ok(!modelControlPrompt.includes("Ты "));
assert.ok(modelControlPrompt.includes("Markdown-ТЗ"));
assert.ok(modelControlPrompt.includes("валидный JSON для импорта"));
assert.ok(!modelControlPrompt.includes("Для урока: только валидный JSON"));
assert.deepEqual(parseGeneratedJson('## ТЗ\n\nСделать задачу.\n\n```json\n{"title":"X","tasks":[]}\n```'), { title: "X", tasks: [] });
assert.ok(personalityTemplate.includes("# Кодовые привычки"));
assert.deepEqual(llmTools.map((tool) => tool.name), ["review_personality", "add_personality", "delete_personality", "create_task", "create_test", "update_skill_graph", "create_adaptive_drill", "check_hint_leakage", "create_codebase_lesson"]);

const task = sampleLesson.tasks[0];
const failed = gradeByLessonSpec(task, task.starterCode);
assert.equal(failed.status, "test_failure");
assert.equal(failed.category, "test_failure");
assert.ok(!failed.hidden_test_summary.includes("assert"));

const delegated = gradeByLessonSpec(task, `${task.starterCode}
median = df["age"].median()
age_was_missing = df["age"].isna().astype(int)
`);
assert.equal(delegated.status, "test_failure");
assert.equal(delegated.public_test_results.every((test) => test.message.includes("Python-интерпретатор")), true);

const prompt = buildTutorPrompt({ lesson: sampleLesson, task, grade: failed, memory: [{ kind: "weak_topic", text: "precision" }], question: "Почему не прошло?" });
assert.ok(prompt.includes("Источник истины"));

const skillGraphPrompt = buildSkillGraphPrompt({ lesson: sampleLesson, task, grade: failed, memory: [] });
assert.ok(skillGraphPrompt.includes("skill_graph_update"));
assert.ok(skillGraphPrompt.includes("evidence"));

const drillPrompt = buildAdaptiveDrillPrompt({ skillGraph: [{ concept: "pandas missing values", status: "weak" }], recentTasks: [task.title] });
assert.ok(drillPrompt.includes("ровно одну слабость"));
assert.ok(drillPrompt.includes(task.title));

const leakPrompt = buildSocraticHintPrompt({ task, code: task.starterCode, question: "Дай ответ", attemptCount: 1 });
assert.ok(leakPrompt.includes("leak_level"));
assert.ok(leakPrompt.includes("не выдавать полный ответ"));

const codebasePrompt = buildCodebaseLessonPrompt({ goal: "научиться читать проект", files: ["src/platform.js", "server.mjs"], excerpt: "export function validateLessonSpec(spec) {}" });
assert.ok(codebasePrompt.includes("real_codebase_lesson"));
assert.ok(codebasePrompt.includes("src/platform.js"));
assert.ok(!codebasePrompt.includes("полный репозиторий"));

assert.throws(() => buildProviderPayload(providers[0], prompt), /модель/);

const openaiPayload = buildProviderPayload({ ...providers[0], model: "user-selected-model" }, prompt);
assert.equal(openaiPayload.url, "https://api.openai.com/v1/responses");
assert.equal(openaiPayload.body.input[0].role, "developer");

const openRouterPayload = buildProviderPayload({ ...providers[1], model: "user/open-model" }, prompt);
assert.equal(openRouterPayload.url, "https://openrouter.ai/api/v1/chat/completions");
assert.equal(openRouterPayload.body.messages[0].role, "system");
assert.equal(openRouterPayload.body.tools[0].function.name, "review_personality");

const yandexPayload = buildProviderPayload({ ...providers[2], model: "user-selected-yandex-model" }, prompt);
assert.equal(yandexPayload.url, "https://ai.api.cloud.yandex.net/v1/responses");
assert.equal(yandexPayload.apiKeyEnv, "YANDEX_AI_STUDIO_API_KEY");
assert.deepEqual(yandexPayload.envHeaders, { "x-folder-id": "YANDEX_AI_STUDIO_FOLDER_ID" });
assert.equal(yandexPayload.body.tools[0].name, "review_personality");

const modelList = buildModelListRequest(providers[1]);
assert.equal(modelList.url, "https://openrouter.ai/api/v1/models");
assert.ok(modelList.note.includes("сервере"));

const yandexModelList = buildModelListRequest(providers[2]);
assert.deepEqual(yandexModelList.envHeaders, { "x-folder-id": "YANDEX_AI_STUDIO_FOLDER_ID" });

assert.equal(toolsForProvider("openai-chat-compatible")[0].type, "function");
assert.equal(toolsForProvider("openai-chat-compatible")[0].function.name, "review_personality");

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(appSource, /const mascotFrames = Array\.from/);
assert.match(appSource, /\/assets\/mascots\/05_laptop_spiky\/frames\/idle\/frame_/);
assert.match(appSource, /CodeLearnML/);
assert.match(appSource, /КАКОЙ/);
assert.match(appSource, /КОД/);
assert.match(appSource, /ПИШЕМ/);
assert.match(appSource, /Реди/);
assert.doesNotMatch(appSource, /Начать практику/);
assert.match(appSource, /Маскот-наставник CodeLearnML/);
assert.match(appSource, /mascotPeek/);
assert.match(appSource, /aria-hidden="true"/);
assert.doesNotMatch(appSource, /useEffect|useMemo|useRef/);
assert.doesNotMatch(appSource, /navItems|quickPrompts|assistantQuickPrompts/);
assert.doesNotMatch(appSource, /function Start|function Session|function Workspace|function Progress|function Settings/);
assert.doesNotMatch(appSource, /fetch\("\/api\/responses"|fetch\("\/api\/models"|fetch\("\/api\/settings"|fetch\("\/api\/runtime\/health"/);
assert.doesNotMatch(appSource, /workspaceWorkbench|sessionComposer|agentPromptBox|agentTimeline|toolCallCard|MemoryPanel|Markdown/);
assert.doesNotMatch(appSource, /Dashboard|Practice|Studio|ProfileDialog|progressRail|OrganicArtifact|Delaunay|gsap/);
assert.doesNotMatch(appSource, /mascotCaption|paintChip|mascotStage|organic_spiky_concept/);
assert.doesNotMatch(appSource, /sampleLesson|demoTasks|createMemoryStore\(localStorage\)|localStorage/);
assert.doesNotMatch(appSource, /progressMarker|01 \/ 03/);
assert.match(mainSource, /createRoot/);
assert.match(mainSource, /import App from "\.\/App\.jsx"/);
assert.match(appStyles, /--color-dusk-violet: #8584bd/);
assert.match(appStyles, /--color-hi-vis-yellow: #f4ed36/);
assert.match(appStyles, /--color-buttery-yellow: #f9cc73/);
assert.match(appStyles, /--color-lilac-shadow: #61609a/);
assert.match(appStyles, /--color-bone-white: #f9f5f2/);
assert.match(appStyles, /\.heroPoster/);
assert.match(appStyles, /\.heroTitle/);
assert.match(appStyles, /\.headlineStack/);
assert.match(appStyles, /\.posterAction/);
assert.match(appStyles, /\.mascotPeek/);
assert.match(appStyles, /\.peekMascot/);
assert.match(appStyles, /\.headlineStack:last-child\s*\{\s*z-index: 3;/);
assert.match(appStyles, /\.mascotPeek\s*\{[\s\S]*z-index: 2;/);
assert.match(appStyles, /@keyframes mascotFrames/);
assert.match(appStyles, /animation: mascotFrames/);
assert.match(appStyles, /border-radius: 100px/);
assert.match(appStyles, /font-feature-settings: "calt" 0/);
assert.match(appStyles, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(appStyles, /linear-gradient|radial-gradient|box-shadow|drop-shadow|backdrop-filter|glass|workspaceWorkbench|sessionLayout|settingsGrid|progressLayout|mascotCaption|paintChip|mascotStage/);
assert.doesNotMatch(appStyles, /progressMarker/);
assert.doesNotMatch(appSource, /sampleLesson/);
assert.doesNotMatch(appSource, /demoTasks/);
assert.doesNotMatch(appSource, /createMemoryStore\(localStorage\)/);
assert.doesNotMatch(appSource, /localStorage\.setItem\("codelearn\.selectedMascot"/);

const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(indexSource, /<html lang="ru">/);
assert.match(indexSource, /<title>CodeLearnML/);
assert.match(indexSource, /src\/main\.jsx/);
assert.doesNotMatch(indexSource, /AI practice lab/);
assert.doesNotMatch(indexSource, /src\/app\.js/);
assert.doesNotMatch(indexSource, /monaco-editor/);

assert.equal(existsSync(new URL("../mascot-preview.html", import.meta.url)), false);
assert.equal(existsSync(new URL("../src/mascot-preview.css", import.meta.url)), false);
assert.deepEqual(readdirSync(new URL("../assets/mascots", import.meta.url), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(), ["05_laptop_spiky", "organic_spiky_concept"]);
for (const mascotState of ["idle", "typing", "inspect", "thinking", "success"]) {
  assert.equal(existsSync(new URL(`../assets/mascots/05_laptop_spiky/states/${mascotState}.png`, import.meta.url)), true);
  for (const frame of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]) {
    assert.equal(existsSync(new URL(`../assets/mascots/05_laptop_spiky/frames/${mascotState}/frame_${frame}.png`, import.meta.url)), true);
  }
}
for (const mascotState of ["idle", "typing", "inspect", "thinking", "success"]) {
  assert.equal(existsSync(new URL(`../assets/mascots/organic_spiky_concept/states/${mascotState}.png`, import.meta.url)), true);
  for (const frame of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"]) {
    assert.equal(existsSync(new URL(`../assets/mascots/organic_spiky_concept/frames/${mascotState}/frame_${frame}.png`, import.meta.url)), true);
  }
}

const mascotAssistantSource = readFileSync(new URL("../src/mascot-assistant.js", import.meta.url), "utf8");
assert.doesNotMatch(mascotAssistantSource, /localStorage/);
assert.match(mascotAssistantSource, /initialSettings/);
assert.match(mascotAssistantSource, /saveSettings\?/);
assert.match(mascotAssistantSource, /pointerdown/);
assert.match(mascotAssistantSource, /pointermove/);
assert.match(mascotAssistantSource, /openAfterPointer/);
assert.match(mascotAssistantSource, /const shouldSave = widget\.moved/);
assert.match(mascotAssistantSource, /const minX = window\.innerWidth > 720 \? 112 : EDGE/);
assert.match(mascotAssistantSource, /DRAG_THRESHOLD = 8/);
assert.match(mascotAssistantSource, /mascotAssistantResize/);
assert.match(mascotAssistantSource, /mascotAssistantIcon/);
assert.match(mascotAssistantSource, /getIconFrames/);
assert.match(mascotAssistantSource, /--mascot-frame-count/);
assert.match(mascotAssistantSource, /steps\(var\(--mascot-frame-steps,11\)\)/);
assert.match(mascotAssistantSource, /@keyframes mascotAssistantFrames/);
assert.match(mascotAssistantSource, /role="dialog"/);
assert.match(mascotAssistantSource, /noopener noreferrer/);
assert.match(mascotAssistantSource, /externalAssistantUrl/);
assert.match(mascotAssistantSource, /OpenHands agent/);
assert.match(mascotAssistantSource, /mascotAssistantAgentFrame/);

const gitignoreSource = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
assert.match(gitignoreSource, /\.env\.local/);
assert.match(gitignoreSource, /workspace\//);
assert.match(gitignoreSource, /data\/\*.sqlite-wal/);
assert.match(serverSource, /CODELEARN_WORKSPACE_ROOT/);
assert.match(serverSource, /safeWorkspaceTaskDir/);
assert.match(serverSource, /safeWorkspaceFilePath/);
assert.match(serverSource, /assertWorkspaceRealPath/);
assert.match(serverSource, /safeWorkspaceTaskId/);
assert.match(serverSource, /workspaceFileContent/);
assert.match(serverSource, /workspaceAgentFiles/);
assert.match(serverSource, /workspaceAgentRun/);
assert.match(serverSource, /fileName === "solution\.py"/);
assert.match(serverSource, /ON CONFLICT\(task_id\) DO UPDATE SET code = excluded\.code/);
assert.match(serverSource, /workspace_path_escape/);
assert.match(serverSource, /workspace_file_not_found/);
assert.match(serverSource, /writeFileIfMissing/);
assert.match(serverSource, /overwriteSolution/);
assert.match(serverSource, /missing_agent_runtime_url/);
assert.match(serverSource, /runtimeHealth/);
assert.match(serverSource, /runtimeProbe/);
assert.match(serverSource, /\/api\/runtime\/health/);
assert.match(serverSource, /invalid_agent_command/);
assert.match(serverSource, /agent_command_too_long/);
assert.match(serverSource, /\/commands/);
assert.match(serverSource, /recordWorkspaceAgentRun/);
assert.match(serverSource, /agent_command/);
assert.match(serverSource, /recordWorkspaceFileSave/);
assert.match(serverSource, /workspace_file_saved/);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS task_runs/);
assert.doesNotMatch(serverSource, /readActivity/);
assert.doesNotMatch(serverSource, /buildDevActivity/);
assert.doesNotMatch(serverSource, /CREATE TABLE IF NOT EXISTS activity_days/);
assert.doesNotMatch(serverSource, /CREATE TABLE IF NOT EXISTS memory_items/);
assert.match(serverSource, /memory: readRetrievedMemory\(\)/);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS run_messages/);
assert.match(serverSource, /sourcePrompt/);
assert.match(serverSource, /llmAnswer/);
assert.match(serverSource, /ТЗ импортировано из Session/);
assert.match(serverSource, /invalid_run_message_role/);
assert.match(serverSource, /invalid_agent_event_payload/);
assert.match(serverSource, /task_run_too_large/);
assert.match(serverSource, /taskRunTooLarge/);
assert.match(serverSource, /memoryCandidateFromRun/);
assert.match(serverSource, /test_failure/);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS agent_events/);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS learning_pipelines/);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS memory_events/);
assert.match(serverSource, /memoryEvents/);
assert.match(serverSource, /memoryEventKinds/);
assert.match(serverSource, /memoryEventSources/);
assert.match(serverSource, /invalid_memory_event_kind/);
assert.match(serverSource, /invalid_memory_event_source/);
assert.match(serverSource, /invalid_memory_event_evidence/);
assert.match(serverSource, /memory_event_too_large/);
assert.match(serverSource, /readSkillGraph/);
assert.match(serverSource, /skillStatus/);
assert.match(serverSource, /memoryEventReview/);
assert.match(serverSource, /graphMemorySync/);
assert.match(serverSource, /syncAcceptedMemoryEvents/);
assert.match(serverSource, /syncGraph === true/);
assert.match(serverSource, /graphMemorySearch/);
assert.match(serverSource, /graphSearchGroups/);
assert.match(serverSource, /dedupeGraphResults/);
assert.match(serverSource, /task_not_found/);
assert.match(serverSource, /catch \(error\)[\s\S]*graph_memory_unreachable/);
assert.match(serverSource, /graphMemoryHealth/);
assert.match(serverSource, /graphMemoryBaseUrl/);
assert.match(serverSource, /boundedLimit/);
assert.match(serverSource, /GRAPH_MEMORY_URL/);
assert.match(serverSource, /missing_graph_memory_url/);
assert.match(serverSource, /graph_memory_unreachable/);
assert.match(serverSource, /missing_graph_memory_credentials/);
assert.match(serverSource, /function graphMemoryError/);
assert.match(serverSource, /empty_graph_memory_query/);
assert.match(serverSource, /\/memory\/graph-health/);
assert.match(serverSource, /\/memory\/events/);
assert.match(serverSource, /\/memory\/search/);
assert.match(serverSource, /invalid_memory_review_status/);
assert.match(serverSource, /readRetrievedMemory/);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS assistant_chats/);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS assistant_messages/);
assert.match(serverSource, /assistantChats/);
assert.match(serverSource, /assistant_chat/);
assert.match(serverSource, /invalid_chat_message_role/);
assert.match(serverSource, /invalid_chat_label/);
assert.match(serverSource, /chat_message_too_large/);
assert.match(serverSource, /task_not_found/);
assert.match(serverSource, /progressPipeline/);
assert.match(serverSource, /invalid_pipeline_stage/);
assert.match(serverSource, /invalid_pipeline_order/);
assert.match(serverSource, /invalid_pipeline_steps/);
assert.match(serverSource, /pipeline_step_too_large/);
assert.match(serverSource, /hasPipelineStageOrder/);
assert.match(serverSource, /taskRun/);
assert.match(serverSource, /readTaskRunMessages/);
assert.match(serverSource, /readTaskAgentEvents/);
assert.match(serverSource, /value === "passed"/);
assert.match(serverSource, /value === "file_saved"/);
assert.match(serverSource, /с ошибкой/);
assert.match(mascotAssistantSource, /mascot-assistant-open/);
assert.doesNotMatch(mascotAssistantSource, /body:has\(\.homeSurface\) \.mascotAssistant\s*\{\s*display:\s*none/);
assert.match(serverSource, /JUDGE0_BASE_URL/);
assert.match(serverSource, /sandbox_not_configured/);
assert.match(serverSource, /sandboxScript/);
assert.match(serverSource, /invalid_public_checks/);
assert.match(serverSource, /public_checks_too_large/);
assert.match(serverSource, /validPublicChecks/);
assert.match(serverSource, /parseSandboxResult/);
assert.match(serverSource, /positiveNumber/);
assert.match(serverSource, /body\.memory_mb/);
assert.doesNotMatch(serverSource, /runLocalPython/);
assert.doesNotMatch(serverSource, /node:child_process/);
assert.doesNotMatch(serverSource, /pythonBin/);

const unsafeMarkdown = assistantMarkdownToHtml(`# Заголовок

- пункт

\`\`\`js
const x = "<tag>";
\`\`\`

<script>alert(1)</script>`);
assert.match(unsafeMarkdown, /<h3>Заголовок<\/h3>/);
assert.match(unsafeMarkdown, /<li>пункт<\/li>/);
assert.match(unsafeMarkdown, /data-language="js"/);
assert.match(unsafeMarkdown, /&lt;tag&gt;/);
assert.doesNotMatch(unsafeMarkdown, /<script>/);

const mascotPrompt = buildMascotAssistantPrompt("Что дальше?", { route: "workspace", task: { id: "fill-and-flag" } });
assert.match(mascotPrompt, /# Контекст страницы/);
assert.match(mascotPrompt, /fill-and-flag/);
assert.equal(extractAssistantText({ output_text: "ok" }), "ok");

const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(styleSource, /--color-dusk-violet: #8584bd/);
assert.match(styleSource, /--color-hi-vis-yellow: #f4ed36/);
assert.match(styleSource, /\.posterShell/);
assert.match(styleSource, /\.heroPoster/);
assert.match(styleSource, /\.mascotPeek/);
assert.match(styleSource, /\.peekMascot/);
assert.doesNotMatch(styleSource, /body:has\(\.homeSurface\) \.mascotAssistant\s*\{\s*display:\s*none/);
assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(styleSource, /ingredientBurger|ingredientCookbook|ingredientKnife|composerMedia|heroTicket|workspaceSolo|progressRail|agentRail|workspaceWorkbench|sessionLayout/);

const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");
assert.match(packageSource, /"vite"/);
assert.match(packageSource, /"react"/);
assert.match(packageSource, /"@vitejs\/plugin-react"/);
assert.doesNotMatch(packageSource, /"d3-delaunay"|"gsap"|"three"|"@react-three\/fiber"|"@react-three\/drei"/);
assert.match(packageSource, /"server": "node server\.mjs"/);
assert.match(packageSource, /"runtime:workspace": "docker compose -f docker-compose\.workspace\.yml up code-server openhands"/);
assert.match(packageSource, /"runtime:project": "test -n \\".*CODELEARN_PROJECT_ID.*CODELEARN_WORKSPACE_MOUNT/);
assert.match(packageSource, /"runtime:memory": "docker compose -f docker-compose\.workspace\.yml up falkordb graph-memory"/);
assert.match(packageSource, /"runtime:all": "docker compose -f docker-compose\.workspace\.yml up code-server openhands falkordb graph-memory"/);
assert.match(packageSource, /"runtime:down": "docker compose -f docker-compose\.workspace\.yml down"/);
assert.match(packageSource, /python3 tests\/memory-service-check\.py/);

const readmeSource = readFileSync(new URL("../README.md", import.meta.url), "utf8");
assert.match(readmeSource, /Локальный тренажер программирования/);
assert.match(readmeSource, /!\[Hero screen\]\(assets\/screenshots\/hero\.png\)/);
assert.match(readmeSource, /## Стек/);
assert.match(readmeSource, /## Структура/);
assert.match(readmeSource, /## Окружение/);
assert.match(readmeSource, /## Локальный запуск/);
assert.match(readmeSource, /React 19, Vite/);
assert.match(readmeSource, /Node\.js `server\.mjs`/);
assert.match(readmeSource, /CODELEARN_DB_PATH/);
assert.match(readmeSource, /JUDGE0_BASE_URL/);
assert.match(readmeSource, /GRAPH_MEMORY_URL/);
assert.match(readmeSource, /npm test/);
assert.match(readmeSource, /npm run build/);
assert.match(readmeSource, /Не коммитьте `\.env`/);
assert.doesNotMatch(readmeSource, /roadmap|Saturday morning cartoon|GPT-5\.5|SmartCaptcha/i);
assert.equal(existsSync(new URL("../assets/screenshots/hero.png", import.meta.url)), true);
assert.equal(existsSync(new URL("../DESIGN.md", import.meta.url)), false);
assert.equal(existsSync(new URL("../FRONTEND_REBUILD_NOTES.md", import.meta.url)), false);
assert.equal(existsSync(new URL("../tokens.json", import.meta.url)), false);
assert.equal(existsSync(new URL("../.env", import.meta.url)), false);
assert.equal(existsSync(new URL("../data/codelearn.sqlite", import.meta.url)), false);
assert.equal(existsSync(new URL("../workspace/fill-and-flag/task.md", import.meta.url)), false);

const ciSource = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
assert.match(ciSource, /averagedigital\/cicd_templates\/\.github\/workflows\/node-check\.yml@main/);
assert.doesNotMatch(ciSource, /deploy|workflow_dispatch/);

const dockerfileSource = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
assert.match(dockerfileSource, /npm ci/);
assert.match(dockerfileSource, /npm run build/);
assert.match(dockerfileSource, /node", "server\.mjs"/);
assert.match(dockerfileSource, /USER node/);
assert.match(dockerfileSource, /HEALTHCHECK/);
assert.match(dockerfileSource, /\/api\/app-state/);
assert.match(dockerfileSource, /CODELEARN_ENV_PATH=\/data\/\.env/);
assert.match(dockerfileSource, /mkdir -p \/data \/app\/workspace/);
assert.match(dockerfileSource, /chown -R node:node \/data \/app\/workspace/);
assert.match(dockerfileSource, /VOLUME \["\/data", "\/app\/workspace"\]/);
assert.doesNotMatch(dockerfileSource, /COPY .*\.env/);

const dockerignoreSource = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
assert.match(dockerignoreSource, /^\.git$/m);
assert.match(dockerignoreSource, /^\.env$/m);
assert.match(dockerignoreSource, /^node_modules$/m);
assert.match(dockerignoreSource, /^data$/m);
assert.match(dockerignoreSource, /^workspace$/m);

const viteSource = readFileSync(new URL("../vite.config.mjs", import.meta.url), "utf8");
assert.match(viteSource, /@vitejs\/plugin-react/);
assert.match(viteSource, /"\/api": "http:\/\/127\.0\.0\.1:4173"/);

assert.equal(existsSync(new URL("../src/OrganicArtifact.jsx", import.meta.url)), false);

assert.match(gitignoreSource, /^\.env$/m);
assert.match(gitignoreSource, /^\.env\.\*$/m);
assert.match(gitignoreSource, /^!\.env\.example$/m);
assert.match(gitignoreSource, /^data\/$/m);

const envExampleSource = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
assert.match(envExampleSource, /^OPENAI_ADMIN_KEY=$/m);
assert.match(envExampleSource, /^YANDEX_AI_STUDIO_FOLDER_ID=$/m);
assert.match(envExampleSource, /^YANDEX_AI_STUDIO_BASE_URL=https:\/\/ai\.api\.cloud\.yandex\.net\/v1$/m);
assert.match(envExampleSource, /^JUDGE0_BASE_URL=$/m);
assert.match(envExampleSource, /^JUDGE0_PYTHON_LANGUAGE_ID=71$/m);
assert.match(envExampleSource, /^SANDBOX_NETWORK_ENABLED=false$/m);
assert.doesNotMatch(envExampleSource, /VENV_PATH|PYTHON_BIN|PYTHON_TIMEOUT_MS|PYTHON_MAX_OUTPUT_BYTES/);
assert.match(envExampleSource, /^CODELEARN_ENV_PATH=\.\/\.env$/m);
assert.match(envExampleSource, /^CODELEARN_WORKSPACE_ROOT=\.\/workspace$/m);
assert.match(envExampleSource, /^CODELEARN_WORKSPACE_MOUNT=\.\/workspace$/m);
assert.match(envExampleSource, /^CODELEARN_WORKSPACE_CONTAINER_PATH=\/workspaces$/m);
assert.match(envExampleSource, /^CODE_SERVER_PORT=8080$/m);
assert.match(envExampleSource, /^OPENHANDS_PORT=3000$/m);
assert.match(envExampleSource, /^FALKORDB_PORT=6379$/m);
assert.match(envExampleSource, /^GRAPH_MEMORY_PORT=8008$/m);
assert.match(envExampleSource, /^GRAPH_MEMORY_URL=http:\/\/127\.0\.0\.1:8008$/m);
assert.match(envExampleSource, /^GRAPHITI_LLM_PROVIDER=auto$/m);
assert.match(envExampleSource, /^GRAPHITI_STRUCTURED_OUTPUT_MODE=json_object$/m);
assert.match(envExampleSource, /^YANDEX_GRAPHITI_MODEL=$/m);
assert.match(envExampleSource, /^YANDEX_GRAPHITI_SMALL_MODEL=$/m);
assert.match(envExampleSource, /^YANDEX_GRAPHITI_EMBEDDING_URL=https:\/\/llm\.api\.cloud\.yandex\.net\/foundationModels\/v1\/textEmbedding$/m);
assert.match(envExampleSource, /^YANDEX_GRAPHITI_EMBEDDING_MODEL=$/m);
assert.match(envExampleSource, /^YANDEX_GRAPHITI_EMBEDDING_DIM=256$/m);
assert.match(envExampleSource, /^YANDEX_GRAPHITI_MAX_TOKENS=4096$/m);

const workspaceComposeSource = readFileSync(new URL("../docker-compose.workspace.yml", import.meta.url), "utf8");
assert.match(workspaceComposeSource, /codercom\/code-server/);
assert.match(workspaceComposeSource, /ghcr\.io\/all-hands-ai\/openhands/);
assert.match(workspaceComposeSource, /falkordb\/falkordb/);
assert.match(workspaceComposeSource, /graph-memory/);
assert.match(workspaceComposeSource, /memory_service\/Dockerfile/);
assert.match(workspaceComposeSource, /FALKORDB_HOST: falkordb/);
assert.match(workspaceComposeSource, /OPENAI_API_KEY: "\$\{OPENAI_API_KEY:-\}"/);
assert.match(workspaceComposeSource, /OPENAI_ADMIN_KEY: "\$\{OPENAI_ADMIN_KEY:-\}"/);
assert.match(workspaceComposeSource, /GRAPHITI_LLM_PROVIDER: "\$\{GRAPHITI_LLM_PROVIDER:-auto\}"/);
assert.match(workspaceComposeSource, /GRAPHITI_STRUCTURED_OUTPUT_MODE: "\$\{GRAPHITI_STRUCTURED_OUTPUT_MODE:-json_object\}"/);
assert.match(workspaceComposeSource, /YANDEX_AI_STUDIO_API_KEY: "\$\{YANDEX_AI_STUDIO_API_KEY:-\}"/);
assert.match(workspaceComposeSource, /YANDEX_AI_STUDIO_FOLDER_ID: "\$\{YANDEX_AI_STUDIO_FOLDER_ID:-\}"/);
assert.match(workspaceComposeSource, /YANDEX_AI_STUDIO_BASE_URL: "\$\{YANDEX_AI_STUDIO_BASE_URL:-https:\/\/ai\.api\.cloud\.yandex\.net\/v1\}"/);
assert.match(workspaceComposeSource, /YANDEX_GRAPHITI_MODEL: "\$\{YANDEX_GRAPHITI_MODEL:-\}"/);
assert.match(workspaceComposeSource, /YANDEX_GRAPHITI_EMBEDDING_URL: "\$\{YANDEX_GRAPHITI_EMBEDDING_URL:-https:\/\/llm\.api\.cloud\.yandex\.net\/foundationModels\/v1\/textEmbedding\}"/);
assert.match(workspaceComposeSource, /YANDEX_GRAPHITI_EMBEDDING_DIM: "\$\{YANDEX_GRAPHITI_EMBEDDING_DIM:-256\}"/);
assert.match(workspaceComposeSource, /YANDEX_GRAPHITI_MAX_TOKENS: "\$\{YANDEX_GRAPHITI_MAX_TOKENS:-4096\}"/);
assert.match(workspaceComposeSource, /redis-cli", "ping"/);
assert.match(workspaceComposeSource, /condition: service_healthy/);
assert.match(workspaceComposeSource, /\$\{CODELEARN_WORKSPACE_MOUNT:-\.\/workspace\}:\$\{CODELEARN_WORKSPACE_CONTAINER_PATH:-\/workspaces\}/);
assert.match(workspaceComposeSource, /SANDBOX_WORKSPACE_BASE: "\$\{CODELEARN_WORKSPACE_CONTAINER_PATH:-\/workspaces\}"/);
assert.doesNotMatch(workspaceComposeSource, /\.env/);

const memoryServiceSource = readFileSync(new URL("../memory_service/service.py", import.meta.url), "utf8");
assert.match(memoryServiceSource, /from graphiti_core import Graphiti/);
assert.match(memoryServiceSource, /from graphiti_core\.driver\.falkordb_driver import FalkorDriver/);
assert.match(memoryServiceSource, /OpenAIGenericClient/);
assert.match(memoryServiceSource, /YandexOpenAIGenericClient/);
assert.match(memoryServiceSource, /OpenAIEmbedder/);
assert.match(memoryServiceSource, /YandexOpenAIEmbedder/);
assert.match(memoryServiceSource, /yandex_text_embedding/);
assert.match(memoryServiceSource, /foundationModels\/v1\/textEmbedding/);
assert.match(memoryServiceSource, /OpenAIRerankerClient/);
assert.match(memoryServiceSource, /AsyncOpenAI/);
assert.match(memoryServiceSource, /deepseek-v4-flash/);
assert.match(memoryServiceSource, /text-embeddings-v2-doc/);
assert.match(memoryServiceSource, /YANDEX_AI_STUDIO_API_KEY/);
assert.match(memoryServiceSource, /YANDEX_AI_STUDIO_FOLDER_ID/);
assert.match(memoryServiceSource, /YANDEX_GRAPHITI_MAX_TOKENS/);
assert.match(memoryServiceSource, /GRAPHITI_STRUCTURED_OUTPUT_MODE/);
assert.match(memoryServiceSource, /source=episode_type\.json/);
assert.match(memoryServiceSource, /group_id=episode\["group_id"\]/);
assert.match(memoryServiceSource, /group_ids=\[group_id\]/);
assert.match(memoryServiceSource, /health_status/);
assert.match(memoryServiceSource, /run_async/);
assert.match(memoryServiceSource, /run_until_complete/);
assert.match(memoryServiceSource, /graphiti_unavailable/);
assert.match(memoryServiceSource, /missing_graph_memory_credentials/);
assert.match(memoryServiceSource, /has_graphiti_credentials/);
assert.match(memoryServiceSource, /graphiti_not_installed/);
assert.match(memoryServiceSource, /bounded_limit/);
assert.match(memoryServiceSource, /invalid_json/);
assert.match(memoryServiceSource, /memory_event_too_large/);

const memoryServiceRequirements = readFileSync(new URL("../memory_service/requirements.txt", import.meta.url), "utf8");
assert.match(memoryServiceRequirements, /graphiti-core\[falkordb\]/);
const memoryServiceDockerfile = readFileSync(new URL("../memory_service/Dockerfile", import.meta.url), "utf8");
assert.match(memoryServiceDockerfile, /HEALTHCHECK/);
assert.match(memoryServiceDockerfile, /\/live/);

assert.match(serverSource, /headersFromEnv/);
assert.match(serverSource, /providerEnvNames/);
assert.match(serverSource, /validEnvHeaders/);
assert.match(serverSource, /invalid_api_key_env/);
assert.match(serverSource, /invalid_env_header/);
assert.match(serverSource, /forbiddenStaticPath/);
assert.match(serverSource, /forbidden_static_path/);
assert.match(serverSource, /staticRoot = normalize\(join\(root, "dist"\)\)/);
assert.match(serverSource, /join\(staticRoot, requested\)/);
assert.match(serverSource, /\.webp": "image\/webp"/);
assert.match(serverSource, /requested\.startsWith\("\/assets\/"\)/);
assert.match(serverSource, /join\(root, requested\)/);
assert.match(serverSource, /api_not_found/);
assert.match(serverSource, /personality_too_large/);
assert.match(serverSource, /invalid_personality_lines/);
assert.match(serverSource, /InvalidJsonError/);
assert.match(serverSource, /invalid_json/);
assert.match(serverSource, /httpServiceUrl/);
assert.match(serverSource, /invalid_provider_url/);
assert.match(serverSource, /invalid_provider_id/);
assert.match(serverSource, /mascotIds/);
assert.match(serverSource, /invalid_mascot_id/);
assert.match(serverSource, /invalid_mascot_settings/);
assert.match(serverSource, /invalid_workspace_runtime/);
assert.match(serverSource, /invalid_workspace_runtime_url/);
assert.match(serverSource, /invalid_sandbox_cpu_time/);
assert.match(serverSource, /invalid_sandbox_memory/);
assert.match(serverSource, /function positiveSetting/);
assert.match(serverSource, /invalid_secret_value/);
assert.match(serverSource, /function validSecretInput/);
assert.match(serverSource, /invalid_agent_runtime_url/);
assert.match(serverSource, /invalid_graph_memory_url/);
assert.match(serverSource, /invalid_sandbox_url/);
assert.match(serverSource, /invalid_service_url/);
assert.match(serverSource, /YANDEX_AI_STUDIO_FOLDER_ID/);
assert.match(serverSource, /function readSettings/);
assert.match(serverSource, /WORKSPACE_RUNTIME_URL/);
assert.match(serverSource, /CREATE TABLE IF NOT EXISTS lessons/);
assert.match(serverSource, /importLesson/);
assert.match(serverSource, /validateLessonSpec/);
assert.match(serverSource, /invalid_lesson_spec/);
assert.match(serverSource, /tasks must not exceed 20/);
assert.match(serverSource, /publicChecks\.code is too large/);
assert.match(serverSource, /function tooLong/);
assert.match(serverSource, /writeImportedWorkspaceFiles/);
assert.match(serverSource, /files\.path must be a safe relative path/);
assert.match(serverSource, /files\.content is too large/);
assert.match(serverSource, /writeWorkspaceFiles\(task\.id\)/);
assert.match(serverSource, /CODELEARN_DB_PATH/);
assert.match(serverSource, /CODELEARN_SEED_DEV_DATA/);
assert.doesNotMatch(serverSource, /AQVN/);

console.log("self-check passed");
