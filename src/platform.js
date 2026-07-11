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
    description: "Создать и сохранить проверяемую coding-задачу для изолированного allowlisted runtime. Самостоятельно выбери подходящий поддерживаемый язык и реализацию.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 2, maxLength: 200 },
        description: { type: "string", minLength: 10, maxLength: 10000, description: "Свободно сформулированное условие задачи в Markdown: структура, разделы, примеры, таблицы и код выбираются моделью по смыслу." },
        language: { type: "string", enum: ["python", "javascript"] },
        starterCode: { type: "string", minLength: 1, maxLength: 20000 },
        acceptanceCriteria: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", minLength: 1, maxLength: 500 } },
        publicChecks: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              message: { type: "string", minLength: 1, maxLength: 400 },
              code: { type: "string", minLength: 1, maxLength: 4000 }
            },
            required: ["message", "code"],
            additionalProperties: false
          }
        },
        hints: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 1000 } },
        difficulty: { type: "string", enum: ["лёгкая", "средняя", "сложная"] },
        estimatedMinutes: { type: "integer", minimum: 5, maximum: 180 }
      },
      required: ["title", "description", "language", "starterCode", "acceptanceCriteria", "publicChecks"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_test",
    description: "Создать и сохранить учебный тест из 4-15 вопросов по заданной теме.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", minLength: 2, maxLength: 200 },
        level: { type: "string", minLength: 2, maxLength: 80 },
        questions: {
          type: "array",
          minItems: 4,
          maxItems: 15,
          items: {
            type: "object",
            properties: {
              prompt: { type: "string", minLength: 2, maxLength: 2000 },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 6,
                items: { type: "string", minLength: 1, maxLength: 500 }
              },
              correctAnswer: { type: "integer", minimum: 0, maximum: 5 },
              explanation: { type: "string", minLength: 1, maxLength: 2000 }
            },
            required: ["prompt", "options", "correctAnswer", "explanation"],
            additionalProperties: false
          }
        }
      },
      required: ["topic", "level", "questions"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "remember_context",
    description: "Самостоятельно сохранить в Graph Memory несколько устойчивых наблюдений, полезных в будущих диалогах. Не использовать для временного контекста, секретов и чувствительных персональных данных.",
    parameters: {
      type: "object",
      properties: {
        memories: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["preference", "skill", "project", "habit"] },
              text: { type: "string", minLength: 2, maxLength: 1000 },
              subject: { type: "string", minLength: 1, maxLength: 200 },
              relation: { type: "string", minLength: 1, maxLength: 120 },
              object: { type: "string", minLength: 1, maxLength: 500 }
            },
            required: ["category", "text", "subject", "relation", "object"],
            additionalProperties: false
          }
        }
      },
      required: ["memories"],
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
  const executableTools = llmTools.filter((tool) => ["create_task", "create_test", "remember_context"].includes(tool.name));
  if (mode === "openai-chat-compatible") {
    return executableTools.map(({ name, description, parameters }) => ({
      type: "function",
      function: { name, description, parameters, strict: true }
    }));
  }
  return executableTools.map((tool) => ({ ...tool, strict: true }));
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

export const modelControlPrompt = `Ты — LLM-куратор CodeLearnML и оркестратор инженерной работы пользователя.

Отвечай на вопросы по коду, помогай с отладкой, логикой, архитектурой и безопасным рефакторингом. По запросу создавай задания, тесты, документацию, планы проверки и критерии готовности. Выбирай формат ответа по намерению пользователя, не навязывай учебный сценарий обычному техническому вопросу.

Работай от доступного контекста и явно отделяй факты от предположений. Не выдумывай файлы, результаты запуска, backend-возможности или выполненные действия. Если для вывода нужны код, логи или контракт, кратко запроси их. Результаты детерминированных проверок считай источником истины.

Самостоятельно решай, когда использовать доступные инструменты. Вызывай инструмент только если он реально приближает результат; не имитируй tool-вызов текстом и не заявляй, что действие выполнено, пока не получен результат инструмента. Для чувствительных или необратимых действий сначала запрашивай подтверждение. Если нужного инструмента нет, честно объясни ограничение и продолжи полезным ответом без ложного успеха.

При создании coding-задачи самостоятельно выбирай идею, структуру и формулировку условия. Поле description — свободный Markdown, а не фиксированный шаблон: используй только уместные заголовки, списки, примеры, таблицы и блоки кода. Структурированные поля инструмента нужны лишь для запуска и проверки; не превращай условие в показ JSON-схемы пользователю.

Самостоятельно вызывай remember_context, когда в диалоге появляется устойчивое предпочтение пользователя, полезное наблюдение о навыке, долговременный проектный контекст или повторяющаяся рабочая привычка. Формулируй наблюдения кратко и самостоятельно; не жди специальной команды «запомни». Не сохраняй одноразовые вопросы, предположения, весь prompt целиком, API keys, пароли, контакты и иные чувствительные данные. За один ответ сохраняй не более четырёх независимых наблюдений и считай запись состоявшейся только при успешном tool output.

Отвечай на языке пользователя. Для кода используй профессиональный Markdown, компактные объяснения и проверяемые примеры. Можешь редко выделить один ключевой вывод, предупреждение или правильный ответ синтаксисом ==ключевой вывод==; не выделяй так обычный текст. Не раскрывай скрытые тесты и не сохраняй чувствительные данные в персонализацию. Обновляй память только устойчивыми наблюдениями, полезными для будущей работы.`;

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
    "Сгенерируй Markdown-ТЗ от техлида для инженерной практики.",
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
        instructions: modelControlPrompt,
        input: prompt
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
