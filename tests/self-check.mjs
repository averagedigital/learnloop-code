import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { assistantMarkdownToHtml, buildMascotAssistantPrompt, clampMascotSettings, extractAssistantText, normalizeMascotContext } from "../src/mascot-assistant.js";
import { buildActivityCalendar, buildActivityEvents, buildMemoryGraph, fitMemoryGraphView, panMemoryGraphView, profileMascotFrameSrc, zoomMemoryGraphView } from "../src/profile.js";
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
assert.ok(modelControlPrompt.includes("вопросы по коду"));
assert.ok(modelControlPrompt.includes("архитектур"));
assert.ok(modelControlPrompt.includes("тест"));
assert.ok(modelControlPrompt.includes("документац"));
assert.ok(modelControlPrompt.includes("доступные инструменты"));
assert.ok(modelControlPrompt.includes("не заявляй, что действие выполнено"));
assert.ok(modelControlPrompt.includes("==ключевой вывод=="));
assert.ok(modelControlPrompt.includes("редко"));
assert.ok(!modelControlPrompt.includes("Для теста: ровно 10 вопросов"));
assert.deepEqual(parseGeneratedJson('## ТЗ\n\nСделать задачу.\n\n```json\n{"title":"X","tasks":[]}\n```'), { title: "X", tasks: [] });
assert.ok(personalityTemplate.includes("# Кодовые привычки"));
assert.deepEqual(llmTools.map((tool) => tool.name), ["review_personality", "add_personality", "delete_personality", "create_task", "create_test", "remember_context", "update_skill_graph", "create_adaptive_drill", "check_hint_leakage", "create_codebase_lesson"]);

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

const chatPrompt = "user: Почему этот код падает?";
assert.throws(() => buildProviderPayload(providers[0], chatPrompt), /модель/);

const openaiPayload = buildProviderPayload({ ...providers[0], model: "user-selected-model" }, chatPrompt);
assert.equal(openaiPayload.url, "https://api.openai.com/v1/responses");
assert.equal(openaiPayload.body.instructions, modelControlPrompt);
assert.equal(openaiPayload.body.input, chatPrompt);
assert.equal(openaiPayload.body.input.includes(modelControlPrompt), false);
assert.equal("tools" in openaiPayload.body, false);

const openRouterPayload = buildProviderPayload({ ...providers[1], model: "user/open-model" }, chatPrompt);
assert.equal(openRouterPayload.url, "https://openrouter.ai/api/v1/chat/completions");
assert.equal(openRouterPayload.body.messages[0].role, "system");
assert.equal(openRouterPayload.body.messages[1].content, chatPrompt);
assert.equal(openRouterPayload.body.messages[1].content.includes(modelControlPrompt), false);
assert.equal("tools" in openRouterPayload.body, false);

const yandexPayload = buildProviderPayload({ ...providers[2], model: "user-selected-yandex-model" }, chatPrompt);
assert.equal(yandexPayload.url, "https://ai.api.cloud.yandex.net/v1/responses");
assert.equal(yandexPayload.apiKeyEnv, "YANDEX_AI_STUDIO_API_KEY");
assert.deepEqual(yandexPayload.envHeaders, { "x-folder-id": "YANDEX_AI_STUDIO_FOLDER_ID" });
assert.equal("tools" in yandexPayload.body, false);

const modelList = buildModelListRequest(providers[1]);
assert.equal(modelList.url, "https://openrouter.ai/api/v1/models");
assert.ok(modelList.note.includes("сервере"));

const yandexModelList = buildModelListRequest(providers[2]);
assert.deepEqual(yandexModelList.envHeaders, { "x-folder-id": "YANDEX_AI_STUDIO_FOLDER_ID" });

assert.equal(toolsForProvider("openai-chat-compatible")[0].type, "function");
assert.equal(toolsForProvider("openai-chat-compatible")[0].function.name, "create_task");
assert.deepEqual(toolsForProvider("openai-chat-compatible").map((tool) => tool.function.name), ["create_task", "create_test", "remember_context"]);
assert.deepEqual(toolsForProvider("openai-chat-compatible")[0].function.parameters.properties.language.enum, ["python", "javascript"]);
assert.equal(toolsForProvider("openai-chat-compatible")[1].function.parameters.properties.questions.minItems, 4);
assert.equal(toolsForProvider("openai-responses")[1].parameters.properties.questions.maxItems, 15);
assert.equal(toolsForProvider("openai-responses")[2].parameters.properties.memories.maxItems, 4);
assert.deepEqual(toolsForProvider("openai-responses")[2].parameters.properties.memories.items.required, ["category", "text", "subject", "relation", "object"]);

