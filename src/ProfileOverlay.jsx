import { useEffect, useRef, useState } from "react";
import { providers } from "./platform.js";
import { buildActivityCalendar, profileAvatarSrc } from "./profile.js";

const sections = [
  { id: "overview", label: "Обзор", hint: "Активность и контекст" },
  { id: "llm", label: "LLM и стек", hint: "Модели и runtime" },
  { id: "personalization", label: "Персонализация", hint: "Память куратора" }
];

const mascotOptions = [
  { id: "05_laptop_spiky", label: "Кодер" },
  { id: "organic_spiky_concept", label: "Органик" }
];

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

export default function ProfileOverlay({ open, onClose, app, runtime, requestJson, onSettingsSaved }) {
  const dialogRef = useRef(null);
  const [section, setSection] = useState("overview");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({});
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [personality, setPersonality] = useState("");
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
      workspaceRuntime: settings.workspaceRuntime || "code-server",
      workspaceRuntimeUrl: settings.workspaceRuntimeUrl || "",
      agentRuntimeUrl: settings.agentRuntimeUrl || "",
      graphMemoryUrl: settings.graphMemoryUrl || ""
    });
  }, [app?.settings]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    requestJson("/api/personality")
      .then((data) => {
        if (!cancelled) setPersonality(data.markdown || "");
      })
      .catch((error) => {
        if (!cancelled) setNotice({ type: "error", text: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [open, requestJson]);

  const activity = buildActivityCalendar(app);
  const settings = app?.settings || {};
  const activeProvider = providers.find((item) => item.id === form.providerId) || providers[1];
  const providerStatus = app?.providerStatus?.[form.providerId];
  const taskLogs = app?.taskLogs || [];
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

  async function saveLlm(event) {
    event.preventDefault();
    const payload = {
      providerId: form.providerId,
      providerBaseUrl: form.providerBaseUrl,
      providerModel: form.providerModel,
      workspaceRuntime: form.workspaceRuntime,
      workspaceRuntimeUrl: form.workspaceRuntimeUrl,
      agentRuntimeUrl: form.agentRuntimeUrl,
      graphMemoryUrl: form.graphMemoryUrl
    };
    if (form.providerKey.trim()) payload.providerApiKeys = { [form.providerId]: form.providerKey.trim() };
    const result = await saveSettings(payload, "LLM и runtime сохранены.");
    if (result) change("providerKey", "");
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
                  <div className="settingsBlockTitle"><div><h4>Runtime</h4><p>Workspace, coding agent и graph memory.</p></div><span className={runtime?.ok ? "configured" : ""}>{runtime?.ok ? "online" : "check"}</span></div>
                  <div className="fieldGrid two">
                    <Field label="Workspace"><select value={form.workspaceRuntime || "code-server"} onChange={(event) => change("workspaceRuntime", event.target.value)}><option value="code-server">code-server</option><option value="openvscode-server">openvscode-server</option></select></Field>
                    <Field label="Workspace URL"><input value={form.workspaceRuntimeUrl || ""} onChange={(event) => change("workspaceRuntimeUrl", event.target.value)} type="url" placeholder="http://…" /></Field>
                    <Field label="Agent URL"><input value={form.agentRuntimeUrl || ""} onChange={(event) => change("agentRuntimeUrl", event.target.value)} type="url" placeholder="http://…" /></Field>
                    <Field label="Graph memory URL"><input value={form.graphMemoryUrl || ""} onChange={(event) => change("graphMemoryUrl", event.target.value)} type="url" placeholder="http://…" /></Field>
                  </div>
                </div>
                <div className="integrationNotice"><div><strong>Web search и дополнительные tools</strong><span>Требуется backend connector registry</span></div></div>
                <button className="settingsSave" type="submit" disabled={saving}>Сохранить LLM и стек</button>
              </form>
            ) : null}

            {section === "personalization" ? (
              <form className="profileSection personalityForm" onSubmit={savePersonality}>
                <div className="settingsIntro"><h3>Память куратора</h3><p>Markdown используется моделью для устойчивых предпочтений, сильных сторон и проблемных тем.</p></div>
                <Field label="personality.md" hint="Изменения сохраняются через существующий /api/personality.">
                  <textarea value={personality} onChange={(event) => setPersonality(event.target.value)} rows="18" />
                </Field>
                <button className="settingsSave" type="submit" disabled={saving}>Сохранить персонализацию</button>
              </form>
            ) : null}
          </div>
          {notice.text ? <p className={`profileNotice ${notice.type}`} role="status">{notice.text}</p> : null}
        </section>
      </div>
    </dialog>
  );
}
