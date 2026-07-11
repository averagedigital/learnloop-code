import { useEffect, useRef, useState } from "react";
import { providers } from "./platform.js";
import { buildActivityCalendar, buildActivityEvents, buildMemoryGraph, fitMemoryGraphView, panMemoryGraphView, profileAvatarSrc, zoomMemoryGraphView } from "./profile.js";

const sections = [
  { id: "overview", label: "Обзор", hint: "Активность и контекст" },
  { id: "llm", label: "LLM и стек", hint: "Модели и runtime" },
  { id: "graph-memory", label: "Графовая память", hint: "Что помнит куратор" },
  { id: "personalization", label: "Персонализация", hint: "Память куратора" }
];

const mascotOptions = [
  { id: "05_laptop_spiky", label: "Кодер" },
  { id: "organic_spiky_concept", label: "Органик" }
];

const graphProviders = {
  openrouter: {
    label: "OpenRouter",
    embeddingBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    embeddingDim: "1536"
  },
  openai: {
    label: "OpenAI",
    embeddingBaseUrl: "https://api.openai.com/v1",
    embeddingModel: "text-embedding-3-small",
    embeddingDim: "1536"
  },
  yandex: {
    label: "Yandex AI Studio",
    embeddingBaseUrl: "https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding",
    embeddingModel: "text-embeddings-v2-doc",
    embeddingDim: "256"
  }
};

function completedTask(task) {
  return /passed|done|complete|готов|выполн/i.test(String(task?.status || ""));
}

