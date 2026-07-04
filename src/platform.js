export const providers = [
  {
    id: "openai",
    label: "OpenAI Responses API",
    mode: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    apiKeyEnv: "OPENAI_API_KEY",
    verified: true
  },
  {
    id: "openrouter",
    label: "OpenRouter OpenAI-compatible",
    mode: "openai-chat-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    apiKeyEnv: "OPENROUTER_API_KEY",
    verified: true
  },
  {
    id: "yandex",
    label: "Yandex AI Studio Responses",
    mode: "openai-responses",
    baseUrl: "https://ai.api.cloud.yandex.net/v1",
    model: "",
    apiKeyEnv: "YANDEX_AI_STUDIO_API_KEY",
    envHeaders: { "x-folder-id": "YANDEX_AI_STUDIO_FOLDER_ID" },
    verified: true
  }
];

export const personalityTemplate = `# Кодовые привычки

# Проблемные темы/места

# Сильные стороны

# Предпочтения в ответах
`;

export const llmTools = [
  {
    type: "function",
    name: "review_personality",
    description: "Прочитать всю или часть markdown-персонализации ученика.",
    parameters: {
      type: "object",
      properties: {
        section: { type: "string", description: "Опциональный заголовок раздела." },
        from_line: { type: "integer", minimum: 1 },
        to_line: { type: "integer", minimum: 1 }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "add_personality",
    description: "Добавить или обновить learning-relevant персонализацию.",
    parameters: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["Кодовые привычки", "Проблемные темы/места", "Сильные стороны", "Предпочтения в ответах"] },
        text: { type: "string" }
      },
      required: ["section", "text"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "delete_personality",
    description: "Удалить конкретные строки из markdown-персонализации.",
    parameters: {
      type: "object",
      properties: {
        lines: { type: "array", items: { type: "integer", minimum: 1 } },
        reason: { type: "string" }
      },
      required: ["lines", "reason"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_task",
    description: "Сформировать техлид-задание на разработку кодовой базы.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string" },
        constraints: { type: "array", items: { type: "string" } },
        expected_deliverable: { type: "string" }
      },
      required: ["topic"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_test",
    description: "Сформировать тест из 10 вопросов по заданной теме.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string" },
        level: { type: "string" },
        include_answers: { type: "boolean" }
      },
      required: ["topic"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "update_skill_graph",
    description: "Сформировать доказательное обновление графа навыков ученика по результатам проверок.",
    parameters: {
      type: "object",
      properties: {
        concept: { type: "string" },
        misconception: { type: "string" },
        status: { type: "string", enum: ["weak", "improving", "strong"] },
        evidence: { type: "string" },
        next_drill: { type: "string" }
      },
      required: ["concept", "misconception", "status", "evidence", "next_drill"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_adaptive_drill",
    description: "Сформировать короткое упражнение, которое изолирует одну доказанную слабость из skill graph.",
    parameters: {
      type: "object",
      properties: {
        concept: { type: "string" },
        objective: { type: "string" },
        starter_code: { type: "string" },
        public_checks: { type: "array", items: { type: "object" } },
        hidden_summary: { type: "string" }
      },
      required: ["concept", "objective", "starter_code", "public_checks", "hidden_summary"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "check_hint_leakage",
    description: "Проверить подсказку на раскрытие полного решения и выбрать безопасный сократический уровень помощи.",
    parameters: {
      type: "object",
      properties: {
        leak_level: { type: "string", enum: ["question", "hint", "diagnostic_test", "partial_patch", "full_solution"] },
        allowed_response: { type: "string" },
        blocked_reason: { type: "string" }
      },
      required: ["leak_level", "allowed_response"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_codebase_lesson",
    description: "Сформировать урок по реальному фрагменту кодовой базы: контракт, тест, багфикс или ревью.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        target_files: { type: "array", items: { type: "string" } },
        task: { type: "string" },
        acceptance_checks: { type: "array", items: { type: "string" } },
        hidden_risks: { type: "string" }
      },
      required: ["title", "target_files", "task", "acceptance_checks", "hidden_risks"],
      additionalProperties: false
    }
  }
];

export function toolsForProvider(mode) {
  if (mode === "openai-chat-compatible") {
    return llmTools.map(({ name, description, parameters }) => ({
      type: "function",
      function: { name, description, parameters }
    }));
  }
  return llmTools;
}

export function extractGeneratedJsonText(text) {
  const source = String(text || "").trim();
  if (source.startsWith("{")) return source;

  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start !== -1 && end > start) return source.slice(start, end + 1);

  return source;
}

export function parseGeneratedJson(text) {
  return JSON.parse(extractGeneratedJsonText(text));
}

export const modelControlPrompt = `#task
Управлять учебной сессией по программированию: превращать цель ученика в короткий практический урок, принимать результаты детерминированных проверок как источник истины, давать подсказки и обновлять персонализацию только когда это полезно для следующих занятий.

#non_goals
- Не оценивать правильность решения без результата проверок.
- Не раскрывать скрытые тесты.
- Не выдавать полный ответ, если ученик просит намек и попыток еще мало.
- Не сохранять чувствительные личные данные.
- Не менять персонализацию без явного полезного наблюдения.

#inputs
- Цель ученика свободным текстом.
- JSON-спецификация текущего урока.
- Код ученика.
- Результаты sandbox/публичных/скрытых проверок.
- Markdown-персонализация по разделам.
- Вопрос ученика.

#lesson_generation
Если ученик формулирует тему практики, вернуть Markdown-ТЗ от тимлида, затем отдельный импортируемый JSON-блок:
{title, topic, level, objective, tasks:[{id,title,prompt,starterCode,publicChecks,hiddenSummary,hints}]}
publicChecks должны быть простыми и детерминированными. hiddenSummary описывает риск без раскрытия тел скрытых тестов.

#feedback_logic
1. Сначала опереться на stderr/stdout/категорию ошибки/проваленные проверки.
2. Назвать минимальный следующий шаг.
3. Объяснять причину, а не переписывать все решение.
4. Если проверки прошли, предложить короткое ревью или усложнение.

#personality_memory
Редактировать память только если наблюдение пригодится позже:
- Кодовые привычки: повторяющиеся стилистические или архитектурные паттерны.
- Проблемные темы/места: устойчивые ошибки, пробелы, непонимание API.
- Сильные стороны: устойчиво успешные навыки.
- Предпочтения в ответах: формат, язык, степень подробности, стиль подсказок.
Перед удалением читать текущую память через review_personality. Удалять только конкретные устаревшие или неверные строки.

#tools
review_personality(section?, from_line?, to_line?)
add_personality(section, text)
delete_personality(lines, reason)
create_task(topic, constraints?, expected_deliverable?)
create_test(topic, level?, include_answers?)

#output_rules
- Для урока: сначала Markdown-ТЗ, затем валидный JSON для импорта.
- Для подсказки: кратко, по делу, на русском.
- Для техлид-задания: структура с целью, контрактами, тестами, ограничениями, критериями готовности.
- Для теста: ровно 10 вопросов; ответы добавлять только если include_answers=true.
`;

export const sampleLesson = {
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
        {
          kind: "python_assert",
          message: "Функция prepare_features должна существовать.",
          code: "assert callable(prepare_features)"
        },
        {
          kind: "python_assert",
          message: "Пропуски age заполняются медианой.",
          code: "import pandas as pd\\ndf = pd.DataFrame({'age': [10.0, None, 30.0]})\\nout = prepare_features(df)\\nassert out['age'].tolist() == [10.0, 20.0, 30.0]"
        },
        {
          kind: "python_assert",
          message: "Добавляется индикатор пропуска age_was_missing.",
          code: "import pandas as pd\\ndf = pd.DataFrame({'age': [10.0, None, 30.0]})\\nout = prepare_features(df)\\nassert out['age_was_missing'].tolist() == [0, 1, 0]"
        }
      ],
      hiddenSummary: "Скрытые проверки валидируют, что строки не теряются и набор колонок стабилен.",
      hints: [
        "Создай флаг пропуска до заполнения значений.",
        "Бери медиану из входного датафрейма.",
        "Верни новый датафрейм, не меняй объект вызывающего кода."
      ]
    }
  ]
};

export function buildLessonPrompt(goal, memory) {
  return buildTeamLeadTaskPrompt({ goal, difficulty: "easy", memory });
}

export function buildTeamLeadTaskPrompt({ goal, difficulty, memory }) {
  const scopes = {
    easy: "easy: one script / one window",
    medium: "medium: small microservice",
    hard: "hard: broader stack with multiple files/functions/components"
  };
  return [
    modelControlPrompt,
    "Сгенерируй Markdown-задание от техлида для инженерной практики.",
    `Сложность: ${scopes[difficulty] || scopes.easy}.`,
    "После Markdown добавь JSON-спецификацию урока строго по схеме.",
    "Схема: {title, topic, level, objective, tasks:[{id,title,prompt,starterCode,publicChecks,hiddenSummary,hints,files?}]}",
    "files опционален: массив {path, content} для дополнительных файлов проекта без секретов и без абсолютных путей.",
    "publicChecks: массив простых детерминированных проверок {kind:'python_assert', code, message}.",
    "Не раскрывай тела скрытых тестов. Добавь только hiddenSummary.",
    "Задача должна быть практичной для Python, DS/ML, FastAPI или ML engineering.",
    "Критерии готовности и ограничения опиши в Markdown как техлид.",
    `Цель ученика: ${goal}`,
    `Память ученика: ${memory.map((item) => `${item.kind}: ${item.text}`).join("; ") || "пусто"}`
  ].join("\n");
}

export function validateLessonSpec(spec) {
  if (!spec || typeof spec !== "object") return ["Спецификация урока должна быть объектом."];
  const errors = [];
  for (const key of ["title", "topic", "level", "objective"]) {
    if (typeof spec[key] !== "string" || !spec[key].trim()) errors.push(`${key} обязателен.`);
  }
  if (tooLong(spec.title, 200)) errors.push("title слишком большой.");
  if (tooLong(spec.topic, 200)) errors.push("topic слишком большой.");
  if (tooLong(spec.level, 80)) errors.push("level слишком большой.");
  if (tooLong(spec.objective, 2000)) errors.push("objective слишком большой.");
  if (!Array.isArray(spec.tasks) || spec.tasks.length === 0) {
    errors.push("tasks должен содержать хотя бы одну задачу.");
    return errors;
  }
  if (spec.tasks.length > 20) errors.push("tasks должен содержать не больше 20 задач.");
  spec.tasks.forEach((task, index) => {
    for (const key of ["id", "title", "prompt", "starterCode", "hiddenSummary"]) {
      if (typeof task[key] !== "string" || !task[key].trim()) errors.push(`tasks[${index}].${key} обязателен.`);
    }
    if (tooLong(task?.id, 120)) errors.push(`tasks[${index}].id слишком большой.`);
    if (tooLong(task?.title, 200)) errors.push(`tasks[${index}].title слишком большой.`);
    if (tooLong(task?.prompt, 10000)) errors.push(`tasks[${index}].prompt слишком большой.`);
    if (tooLong(task?.starterCode, 20000)) errors.push(`tasks[${index}].starterCode слишком большой.`);
    if (tooLong(task?.hiddenSummary, 4000)) errors.push(`tasks[${index}].hiddenSummary слишком большой.`);
    if (!Array.isArray(task.publicChecks) || task.publicChecks.length === 0) errors.push(`tasks[${index}].publicChecks обязателен.`);
    if (!Array.isArray(task.hints) || task.hints.length === 0) errors.push(`tasks[${index}].hints обязателен.`);
    if (Array.isArray(task.publicChecks) && task.publicChecks.length > 50) errors.push(`tasks[${index}].publicChecks должен содержать не больше 50 проверок.`);
    if (Array.isArray(task.hints) && task.hints.length > 20) errors.push(`tasks[${index}].hints должен содержать не больше 20 подсказок.`);
    if (Array.isArray(task.files) && task.files.length > 50) errors.push(`tasks[${index}].files должен содержать не больше 50 файлов.`);
    for (const check of task.publicChecks || []) {
      if (check.kind !== "python_assert") errors.push(`tasks[${index}].publicChecks поддерживает только python_assert.`);
      if (typeof check.code !== "string" || !check.code.trim()) errors.push(`tasks[${index}].publicChecks.code обязателен.`);
      if (tooLong(check.code, 4000)) errors.push(`tasks[${index}].publicChecks.code слишком большой.`);
      if (tooLong(check.message, 400)) errors.push(`tasks[${index}].publicChecks.message слишком большой.`);
    }
    for (const hint of task.hints || []) {
      if (tooLong(hint, 1000)) errors.push(`tasks[${index}].hints item слишком большой.`);
    }
    for (const file of task.files || []) {
      if (typeof file.path !== "string" || !file.path.trim()) errors.push(`tasks[${index}].files.path обязателен.`);
      if (file.path?.startsWith("/") || file.path?.includes("..")) errors.push(`tasks[${index}].files.path должен быть относительным безопасным путем.`);
      if (["task.md", "solution.py", "checks.json"].includes(file.path)) errors.push(`tasks[${index}].files.path не должен заменять системный workspace-файл.`);
      if (typeof file.content !== "string") errors.push(`tasks[${index}].files.content обязателен.`);
      if (typeof file.content === "string" && file.content.length > 200000) errors.push(`tasks[${index}].files.content слишком большой.`);
    }
  });
  return errors;
}

function tooLong(value, max) {
  return typeof value === "string" && value.length > max;
}

export function gradeByLessonSpec(task, code) {
  const started = performance.now();
  const publicResults = task.publicChecks.map((check) => {
    if (check.kind !== "python_assert") {
      return { name: check.message, passed: false, message: `Неподдерживаемый тип проверки: ${check.kind}` };
    }
    return { name: check.message, passed: false, message: "Запустите Python-интерпретатор в браузере." };
  });
  const passed = publicResults.every((result) => result.passed);
  return {
    status: passed ? "passed" : "test_failure",
    stdout: "",
    stderr: passed ? "" : "Детерминированные проверки урока не прошли.",
    execution_time: Number(((performance.now() - started) / 1000).toFixed(3)),
    memory_used: 0,
    public_test_results: publicResults,
    hidden_test_summary: passed ? `Скрытые проверки готовы к запуску в sandbox. ${task.hiddenSummary}` : "Скрытые проверки не запускались, потому что публичные проверки не прошли.",
    category: passed ? "accepted" : "test_failure"
  };
}

export function buildTutorPrompt({ lesson, task, grade, memory, question }) {
  return [
    modelControlPrompt,
    "#current_state",
    "Источник истины - детерминированные проверки.",
    `Урок: ${lesson.title}`,
    `Задача: ${task.title}`,
    `Результат: ${grade.status}`,
    `Проваленные публичные проверки: ${grade.public_test_results.filter((test) => !test.passed).map((test) => test.name).join(", ") || "нет"}`,
    `Память ученика: ${memory.map((item) => `${item.kind}: ${item.text}`).join("; ") || "пусто"}`,
    `Вопрос: ${question || "Дай следующий полезный намек, не раскрывая полное решение."}`
  ].join("\n");
}

export function buildSkillGraphPrompt({ lesson, task, grade, memory }) {
  return [
    modelControlPrompt,
    "#skill_graph_update",
    "Верни только JSON для update_skill_graph.",
    "Обновляй навык только по наблюдаемому evidence: статус проверки, stderr/stdout, проваленные публичные проверки.",
    "Не делай вывод о личности ученика и не сохраняй чувствительные данные.",
    `Урок: ${lesson.title}`,
    `Задача: ${task.title}`,
    `Результат: ${grade.status}`,
    `Evidence: ${grade.stderr || grade.category}; failed=${grade.public_test_results.filter((test) => !test.passed).map((test) => test.name).join(", ") || "нет"}`,
    `Память: ${memory.map((item) => `${item.kind}: ${item.text}`).join("; ") || "пусто"}`
  ].join("\n");
}

export function buildAdaptiveDrillPrompt({ skillGraph, recentTasks }) {
  return [
    modelControlPrompt,
    "#adaptive_drill",
    "Создай короткое упражнение на 10-15 минут через create_adaptive_drill.",
    "Упражнение должно тренировать ровно одну слабость из skill graph.",
    "Не повторяй последние задания и не добавляй новую тему без связи с evidence.",
    "public_checks должны быть детерминированными python_assert.",
    `Skill graph: ${JSON.stringify(skillGraph)}`,
    `Недавние задания: ${recentTasks.join("; ") || "нет"}`
  ].join("\n");
}

export function buildSocraticHintPrompt({ task, code, question, attemptCount }) {
  return [
    modelControlPrompt,
    "#socratic_leak_guard",
    "Проверь запрос ученика через check_hint_leakage и дай только allowed_response.",
    "В tool-ответе обязательно укажи leak_level.",
    "Если попыток меньше 3, не выдавать полный ответ, готовую функцию или прямую замену всего решения.",
    "Разрешены: один диагностический вопрос, один минимальный намек или один небольшой test case.",
    `Попыток: ${attemptCount}`,
    `Задача: ${task.title}`,
    `Условие: ${task.prompt}`,
    `Код ученика:\n${code}`,
    `Вопрос: ${question || "Нужен следующий намек"}`
  ].join("\n");
}

export function buildCodebaseLessonPrompt({ goal, files, excerpt }) {
  return [
    modelControlPrompt,
    "#real_codebase_lesson",
    "Создай упражнение по реальной кодовой базе через create_codebase_lesson.",
    "Используй только переданные файлы и фрагмент; не выходи за этот контекст.",
    "Задание должно быть про контракт, тест, багфикс, ревью или безопасный refactor.",
    "Acceptance checks должны быть наблюдаемыми и проверяемыми локально.",
    `Цель: ${goal}`,
    `Файлы: ${files.join(", ") || "не указаны"}`,
    `Фрагмент:\n${excerpt || "не передан"}`
  ].join("\n");
}

export function buildProviderPayload(provider, prompt) {
  if (provider.mode === "unverified") throw new Error(`Контракт провайдера не проверен: ${provider.label}`);
  if (!provider.model.trim()) throw new Error("Сначала укажите модель.");
  if (provider.mode === "openai-responses") {
    return {
      url: `${provider.baseUrl}/responses`,
      apiKeyEnv: provider.apiKeyEnv,
      envHeaders: provider.envHeaders,
      body: {
        model: provider.model,
        tools: toolsForProvider(provider.mode),
        input: [
          { role: "developer", content: modelControlPrompt },
          { role: "user", content: prompt }
        ]
      }
    };
  }

  if (provider.mode === "openai-chat-compatible") {
    return {
      url: `${provider.baseUrl}/chat/completions`,
      apiKeyEnv: provider.apiKeyEnv,
      envHeaders: provider.envHeaders,
      body: {
        model: provider.model,
        tools: toolsForProvider(provider.mode),
        messages: [
          { role: "system", content: modelControlPrompt },
          { role: "user", content: prompt }
        ]
      }
    };
  }

  throw new Error(`Неподдерживаемый режим API: ${provider.mode}`);
}

export function buildModelListRequest(provider) {
  if (provider.mode === "unverified") throw new Error(`Контракт списка моделей не проверен: ${provider.label}`);
  if (!provider.baseUrl.trim()) throw new Error("Сначала укажите base URL.");
  return {
    method: "GET",
    url: `${provider.baseUrl.replace(/\/$/, "")}/models`,
    envHeaders: provider.envHeaders,
    auth: `Bearer ${provider.apiKeyEnv}`,
    note: "Выполнять только на сервере/proxy. Не вставлять API key в браузерный код."
  };
}

export function createMemoryStore(storage) {
  const key = "codelearn.memory";
  return {
    list() {
      return JSON.parse(storage.getItem(key) || "[]");
    },
    add(kind, text) {
      const items = this.list();
      const item = { id: crypto.randomUUID(), kind, text, createdAt: new Date().toISOString() };
      storage.setItem(key, JSON.stringify([item, ...items]));
      return item;
    },
    remove(id) {
      storage.setItem(key, JSON.stringify(this.list().filter((item) => item.id !== id)));
    },
    clear() {
      storage.removeItem(key);
    }
  };
}