const activity = buildActivityCalendar({
  taskLogs: [{ updatedAt: "2026-07-08T09:00:00.000Z" }],
  assistantChats: [{ messages: [
    { createdAt: "2026-07-08T10:00:00.000Z" },
    { createdAt: "2026-07-08T10:01:00.000Z" }
  ] }],
  memoryEvents: [{ createdAt: "2026-07-08T11:00:00.000Z" }],
  quizAttempts: [{ createdAt: "2026-07-08T12:00:00.000Z", correctCount: 3, totalCount: 4 }]
}, 2, new Date("2026-07-10T12:00:00.000Z"));
const activeCell = activity.weeks.flat().find((cell) => cell.date === "2026-07-08");
assert.equal(activity.total, 5);
assert.equal(activity.activeDays, 1);
assert.equal(activeCell.count, 5);
assert.equal(activeCell.level, 4);
assert.equal(buildActivityCalendar({}, undefined, new Date("2026-07-10T12:00:00.000Z")).weeks.length, 52);
const activityEvents = buildActivityEvents({
  quizAttempts: [{ id: "quiz-1", topic: "Data leakage", correctCount: 3, totalCount: 4, createdAt: "2026-07-10T12:00:00.000Z" }],
  memoryEvents: [{ id: "memory-1", text: "Предпочитает короткие ответы", reviewStatus: "accepted", createdAt: "2026-07-10T11:00:00.000Z" }],
  taskLogs: [{ id: "task-1", label: "Задача завершена", status: "passed", updatedAt: "2026-07-10T10:00:00.000Z" }]
});
assert.deepEqual(activityEvents.map((event) => event.type), ["quiz", "memory", "task"]);
assert.deepEqual(activityEvents[0], { id: "quiz-1", type: "quiz", title: "Пройден тест", detail: "Data leakage", value: "3/4 баллов", createdAt: "2026-07-10T12:00:00.000Z" });
const memoryGraph = buildMemoryGraph([
  { uuid: "edge-1", subject: "CodeLearnML", relation: "uses", object: "FalkorDB", fact: "Uses FalkorDB" },
  { uuid: "edge-2", subject: "CodeLearnML", relation: "stores", object: "direct triples", fact: "Stores direct triples" }
]);
assert.equal(memoryGraph.nodes.length, 3);
assert.equal(memoryGraph.edges.length, 2);
assert.equal(memoryGraph.nodes[0].id, "CodeLearnML");
assert.equal(memoryGraph.edges[0].from.id, "CodeLearnML");
assert.deepEqual(buildMemoryGraph([
  { uuid: "edge-1", subject: "CodeLearnML", relation: "uses", object: "FalkorDB", fact: "Uses FalkorDB" },
  { uuid: "edge-2", subject: "CodeLearnML", relation: "stores", object: "direct triples", fact: "Stores direct triples" }
]), memoryGraph);

function boxesOverlap(left, right, gap = 0) {
  return left.x - gap < right.x + right.width && left.x + left.width + gap > right.x && left.y - gap < right.y + right.height && left.y + left.height + gap > right.y;
}

for (const edgeCount of [1, 4, 15, 24]) {
  const graph = buildMemoryGraph(Array.from({ length: edgeCount }, (_, index) => ({
    uuid: `edge-${index}`,
    subject: index % 3 === 0 ? "user" : `subject-${index}`,
    relation: `relation-${index}`,
    object: `object-${index}`,
    fact: `Полный сохранённый факт ${index}`,
    createdAt: `2026-07-10T12:${String(index).padStart(2, "0")}:00.000Z`,
    groupId: "codelearn-local"
  })), 24);
  assert.equal(graph.edges.length, edgeCount);
  for (let left = 0; left < graph.nodes.length; left += 1) {
    assert.ok(graph.nodes[left].width > 0 && graph.nodes[left].height > 0);
    for (let right = left + 1; right < graph.nodes.length; right += 1) {
      assert.equal(boxesOverlap(graph.nodes[left], graph.nodes[right], 8), false, `node collision at ${edgeCount} edges`);
    }
  }
  for (const edge of graph.edges) {
    assert.equal(graph.nodes.some((node) => boxesOverlap(edge.labelBox, node, 4)), false, `edge label overlaps a node at ${edgeCount} edges`);
    assert.equal(edge.fact, `Полный сохранённый факт ${edge.index}`);
  }
}