function Field({ label, hint, children }) {
  return (
    <label className="profileField">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function compactGraphText(value, limit = 22) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function profileDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

function MemoryGraph({ items }) {
  const graph = buildMemoryGraph(items);
  const [view, setView] = useState(() => fitMemoryGraphView(graph));
  const [selection, setSelection] = useState(null);
  const dragRef = useRef(null);

  useEffect(() => {
    setView(fitMemoryGraphView(graph));
    setSelection(null);
  }, [items]);

  function zoom(factor, anchor) {
    setView((current) => zoomMemoryGraphView(current, factor, graph, anchor));
  }

  function resetView() {
    setView(fitMemoryGraphView(graph));
  }

  function beginPan(event) {
    if (event.target.closest("[data-graph-selectable]")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = { x: event.clientX, y: event.clientY, view, width: bounds.width, height: bounds.height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.x) * (drag.view.width / Math.max(1, drag.width));
    const dy = (event.clientY - drag.y) * (drag.view.height / Math.max(1, drag.height));
    setView(panMemoryGraphView(drag.view, -dx, -dy, graph));
  }

  function handleWheel(event) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    zoom(event.deltaY < 0 ? 1.16 : 1 / 1.16, {
      x: (event.clientX - bounds.left) / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) / Math.max(1, bounds.height)
    });
  }

  function handleKeyboard(event) {
    const step = Math.max(24, view.width * 0.08);
    const actions = {
      ArrowLeft: () => setView((current) => panMemoryGraphView(current, -step, 0, graph)),
      ArrowRight: () => setView((current) => panMemoryGraphView(current, step, 0, graph)),
      ArrowUp: () => setView((current) => panMemoryGraphView(current, 0, -step, graph)),
      ArrowDown: () => setView((current) => panMemoryGraphView(current, 0, step, graph)),
      "+": () => zoom(1.2),
      "=": () => zoom(1.2),
      "-": () => zoom(1 / 1.2),
      "0": resetView
    };
    if (!actions[event.key]) return;
    event.preventDefault();
    actions[event.key]();
  }

  function selectFromKeyboard(event, value) {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    setSelection(value);
  }

  const selectedEdges = selection?.type === "node"
    ? graph.edges.filter((edge) => edge.subject === selection.node.id || edge.object === selection.node.id)
    : selection?.type === "edge" ? [selection.edge] : [];

  return (
    <div className="memoryGraphWorkspace">
      <div className="memoryGraphToolbar" aria-label="Управление графом">
        <button type="button" onClick={() => zoom(1.2)} aria-label="Приблизить граф">+</button>
        <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="Отдалить граф">−</button>
        <button type="button" onClick={resetView}>Весь граф</button>
        <span>Колесо/трекпад · drag · стрелки · +/− · 0</span>
      </div>
      <div className="memoryGraphViewport" tabIndex="0" onKeyDown={handleKeyboard}>
      <svg
        className="memoryGraph"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        role="img"
        aria-label={`Граф памяти: ${graph.nodes.length} сущностей, ${graph.edges.length} связей`}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={handleWheel}
      >
        <defs>
          <marker id="memory-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <g className="memoryGraphEdges">
          {graph.edges.map((edge) => (
              <g
                className={selection?.type === "edge" && selection.edge.index === edge.index ? "selected" : ""}
                data-graph-selectable="edge"
                key={`${edge.uuid || edge.index}:${edge.subject}:${edge.object}`}
                role="button"
                tabIndex="0"
                aria-label={`${edge.subject}: ${edge.relation} ${edge.object}`}
                onClick={() => setSelection({ type: "edge", edge })}
                onKeyDown={(event) => selectFromKeyboard(event, { type: "edge", edge })}
              >
                <title>{edge.fact}</title>
                <path d={`M ${edge.start.x} ${edge.start.y} Q ${edge.control.x} ${edge.control.y} ${edge.end.x} ${edge.end.y}`} markerEnd="url(#memory-arrow)" />
                <g className="memoryEdgeLabel" transform={`translate(${edge.labelBox.x} ${edge.labelBox.y})`}>
                  <rect width={edge.labelBox.width} height={edge.labelBox.height} rx="13" />
                  <text x={edge.labelBox.width / 2} y="17" textAnchor="middle">{edge.relationLabel}</text>
                </g>
              </g>
          ))}
        </g>
        <g className="memoryGraphNodes">
          {graph.nodes.map((node, index) => (
            <g
              className={`${index === 0 ? "memoryNode hub" : "memoryNode"}${selection?.type === "node" && selection.node.id === node.id ? " selected" : ""}`}
              data-graph-selectable="node"
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
              role="button"
              tabIndex="0"
              aria-label={`Сущность ${node.id}, связей: ${node.degree}`}
              onClick={() => setSelection({ type: "node", node })}
              onKeyDown={(event) => selectFromKeyboard(event, { type: "node", node })}
            >
              <title>{node.id}</title>
              <rect width={node.width} height={node.height} rx="16" />
              <circle cx="20" cy="28" r="4" />
              <text x="34" y="33">{compactGraphText(node.id)}</text>
            </g>
          ))}
        </g>
      </svg>
      </div>
      {selection ? (
        <aside className="memoryGraphInspector" aria-live="polite">
          <header>
            <div><span>{selection.type === "node" ? "Сущность" : "Связь"}</span><strong>{selection.type === "node" ? selection.node.id : selection.edge.relation}</strong></div>
            <button type="button" onClick={() => setSelection(null)} aria-label="Закрыть инспектор">×</button>
          </header>
          {selectedEdges.map((edge) => (
            <dl key={`${edge.uuid || edge.index}:inspector`}>
              <div><dt>Subject</dt><dd>{edge.subject}</dd></div>
              <div><dt>Relation</dt><dd>{edge.relation}</dd></div>
              <div><dt>Object</dt><dd>{edge.object}</dd></div>
              <div className="fact"><dt>Сохранённый факт</dt><dd>{edge.fact}</dd></div>
              {edge.createdAt ? <div><dt>Дата</dt><dd>{profileDate(edge.createdAt)}</dd></div> : null}
              {edge.groupId ? <div><dt>Источник / группа</dt><dd>{edge.groupId}</dd></div> : null}
            </dl>
          ))}
        </aside>
      ) : null}
    </div>
  );
}

export default function ProfileOverlay({ open, onClose, app, runtime, requestJson, onSettingsSaved, onRuntimeUpdated, onSectionChange, onOpened }) {
  const dialogRef = useRef(null);
  const [section, setSection] = useState("overview");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({});
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [personality, setPersonality] = useState("");
  const [savedPersonality, setSavedPersonality] = useState("");
  const [personalityLoaded, setPersonalityLoaded] = useState(false);
  const [graphMemory, setGraphMemory] = useState({ loading: false, error: "", items: [], groups: [] });
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const settings = app?.settings || {};
    const provider = providers.find((item) => item.id === (settings.providerId || "openrouter")) || providers[1];
    setForm({
      profileName: settings.profileName || "Локальный ученик",
      mascotId: settings.mascotId || "05_laptop_spiky",
      providerId: provider.id,
      providerBaseUrl: settings.providerBaseUrl || provider.baseUrl,
      providerModel: settings.providerModel || "",
      providerKey: "",
      graphMemoryUrl: settings.graphMemoryUrl || "http://127.0.0.1:8008",
      graphEmbeddingProvider: settings.graphEmbeddingProvider || "openrouter",
      graphEmbeddingBaseUrl: settings.graphEmbeddingBaseUrl || "https://openrouter.ai/api/v1",
      graphEmbeddingModel: settings.graphEmbeddingModel || "openai/text-embedding-3-small",
      graphEmbeddingDim: settings.graphEmbeddingDim || "1536",
      graphApiKey: "",
      graphYandexFolderId: ""
    });
  }, [app?.settings]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      onOpened?.(dialog);
    }
    if (!open && dialog?.open) {
      dialog.close();
      onOpened?.(document.body);
    }
  }, [onOpened, open]);

  useEffect(() => {
    if (!open || personalityLoaded) return;
    let cancelled = false;
    requestJson("/api/personality")
      .then((data) => {
        if (!cancelled) {
          const markdown = data.markdown || "";
          setPersonality(markdown);
          setSavedPersonality(markdown);
          setPersonalityLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) setNotice({ type: "error", text: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [open, personalityLoaded, requestJson]);

  useEffect(() => {
    if (!open || section !== "graph-memory") return;
    let cancelled = false;
    setGraphMemory((current) => ({ ...current, loading: true, error: "" }));
    requestJson("/api/memory/graph-items")
      .then((data) => {
        if (!cancelled) setGraphMemory({ loading: false, error: data.ok ? "" : data.error || "graph_memory_unavailable", items: data.items || [], groups: data.groups || [] });
      })
      .catch((error) => {
        if (!cancelled) setGraphMemory({ loading: false, error: error.message, items: [], groups: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [graphRefreshKey, open, requestJson, section]);

  useEffect(() => {
    if (open) onSectionChange?.(section);
  }, [onSectionChange, open, section]);

  const activity = buildActivityCalendar(app);
  const activityEvents = buildActivityEvents(app);
  const settings = app?.settings || {};
  const activeProvider = providers.find((item) => item.id === form.providerId) || providers[1];
  const providerStatus = app?.providerStatus?.[form.providerId];
  const taskLogs = app?.taskLogs || [];
  const latestQuizAttempt = app?.quizAttempts?.[0];
  const personalityDirty = personality !== savedPersonality;
  const visibleSections = sections.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(search.trim().toLowerCase()));

  function change(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function chooseProvider(providerId) {
    const provider = providers.find((item) => item.id === providerId);
    setModels([]);
    setForm((current) => ({
      ...current,
      providerId,
      providerBaseUrl: provider?.baseUrl || "",
      providerModel: "",
      providerKey: ""
    }));
  }

  function chooseGraphProvider(graphEmbeddingProvider) {
    const defaults = graphProviders[graphEmbeddingProvider];
    setForm((current) => ({
      ...current,
      graphEmbeddingProvider,
      graphEmbeddingBaseUrl: defaults.embeddingBaseUrl,
      graphEmbeddingModel: defaults.embeddingModel,
      graphEmbeddingDim: defaults.embeddingDim,
      graphApiKey: "",
      graphYandexFolderId: ""
    }));
  }

  async function saveSettings(payload, successText) {
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      const result = await requestJson("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      onSettingsSaved(result);
      setNotice({ type: "success", text: successText });
      return result;
    } catch (error) {
      setNotice({ type: "error", text: error.message });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    await saveSettings({ profileName: form.profileName, mascotId: form.mascotId }, "Профиль обновлён.");
  }

  function llmSettingsPayload() {
    const payload = {
      providerId: form.providerId,
      providerBaseUrl: form.providerBaseUrl,
      providerModel: form.providerModel,
      graphMemoryUrl: form.graphMemoryUrl,
      graphEmbeddingProvider: form.graphEmbeddingProvider,
      graphEmbeddingBaseUrl: form.graphEmbeddingBaseUrl,
      graphEmbeddingModel: form.graphEmbeddingModel,
      graphEmbeddingDim: form.graphEmbeddingDim
    };
    if (form.providerKey.trim()) payload.providerApiKeys = { [form.providerId]: form.providerKey.trim() };
    if (form.graphApiKey.trim()) payload.graphApiKey = form.graphApiKey.trim();
    if (form.graphYandexFolderId.trim()) payload.graphYandexFolderId = form.graphYandexFolderId.trim();
    return payload;
  }

  function clearSavedKeys() {
    change("providerKey", "");
    change("graphApiKey", "");
    change("graphYandexFolderId", "");
  }

  async function saveLlm(event) {
    event.preventDefault();
    const payload = llmSettingsPayload();
    const result = await saveSettings(payload, "LLM и runtime сохранены.");
    if (result) clearSavedKeys();
  }

  async function saveAndStartRuntime() {
    const saved = await saveSettings(llmSettingsPayload(), "Настройки сохранены. Запускаю контур…");
    if (!saved) return;
    clearSavedKeys();
    setSaving(true);
    try {
      const result = await requestJson("/api/runtime/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      onRuntimeUpdated(result.runtime);
      setNotice({
        type: result.runtime?.graph?.ok ? "success" : "",
        text: result.runtime?.graph?.ok ? "Единый контур запущен, Graph Memory готова." : "Контур запущен. Сервисы ещё прогреваются — статус обновлён."
      });
    } catch (error) {
      setNotice({ type: "error", text: `Не удалось запустить контур: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function connectProviderAndLoadModels() {
    if (!providerStatus?.configured && !form.providerKey.trim()) {
      setNotice({ type: "error", text: "Введите API key для первого подключения." });
      return;
    }
    setNotice({ type: "", text: "" });
    setLoadingModels(true);
    try {
      const settingsPayload = {
        providerId: form.providerId,
        providerBaseUrl: form.providerBaseUrl
      };
      if (form.providerKey.trim()) settingsPayload.providerApiKeys = { [form.providerId]: form.providerKey.trim() };
      const saved = await requestJson("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settingsPayload)
      });
      onSettingsSaved(saved);
      change("providerKey", "");
      const result = await requestJson("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: form.providerBaseUrl,
          apiKeyEnv: activeProvider.apiKeyEnv,
          envHeaders: activeProvider.envHeaders
        })
      });
      const nextModels = Array.isArray(result.data) ? result.data.map((model) => model.id).filter(Boolean) : [];
      setModels(nextModels);
      setNotice({ type: "success", text: nextModels.length ? `Получено моделей: ${nextModels.length}.` : "Provider вернул пустой список моделей." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setLoadingModels(false);
    }
  }

  async function savePersonality(event) {
    event.preventDefault();
    setSaving(true);
    setNotice({ type: "", text: "" });
    try {
      await requestJson("/api/personality", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: personality })
      });
      setSavedPersonality(personality);
      setNotice({ type: "success", text: "Персонализация сохранена." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="profileDialog"
      aria-label="Профиль и настройки"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="profileWindow">
        <aside className="profileNav">
          <div className="profileNavTop">
            <button type="button" className="profileBack" onClick={onClose}>← Вернуться</button>
            <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Поиск настроек…" aria-label="Поиск настроек" />
          </div>
          <nav aria-label="Разделы профиля">
            {visibleSections.map((item) => (
              <button type="button" key={item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>
                <strong>{item.label}</strong><span>{item.hint}</span>
              </button>
            ))}
            {!visibleSections.length ? <p>Ничего не найдено.</p> : null}
          </nav>
          <div className="profileRuntimeMini">
            <span className={runtime?.ok ? "online" : ""} />
            {runtime?.ok ? "Runtime отвечает" : "Runtime требует внимания"}
          </div>
        </aside>

        <section className="profileContent">
          <header className="profileContentHeader">
            <div><p>CODELEARNML / SETTINGS</p><h2>{sections.find((item) => item.id === section)?.label}</h2></div>
            <button type="button" className="profileClose" onClick={onClose} aria-label="Закрыть профиль">×</button>
          </header>

          <div className="profileScroll">
            {section === "overview" ? (
              <div className="profileSection overviewSection">
                <form className="profileHero profileEditor" onSubmit={saveProfile}>
                  <fieldset className="profileAvatarChoices">
                    <legend>Аватар</legend>
                    {mascotOptions.map((mascot) => (
                      <button type="button" key={mascot.id} aria-label={mascot.label} aria-pressed={form.mascotId === mascot.id} onClick={() => change("mascotId", mascot.id)}>
                        <img src={profileAvatarSrc(mascot.id)} alt="" />
                      </button>
                    ))}
                  </fieldset>
                  <label className="profileNameEditor">
                    <span>Имя пользователя</span>
                    <input className="profileNameInput" value={form.profileName || ""} onChange={(event) => change("profileName", event.target.value)} maxLength="80" required aria-label="Имя пользователя" />
                    <small>{settings.providerModel || "Модель пока не выбрана"}</small>
                  </label>
                  <button className="profileQuickSave" type="submit" disabled={saving}>Сохранить</button>
                </form>
                <div className="profileStats">
                  <article><span>Завершено</span><strong>{taskLogs.filter(completedTask).length}</strong><small>задач</small></article>
                  <article><span>Диалоги</span><strong>{app?.assistantChats?.length || 0}</strong><small>с куратором</small></article>
                  <article><span>Память</span><strong>{app?.memoryEvents?.length || 0}</strong><small>наблюдений</small></article>
                  <article><span>Последний тест</span><strong>{latestQuizAttempt ? `${latestQuizAttempt.correctCount}/${latestQuizAttempt.totalCount}` : "—"}</strong><small>правильных ответов</small></article>
                  <article><span>Активность</span><strong>{activity.activeDays}</strong><small>дней / 12 месяцев</small></article>
                </div>
                <section className="activityPanel">
                  <div className="activityHeader"><div><p>Практика</p><h3>{activity.total} действий за последние 12 месяцев</h3></div></div>
                  <div className="activityGrid" aria-label="Календарь активности">
                    {activity.weeks.map((week, weekIndex) => (
                      <div className="activityWeek" key={weekIndex}>
                        {week.map((cell) => <span key={cell.date} className={`level-${cell.level} ${cell.future ? "future" : ""}`} title={`${cell.date}: ${cell.count}`} />)}
                      </div>
                    ))}
                  </div>
                  <div className="activityLegend"><span>Меньше</span>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<span>Больше</span></div>
                  <div className="activityEvents">
                    <div className="activityEventsTitle"><p>Последние события</p><span>{activityEvents.length}</span></div>
                    {activityEvents.length ? <ol>{activityEvents.map((event) => (
                      <li className={event.type} key={`${event.type}:${event.id}`}>
                        <i aria-hidden="true" />
                        <div><strong>{event.title}</strong><span>{event.detail}</span></div>
                        <b>{event.value}</b>
                        <time dateTime={event.createdAt}>{profileDate(event.createdAt)}</time>
                      </li>
                    ))}</ol> : <p className="activityEventsEmpty">События появятся после первой практики.</p>}
                  </div>
                </section>
              </div>
            ) : null}

            {section === "llm" ? (
              <form className="profileSection llmForm" onSubmit={saveLlm}>
                <div className="settingsIntro"><h3>Куратор и рабочий стек</h3></div>
                <div className="settingsBlock">
                  <div className="settingsBlockTitle"><div><h4>LLM provider</h4><p>{providerStatus?.configured ? `Ключ сохранён: ${providerStatus.masked}` : "Ключ не настроен"}</p></div><span className={providerStatus?.configured ? "configured" : ""}>{providerStatus?.configured ? "готов" : "setup"}</span></div>
                  <div className="fieldGrid two">
                    <Field label="Провайдер"><select value={form.providerId || ""} onChange={(event) => chooseProvider(event.target.value)}>{providers.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></Field>
                    <Field label="Модель"><input list="provider-models" value={form.providerModel || ""} onChange={(event) => change("providerModel", event.target.value)} placeholder="model-id" /><datalist id="provider-models">{models.map((model) => <option value={model} key={model} />)}</datalist></Field>
                    <Field label="Base URL"><input value={form.providerBaseUrl || ""} onChange={(event) => change("providerBaseUrl", event.target.value)} type="url" /></Field>
                    <Field label="Новый API key" hint="Оставьте пустым, чтобы не менять текущий."><input value={form.providerKey || ""} onChange={(event) => change("providerKey", event.target.value)} type="password" autoComplete="new-password" /></Field>
                  </div>
                  <button className="settingsSecondary" type="button" onClick={connectProviderAndLoadModels} disabled={loadingModels}>{loadingModels ? "Подключаюсь…" : providerStatus?.configured ? "Обновить список моделей" : "Подключить и загрузить модели"}</button>
                  {models.length ? (
                    <div className="modelPicker" role="listbox" aria-label="Доступные модели">
                      {models.map((model) => (
                        <button type="button" role="option" aria-selected={form.providerModel === model} key={model} onClick={() => change("providerModel", model)}>{model}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="settingsBlock">
                  <div className="settingsBlockTitle"><div><h4>Graph Memory</h4><p>Чатовая LLM формирует связи, backend сохраняет их в FalkorDB. Здесь нужен только эмбеддер для поиска.</p></div><span className={runtime?.graph?.ok ? "configured" : ""}>{runtime?.graph?.ok ? "online" : runtime?.graph?.configured ? "offline" : "setup"}</span></div>
                  <div className="fieldGrid two">
                    <Field label="Embedding provider"><select value={form.graphEmbeddingProvider || "openrouter"} onChange={(event) => chooseGraphProvider(event.target.value)}>{Object.entries(graphProviders).map(([id, item]) => <option value={id} key={id}>{item.label}</option>)}</select></Field>
                    <Field label="Graph memory URL"><input value={form.graphMemoryUrl || ""} onChange={(event) => change("graphMemoryUrl", event.target.value)} type="url" placeholder="http://127.0.0.1:8008" /></Field>
                    <Field label="Embedding model"><input value={form.graphEmbeddingModel || ""} onChange={(event) => change("graphEmbeddingModel", event.target.value)} placeholder="embedding-model-id" /></Field>
                    <Field label="Embedding base URL"><input value={form.graphEmbeddingBaseUrl || ""} onChange={(event) => change("graphEmbeddingBaseUrl", event.target.value)} type="url" /></Field>
                    <Field label="Embedding dimension"><input value={form.graphEmbeddingDim || ""} onChange={(event) => change("graphEmbeddingDim", event.target.value)} type="number" min="1" max="8192" /></Field>
                    <Field label="Embedding API key" hint="Используется только backend-ом; пустое поле оставит текущий ключ."><input value={form.graphApiKey || ""} onChange={(event) => change("graphApiKey", event.target.value)} type="password" autoComplete="new-password" /></Field>
                    {form.graphEmbeddingProvider === "yandex" ? <Field label="Yandex folder ID"><input value={form.graphYandexFolderId || ""} onChange={(event) => change("graphYandexFolderId", event.target.value)} type="password" autoComplete="new-password" /></Field> : null}
                  </div>
                </div>
                <div className="integrationNotice"><div><strong>Web search и дополнительные tools</strong><span>Требуется backend connector registry</span></div></div>
                <div className="settingsActions">
                  <button className="settingsSave" type="button" onClick={saveAndStartRuntime} disabled={saving}>{saving ? "Запускаю…" : "Сохранить и запустить контур"}</button>
                  <button className="settingsSecondary" type="submit" disabled={saving}>Только сохранить</button>
                </div>
              </form>
            ) : null}

            {section === "graph-memory" ? (
              <div className="profileSection graphMemorySection">
                <header className="graphMemoryHero">
                  <div>
                    <p>LIVE / FALKORDB</p>
                    <h3>Что помнит куратор</h3>
                  </div>
                  <div className="graphMemoryHeroMeta">
                    <strong>{graphMemory.items.length}</strong>
                    <span>связей</span>
                    <button type="button" onClick={() => setGraphRefreshKey((value) => value + 1)} disabled={graphMemory.loading}>Обновить</button>
                  </div>
                </header>

                {graphMemory.loading ? <div className="graphMemoryState" role="status">Читаю Graph Memory…</div> : null}
                {!graphMemory.loading && graphMemory.error ? (
                  <div className="graphMemoryState error" role="status">
                    <strong>Не удалось прочитать Graph Memory</strong>
                    <span>Проверьте, что единый контур запущен и embedder настроен.</span>
                    <button type="button" onClick={() => setGraphRefreshKey((value) => value + 1)}>Повторить</button>
                  </div>
                ) : null}
                {!graphMemory.loading && !graphMemory.error && !graphMemory.items.length ? (
                  <div className="graphMemoryState empty">
                    <strong>Память пока пуста</strong>
                    <span>Когда куратор сохранит устойчивый факт, его связь появится здесь.</span>
                  </div>
                ) : null}
                {!graphMemory.loading && !graphMemory.error && graphMemory.items.length ? (
                  <MemoryGraph items={graphMemory.items} />
                ) : null}
              </div>
            ) : null}

            {section === "personalization" ? (
              <form className="profileSection personalityForm" onSubmit={savePersonality}>
                <div className="personalityWorkspace">
                  <div className="personalityEditor">
                    <header>
                      <div><strong>Ваш контекст для куратора</strong><span id="personality-hint">Свободный Markdown: структура и порядок разделов остаются вашими.</span></div>
                      <b>{personalityDirty ? "Не сохранено" : "Сохранено"}</b>
                    </header>
                    <textarea aria-label="Контекст куратора" aria-describedby="personality-hint" value={personality} onChange={(event) => setPersonality(event.target.value)} rows="18" maxLength="100000" />
                    <footer><span>{personality.length} / 100 000 символов</span><button className="settingsSave" type="submit" disabled={saving || !personalityDirty}>{saving ? "Сохраняю…" : "Сохранить"}</button></footer>
                  </div>
                </div>
              </form>
            ) : null}
          </div>
          {notice.text ? <p className={`profileNotice ${notice.type}`} role="status">{notice.text}</p> : null}
        </section>
      </div>
    </dialog>
  );
}