const dedupedGraph = buildMemoryGraph([
  { uuid: "one", subject: "user", relation: "prefers", object: "Rust", fact: "one" },
  { uuid: "two", subject: "user", relation: "uses", object: "Rust", fact: "two" }
]);
assert.equal(dedupedGraph.nodes.filter((node) => node.id === "user").length, 1);
assert.equal(dedupedGraph.nodes.filter((node) => node.id === "Rust").length, 1);
assert.deepEqual(fitMemoryGraphView(memoryGraph), { x: 0, y: 0, width: memoryGraph.width, height: memoryGraph.height });
assert.ok(zoomMemoryGraphView(fitMemoryGraphView(memoryGraph), 2, memoryGraph).width < memoryGraph.width);
assert.ok(panMemoryGraphView(fitMemoryGraphView(memoryGraph), 100, 100, memoryGraph).x >= 0);
assert.equal(profileMascotFrameSrc("05_laptop_spiky", "thinking", 13), "/assets/mascots/05_laptop_spiky/frames/thinking/frame_02.png");
assert.equal(profileMascotFrameSrc("organic_spiky_concept", "typing", 23), "/assets/mascots/organic_spiky_concept/frames/typing/frame_24.png");

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../src/ProfileOverlay.jsx", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(appSource, /profileMascotFrameSrc/);
assert.match(appSource, /setInterval/);
assert.match(appSource, /profileMascotFrameSrc\("05_laptop_spiky", "idle", frameIndex\)/);
assert.match(appSource, /CodeLearnML/);
assert.match(appSource, /КАКОЙ/);
assert.match(appSource, /КОД/);
assert.match(appSource, /ПИШЕМ/);
assert.match(appSource, /Реди/);
assert.doesNotMatch(appSource, /Начать практику/);
assert.match(appSource, /activeTab/);
assert.match(appSource, /assistantMarkdownToHtml/);
assert.match(appSource, /requestJson/);
assert.match(appSource, /chatHistory/);
assert.match(appSource, /startNewChat/);
assert.match(appSource, /selectChat/);
assert.match(appSource, /handleComposerKeyDown/);
assert.match(appSource, /dangerouslySetInnerHTML/);
assert.match(appSource, /window\.location\.hash/);
assert.match(appSource, /\/api\/app-state/);
assert.match(appSource, /\/api\/runtime\/health/);
assert.match(appSource, /\/api\/assistant\/chats/);
assert.match(appSource, /\/api\/assistant\/respond/);
assert.doesNotMatch(appSource, /\/api\/responses/);
assert.doesNotMatch(appSource, /buildProviderPayload/);
assert.match(appSource, /chatComposer/);
assert.match(appSource, /CanvasNeuralFlow/);
assert.match(appSource, /composerNeuralCanvas/);
assert.match(appSource, /ResizeObserver/);
assert.doesNotMatch(appSource, /ComposerNeuralFlow|animateMotion/);
assert.doesNotMatch(appSource, /chatComposer composerGlass liquidGlass/);
assert.doesNotMatch(appSource, /const prompt = `\$\{modelControlPrompt\}/);
assert.match(appSource, /Куратор LLM/);
assert.match(appSource, /Что попрактикуем сегодня\?/);
assert.doesNotMatch(appSource, /Разбери этот код и объясни, где риск ошибки\./);
assert.doesNotMatch(appSource, /Куратор LLM<\/strong>/);
assert.match(appSource, /sidebarHandle/);
assert.match(appSource, /<div className="sidebarHeader">[\s\S]*className="sidebarHandle"/);
assert.match(appSource, /activeTab === "tasks" \? "Сохранённые задачи" : "Сохранённые чаты"/);
assert.match(appSource, /activeTab === "tests" \? tests\.map/);
assert.match(appSource, /activeTab === "tasks" \? tasks\.map/);
assert.match(appSource, /onClick=\{\(\) => openTest\(test\.id\)\}/);
assert.match(appSource, /onClick=\{\(\) => openTask\(task\.id\)\}/);
assert.match(appSource, />Запустить код<\/button>/);
assert.match(appSource, /Ревью LLM/);
assert.match(appSource, /taskTutorMascot/);
assert.match(appSource, /Проведи ревью текущего решения/);
assert.doesNotMatch(appSource, />Submit<\/button>/);
assert.match(appSource, /activeTab === "chat" \? <button className="newChatButton"/);
assert.doesNotMatch(appSource, /className="testPicker"/);
assert.match(appSource, /composerMascot/);
assert.match(appSource, /ProfileOverlay/);
assert.match(appSource, /profileTrigger/);
assert.match(appSource, /workspaceNav/);
assert.match(appSource, /aria-label="Новый чат"/);
assert.doesNotMatch(appSource, /seedMessages|toolPanel|sidebarSearch|chatTheme/);
assert.match(appSource, /Маскот-наставник CodeLearnML/);
assert.match(appSource, /mascotPeek/);
assert.match(appSource, /aria-hidden="true"/);
assert.doesNotMatch(appSource, /useMemo/);
assert.doesNotMatch(appSource, /navItems|quickPrompts|assistantQuickPrompts/);
assert.doesNotMatch(appSource, /function Start|function Session|function Workspace|function Progress|function Settings/);
assert.doesNotMatch(appSource, /fetch\("\/api\/models"|fetch\("\/api\/settings"/);
assert.doesNotMatch(appSource, /workspaceWorkbench|sessionComposer|agentPromptBox|agentTimeline|toolCallCard|MemoryPanel/);
assert.doesNotMatch(appSource, /Dashboard|Practice|Studio|progressRail|OrganicArtifact|Delaunay|gsap/);
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
assert.match(appStyles, /\.appShell/);
assert.match(appStyles, /\.chatMode/);
assert.match(appStyles, /\.chatSidebar/);
assert.match(appStyles, /\.chatHistory/);
assert.match(appStyles, /\.sidebarHandle/);
assert.doesNotMatch(appStyles, /\.sidebarHandle\s*\{[^}]*position:\s*absolute/s);
assert.match(appStyles, /\.testHistory/);
assert.match(appStyles, /\.composerRow/);
assert.match(appStyles, /\.composerMascot/);
assert.match(appStyles, /\.chatEmpty/);
assert.match(appStyles, /\.chatMarkdown/);
assert.match(appStyles, /\.chatSurface/);
assert.match(profileSource, /id: "graph-memory"/);
assert.match(profileSource, /\/api\/memory\/graph-items/);
assert.match(profileSource, /className="memoryGraph"/);
assert.match(profileSource, /markerEnd="url\(#memory-arrow\)"/);
assert.match(profileSource, /Память пока пуста/);
assert.match(profileSource, /Не удалось прочитать Graph Memory/);
assert.doesNotMatch(profileSource, /Фактические связи, которые чатовая LLM передала backend-у и сохранила в граф\./);
assert.doesNotMatch(profileSource, /существующий \/api\/personality/);
assert.match(profileSource, /activityEvents/);
assert.match(profileSource, /personalityWorkspace/);
assert.match(appStyles, /\.memoryGraph/);
assert.match(appStyles, /\.activityEvents/);
assert.match(appStyles, /\.personalityWorkspace/);
assert.doesNotMatch(appStyles, /\.graphMemoryCard/);
assert.match(appStyles, /\.chatMessage/);
assert.match(appStyles, /\.chatComposer/);
assert.match(appStyles, /\.composerError/);
assert.match(appStyles, /\.profileDialog/);
assert.match(appStyles, /\.activityGrid/);
assert.match(appStyles, /\.profileTrigger/);
assert.match(appStyles, /\.workspaceNav/);
assert.match(appStyles, /\.composerGlass/);
assert.match(appStyles, /\.liquidGlass/);
assert.match(appStyles, /\.liquidGlass > :not\(\.srOnly\)/);
assert.doesNotMatch(appStyles, /\.liquidGlass > \*/);
assert.match(appStyles, /\.composerNeuralCanvas/);
assert.doesNotMatch(appStyles, /@keyframes organicNeuralFlow|\.composerNeuralFlow|\.neuralPath/);
assert.match(appStyles, /\.chatThread::-webkit-scrollbar/);
assert.match(appStyles, /\.profileClose::before/);
assert.match(appStyles, /\.heroTitle/);
assert.match(appStyles, /\.headlineStack/);
assert.match(appStyles, /\.posterAction/);
assert.match(appStyles, /\.mascotPeek/);
assert.match(appStyles, /\.peekMascot/);
assert.match(appStyles, /\.headlineStack:last-child\s*\{\s*z-index: 3;/);
assert.match(appStyles, /\.mascotPeek\s*\{[\s\S]*z-index: 2;/);
assert.doesNotMatch(appStyles, /@keyframes composerMascotBob/);
assert.match(appStyles, /border-radius: 100px/);
assert.match(appStyles, /font-feature-settings: "calt" 0/);
assert.match(appStyles, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(appStyles, /drop-shadow|workspaceWorkbench|sessionLayout|settingsGrid|progressLayout|mascotCaption|paintChip|mascotStage/);
assert.doesNotMatch(appStyles, /progressMarker/);
assert.doesNotMatch(appSource, /sampleLesson/);
assert.doesNotMatch(appSource, /demoTasks/);
assert.doesNotMatch(appSource, /createMemoryStore\(localStorage\)/);
assert.doesNotMatch(appSource, /localStorage\.setItem\("codelearn\.selectedMascot"/);
assert.match(profileSource, /<dialog/);
assert.match(profileSource, /Обзор/);
assert.match(profileSource, /profileNameInput/);
assert.match(profileSource, /profileAvatarChoices/);
assert.doesNotMatch(profileSource, /CodeLearnML profile/);
assert.doesNotMatch(profileSource, /реальные события сервиса/);
assert.doesNotMatch(profileSource, /Подключение использует существующий server-side proxy/);
assert.doesNotMatch(profileSource, /Переключатель не показан/);
assert.match(profileSource, /modelPicker/);
assert.match(profileSource, /aria-label="Доступные модели"/);
assert.match(profileSource, /connectProviderAndLoadModels/);
assert.match(profileSource, /Подключить и загрузить модели/);
assert.match(profileSource, /12 месяцев/);
assert.doesNotMatch(profileSource, /6 мес/);
assert.match(profileSource, /LLM и стек/);
assert.match(profileSource, /Персонализация/);
assert.match(profileSource, /\/api\/settings/);
assert.match(profileSource, /\/api\/personality/);
assert.match(profileSource, /\/api\/models/);

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
assert.match(mascotAssistantSource, /const minX = desktop \? 112 : EDGE/);
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
assert.deepEqual(normalizeMascotContext({
  surface: "task",
  taskId: "task-1",
  testId: "must-not-leak",
  question: "Исправить функцию",
  status: "failed",
  executionEvidence: {
    status: "failed",
    feedback: "Один public check не прошёл",
    stdout: "visible output",
    stderr: "visible error",
    publicChecks: [{ name: "empty input", passed: false, hiddenAnswer: "secret" }],
    hiddenChecks: [{ answer: "secret" }],
    hostPath: "/private/workspace/task-1"
  },
  settings: { providerApiKey: "secret" },
  dom: "<body>secret</body>"
}), {
  surface: "task",
  taskId: "task-1",
  question: "Исправить функцию",
  status: "failed",
  executionEvidence: {
    status: "failed",
    feedback: "Один public check не прошёл",
    stdout: "visible output",
    stderr: "visible error",
    publicChecks: [{ name: "empty input", passed: false }]
  }
});
assert.deepEqual(normalizeMascotContext({ surface: "unknown", testId: "test-1" }), { surface: "chat" });
assert.deepEqual(clampMascotSettings({ x: -100, y: 999, size: 400 }, { width: 390, height: 844, dialogOpen: false }), { x: 12, y: 642, size: 190 });
assert.deepEqual(clampMascotSettings({ x: 1300, y: -2, size: 100 }, { width: 1366, height: 768, dialogOpen: true }), { x: 1254, y: 12, size: 100 });
assert.match(appSource, /initMascotAssistant/);
assert.match(appSource, /\/api\/assistant\/respond\/stream/);
assert.match(appSource, /mascotAssistantSettings/);
assert.match(appSource, /surface:\s*"graph-memory"/);
assert.match(mascotAssistantSource, /event\.key === "Enter"/);
assert.match(mascotAssistantSource, /event\.key === " "/);
assert.match(mascotAssistantSource, /reasoning_delta/);
assert.match(mascotAssistantSource, /tool_start/);
assert.match(mascotAssistantSource, /popover: "manual"/);
assert.match(mascotAssistantSource, /export function raiseMascotAssistant/);
assert.match(appSource, /onOpened=\{raiseMascotAssistant\}/);
assert.match(appSource, /function isMascotChat/);
assert.match(appSource, /!chat\.taskId && !isMascotChat\(chat\)/);
assert.match(appSource, /history\.find\(\(chat\) => !chat\.taskId && !isMascotChat\(chat\)\)/);
assert.match(mascotAssistantSource, /mascotAssistantMessage chatMessage/);
assert.match(mascotAssistantSource, /mascotAssistantReasoning reasoningDisclosure/);
assert.match(mascotAssistantSource, /mascotAssistantBody chatMarkdown/);
assert.match(mascotAssistantSource, /mascotAssistantForm chatComposer composerGlass/);

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
assert.match(serverSource, /fileName === solutionFileName\(taskLanguage\)/);
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
assert.match(serverSource, /JOIN quiz_tests/);
assert.match(serverSource, /memoryEvents/);
assert.match(serverSource, /memoryEventKinds/);
assert.doesNotMatch(serverSource, /memoryCandidateFromChatMessage/);
assert.match(serverSource, /remember_context/);
assert.match(serverSource, /assistantGenerated/);
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
assert.match(serverSource, /\/api\/memory\/graph-items/);
assert.match(serverSource, /\/memory\/items/);
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
assert.match(serverSource, /function judge0BaseUrl/);
assert.match(serverSource, /https:\/\/ce\.judge0\.com/);
assert.match(serverSource, /sandboxScript/);
assert.match(serverSource, /function asciiJson/);
assert.match(serverSource, /invalid_public_checks/);
assert.match(serverSource, /public_checks_too_large/);
assert.match(serverSource, /validPublicChecks/);
assert.match(serverSource, /parseSandboxResult/);
assert.match(serverSource, /positiveNumber/);
assert.match(serverSource, /body\.memory_mb/);
assert.doesNotMatch(serverSource, /runLocalPython/);
assert.match(serverSource, /spawn\("docker", runtimeComposeArgs/);
assert.doesNotMatch(serverSource, /shell:\s*true/);
assert.doesNotMatch(serverSource, /pythonBin/);

const unsafeMarkdown = assistantMarkdownToHtml(`# Заголовок

- пункт

1. первый
2. второй

| Файл | Статус |
| --- | --- |
| app.js | готов |

> Важное замечание

**жирный** и \`inline\`

\`\`\`js
const answer = true;
\`\`\`

<script>alert(1)</script>

[unsafe](javascript:alert(1))`);
assert.match(unsafeMarkdown, /<h3>Заголовок<\/h3>/);
assert.match(unsafeMarkdown, /<li>пункт<\/li>/);
assert.match(unsafeMarkdown, /<ol><li>первый<\/li><li>второй<\/li><\/ol>/);
assert.match(unsafeMarkdown, /<table>/);
assert.match(unsafeMarkdown, /<th>Файл<\/th>/);
assert.match(unsafeMarkdown, /<td>готов<\/td>/);
assert.match(unsafeMarkdown, /data-language="js"/);
assert.match(unsafeMarkdown, /<blockquote><p>Важное замечание<\/p><\/blockquote>/);
assert.match(unsafeMarkdown, /<strong>жирный<\/strong>/);
assert.match(unsafeMarkdown, /<span class="syntaxKeyword">const<\/span>/);
assert.doesNotMatch(unsafeMarkdown, /<script>/);
assert.doesNotMatch(unsafeMarkdown, /href="javascript:/);
const highlightedMarkdown = assistantMarkdownToHtml("==важно==, затем `==код==` и [==ссылка==](https://example.com). Ещё ==одно==.");
assert.match(highlightedMarkdown, /<mark>важно<\/mark>/);
assert.match(highlightedMarkdown, /<code>==код==<\/code>/);
assert.match(highlightedMarkdown, /<a href="https:\/\/example\.com"[^>]*><mark>ссылка<\/mark><\/a>/);
assert.match(highlightedMarkdown, /<mark>одно<\/mark>/);
assert.equal((highlightedMarkdown.match(/<mark>/g) || []).length, 3);
assert.match(assistantMarkdownToHtml("Незакрытое ==выделение"), /==выделение/);
for (const payload of ["==<script>alert(1)</script>==", "==<img src=x onerror=alert(1)>==", "==<b onclick=alert(1)>опасно</b>=="]) {
  const rendered = assistantMarkdownToHtml(payload);
  assert.doesNotMatch(rendered, /<script|<img|<b\s/i);
  assert.match(rendered, /<mark>/);
}
assert.match(appSource, /assistantMarkdownToHtml\(message\.content\)/);
assert.match(appSource, /\/api\/tests\/.*\/attempts/);
assert.match(appSource, /quizProgress/);
assert.match(appSource, /className=\{`quizOption \$\{state\}`\}/);
assert.match(appStyles, /\.quizOption\.correct/);
assert.match(appStyles, /\.quizOption\.incorrect/);
assert.match(appSource, /Правильно/);
assert.match(appSource, /context\.lineWidth = 0\.65/);
assert.match(profileSource, /personalityDirty/);
assert.doesNotMatch(profileSource, /className="personalityGuide"/);
assert.match(appStyles, /font: 900 clamp\(30px, 3\.4vw, 46px\)/);
assert.match(appStyles, /\.chatMarkdown mark/);

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
assert.match(packageSource, /"start": "npm run runtime:all && node server\.mjs"/);
assert.match(packageSource, /"runtime:workspace": "docker compose -f docker-compose\.workspace\.yml up code-server openhands"/);
assert.match(packageSource, /"runtime:project": "test -n \\".*CODELEARN_PROJECT_ID.*CODELEARN_WORKSPACE_MOUNT/);
assert.match(packageSource, /"runtime:memory": "docker compose -f docker-compose\.workspace\.yml up falkordb graph-memory"/);
assert.match(packageSource, /"runtime:all": "docker compose -f docker-compose\.workspace\.yml up -d --build code-server openhands falkordb graph-memory"/);
assert.match(packageSource, /"runtime:down": "docker compose -f docker-compose\.workspace\.yml down"/);
assert.match(packageSource, /python3 tests\/memory-service-check\.py/);

const ciSource = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
assert.match(ciSource, /actions\/setup-node@v4/);
assert.match(ciSource, /npm ci/);
assert.match(ciSource, /npm test/);
assert.match(ciSource, /npm run build/);
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
assert.match(envExampleSource, /^JUDGE0_PYTHON_LANGUAGE_ID=71$/m);
assert.match(envExampleSource, /^JUDGE0_JAVASCRIPT_LANGUAGE_ID=63$/m);
assert.match(envExampleSource, /^JUDGE0_BASE_URL=https:\/\/ce\.judge0\.com$/m);
assert.match(envExampleSource, /^SANDBOX_NETWORK_ENABLED=false$/m);
assert.match(envExampleSource, /^SANDBOX_MAX_PROCESSES=16$/m);
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
assert.match(envExampleSource, /^GRAPH_EMBEDDING_PROVIDER=openrouter$/m);
assert.match(envExampleSource, /^GRAPH_EMBEDDING_BASE_URL=https:\/\/openrouter\.ai\/api\/v1$/m);
assert.match(envExampleSource, /^GRAPH_EMBEDDING_MODEL=openai\/text-embedding-3-small$/m);
assert.match(envExampleSource, /^GRAPH_EMBEDDING_DIM=1536$/m);
assert.doesNotMatch(envExampleSource, /GRAPHITI_LLM|GRAPHITI_SMALL_MODEL|YANDEX_GRAPHITI_MODEL/);
assert.match(envExampleSource, /^GRAPH_OPENROUTER_API_KEY=$/m);

const workspaceComposeSource = readFileSync(new URL("../docker-compose.workspace.yml", import.meta.url), "utf8");
assert.match(workspaceComposeSource, /codercom\/code-server/);
assert.match(workspaceComposeSource, /ghcr\.io\/all-hands-ai\/openhands/);
assert.match(workspaceComposeSource, /falkordb\/falkordb-server:latest/);
assert.match(workspaceComposeSource, /graph-memory/);
assert.match(workspaceComposeSource, /memory_service\/Dockerfile/);
assert.match(workspaceComposeSource, /FALKORDB_HOST: falkordb/);
assert.match(workspaceComposeSource, /OPENAI_API_KEY: "\$\{OPENAI_API_KEY:-\}"/);
assert.match(workspaceComposeSource, /OPENAI_ADMIN_KEY: "\$\{OPENAI_ADMIN_KEY:-\}"/);
assert.match(workspaceComposeSource, /OPENROUTER_API_KEY: "\$\{OPENROUTER_API_KEY:-\}"/);
assert.match(workspaceComposeSource, /GRAPH_OPENROUTER_API_KEY: "\$\{GRAPH_OPENROUTER_API_KEY:-\}"/);
assert.match(workspaceComposeSource, /GRAPH_EMBEDDING_PROVIDER: "\$\{GRAPH_EMBEDDING_PROVIDER:-auto\}"/);
assert.match(workspaceComposeSource, /GRAPH_EMBEDDING_BASE_URL: "\$\{GRAPH_EMBEDDING_BASE_URL:-\}"/);
assert.match(workspaceComposeSource, /GRAPH_EMBEDDING_MODEL: "\$\{GRAPH_EMBEDDING_MODEL:-\}"/);
assert.match(workspaceComposeSource, /GRAPH_EMBEDDING_DIM: "\$\{GRAPH_EMBEDDING_DIM:-\}"/);
assert.doesNotMatch(workspaceComposeSource, /GRAPHITI_LLM_PROVIDER|GRAPHITI_STRUCTURED_OUTPUT_MODE|GRAPHITI_LLM_MODEL/);
assert.match(workspaceComposeSource, /YANDEX_AI_STUDIO_API_KEY: "\$\{YANDEX_AI_STUDIO_API_KEY:-\}"/);
assert.match(workspaceComposeSource, /YANDEX_AI_STUDIO_FOLDER_ID: "\$\{YANDEX_AI_STUDIO_FOLDER_ID:-\}"/);
assert.match(workspaceComposeSource, /redis-cli", "ping"/);
assert.match(workspaceComposeSource, /condition: service_healthy/);
assert.match(workspaceComposeSource, /\$\{CODELEARN_WORKSPACE_MOUNT:-\.\/workspace\}:\$\{CODELEARN_WORKSPACE_CONTAINER_PATH:-\/workspaces\}/);
assert.match(workspaceComposeSource, /SANDBOX_WORKSPACE_BASE: "\$\{CODELEARN_WORKSPACE_CONTAINER_PATH:-\/workspaces\}"/);
assert.doesNotMatch(workspaceComposeSource, /\.env/);

const memoryServiceSource = readFileSync(new URL("../memory_service/service.py", import.meta.url), "utf8");
assert.match(memoryServiceSource, /from falkordb\.asyncio import FalkorDB/);
assert.match(memoryServiceSource, /MEMORY_RELATION/);
assert.match(memoryServiceSource, /vec\.cosineDistance/);
assert.match(memoryServiceSource, /row_to_graph_item/);
assert.match(memoryServiceSource, /\/memory\/items/);
assert.match(memoryServiceSource, /yandex_text_embedding/);
assert.match(memoryServiceSource, /foundationModels\/v1\/textEmbedding/);
assert.match(memoryServiceSource, /AsyncOpenAI/);
assert.doesNotMatch(memoryServiceSource, /Graphiti|OpenAIGenericClient|Reranker|chat\.completions/);
assert.match(memoryServiceSource, /https:\/\/openrouter\.ai\/api\/v1/);

assert.match(profileSource, /graphEmbeddingProvider/);
assert.match(profileSource, /graphEmbeddingModel/);
assert.match(profileSource, /graphApiKey/);
assert.doesNotMatch(profileSource, /graphLlmModel|Graph LLM model|Graph LLM base URL/);
assert.match(profileSource, /\/api\/runtime\/start/);
assert.match(serverSource, /\/api\/runtime\/start/);
assert.match(serverSource, /invalid_runtime_start_request/);
assert.match(serverSource, /code-server.*openhands.*falkordb.*graph-memory/s);
assert.match(memoryServiceSource, /text-embeddings-v2-doc/);
assert.match(memoryServiceSource, /YANDEX_AI_STUDIO_API_KEY/);
assert.match(memoryServiceSource, /YANDEX_AI_STUDIO_FOLDER_ID/);
assert.match(memoryServiceSource, /health_status/);
assert.match(memoryServiceSource, /run_async/);
assert.match(memoryServiceSource, /run_until_complete/);
assert.match(memoryServiceSource, /graph_memory_unavailable/);
assert.match(memoryServiceSource, /missing_graph_memory_credentials/);
assert.match(memoryServiceSource, /has_embedding_credentials/);
assert.match(memoryServiceSource, /bounded_limit/);
assert.match(memoryServiceSource, /invalid_json/);
assert.match(memoryServiceSource, /memory_event_too_large/);

const memoryServiceRequirements = readFileSync(new URL("../memory_service/requirements.txt", import.meta.url), "utf8");
assert.match(memoryServiceRequirements, /^falkordb$/m);
assert.match(memoryServiceRequirements, /^openai$/m);
assert.doesNotMatch(memoryServiceRequirements, /graphiti/i);
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
