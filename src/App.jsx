import { useEffect, useRef, useState } from "react";
import { assistantMarkdownToHtml } from "./mascot-assistant.js";
import { buildProviderPayload, modelControlPrompt, providers } from "./platform.js";

const mascotFrames = Array.from({ length: 12 }, (_, index) => {
  return `/assets/mascots/05_laptop_spiky/frames/idle/frame_${String(index + 1).padStart(2, "0")}.png`;
});

const starterPrompts = [
  "Разбери этот код и объясни, где риск ошибки.",
  "Составь небольшое задание с проверяемыми критериями.",
  "Подготовь тесты и документацию для моего решения."
];

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Backend вернул невалидный JSON (${response.status}).`);
  }
  if (!response.ok) throw new Error(data.message || data.error || `Backend ответил ${response.status}.`);
  return data;
}

function assistantText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  if (typeof data?.choices?.[0]?.message?.content === "string") return data.choices[0].message.content;
  return data?.output?.flatMap((item) => item.content || []).find((item) => typeof item.text === "string")?.text || "";
}

export default function App() {
  const [frameIndex, setFrameIndex] = useState(0);
  const [activeTab, setActiveTab] = useState(() => window.location.hash === "#chat" ? "chat" : "home");
  const [toolState, setToolState] = useState({ loading: true, error: "", app: null, runtime: null });
  const [chatHistory, setChatHistory] = useState([]);
  const [chatId, setChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState("");
  const composerRef = useRef(null);
  const threadEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function loadChat() {
      try {
        const [app, runtime, chats] = await Promise.all([
          requestJson("/api/app-state"),
          requestJson("/api/runtime/health"),
          requestJson("/api/assistant/chats")
        ]);
        if (cancelled) return;
        const history = Array.isArray(chats.chats) ? chats.chats : [];
        setToolState({ loading: false, error: "", app, runtime });
        setChatHistory(history);
        if (history[0]) {
          setChatId(history[0].id);
          setMessages(history[0].messages || []);
        }
      } catch (error) {
        if (!cancelled) setToolState({ loading: false, error: error.message, app: null, runtime: null });
      }
    }

    loadChat();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab === "chat") threadEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeTab, messages, sending]);

  useEffect(() => {
    const syncTab = () => setActiveTab(window.location.hash === "#chat" ? "chat" : "home");
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

  function showTab(tab) {
    window.location.hash = tab === "chat" ? "chat" : "";
    setActiveTab(tab);
  }

  function startNewChat() {
    setChatId("");
    setMessages([]);
    setDraft("");
    setComposerError("");
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function selectChat(chat) {
    setChatId(chat.id);
    setMessages(chat.messages || []);
    setComposerError("");
  }

  function updateChatHistory(id, nextMessages, createdChat) {
    setChatHistory((history) => {
      const current = createdChat || history.find((chat) => chat.id === id);
      if (!current) return history;
      const updated = { ...current, messages: nextMessages, updatedAt: new Date().toISOString() };
      return [updated, ...history.filter((chat) => chat.id !== id)];
    });
  }

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;

    const nextMessages = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setDraft("");
    setComposerError("");
    setSending(true);

    try {
      let id = chatId;
      let createdChat = null;
      if (!id) {
        const created = await requestJson("/api/assistant/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: content.slice(0, 72) })
        });
        createdChat = created.chat;
        id = createdChat.id;
        setChatId(id);
      }

      await requestJson(`/api/assistant/chats/${encodeURIComponent(id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content })
      });
      updateChatHistory(id, nextMessages, createdChat);

      const settings = toolState.app?.settings || {};
      const providerId = settings.providerId || "openrouter";
      const provider = providers.find((item) => item.id === providerId);
      const configured = toolState.app?.providerStatus?.[providerId]?.configured;
      if (!provider || !configured || !settings.providerModel) {
        throw new Error("Модель не настроена. Укажите provider, model и ключ в backend settings.");
      }

      const prompt = `${modelControlPrompt}\n\n#dialog\n${nextMessages.map((message) => `${message.role}: ${message.content}`).join("\n")}`;
      const payload = buildProviderPayload({
        ...provider,
        model: settings.providerModel,
        baseUrl: settings.providerBaseUrl || provider.baseUrl
      }, prompt);
      const ai = await requestJson("/api/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const reply = assistantText(ai).trim();
      if (!reply) throw new Error("Модель не вернула текстовый ответ.");

      const completedMessages = [...nextMessages, { role: "assistant", content: reply }];
      setMessages(completedMessages);
      updateChatHistory(id, completedMessages);
      await requestJson(`/api/assistant/chats/${encodeURIComponent(id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: reply })
      });
    } catch (error) {
      setComposerError(error.message || "Не удалось получить ответ куратора.");
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function useStarterPrompt(prompt) {
    setDraft(prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  const settings = toolState.app?.settings || {};
  const providerId = settings.providerId || "openrouter";
  const provider = providers.find((item) => item.id === providerId);
  const providerReady = Boolean(provider && settings.providerModel && toolState.app?.providerStatus?.[providerId]?.configured);
  const activeChat = chatHistory.find((chat) => chat.id === chatId);
  const curatorStatus = toolState.loading
    ? "Подключаю контекст"
    : toolState.error
      ? "Backend недоступен"
      : providerReady
        ? toolState.runtime?.ok === false ? "Runtime требует внимания" : "Куратор готов"
        : "Нужна настройка модели";

  if (activeTab === "home") {
    return (
      <main className="posterShell" aria-labelledby="hero-title">
        <nav className="posterNav" aria-label="Главная">
          <a className="wordmark" href="/" aria-label="CodeLearnML">CodeLearnML</a>
        </nav>
        <section className="heroPoster">
          <div className="heroCopy posterCenter">
            <p className="monoStamp">LOCAL CODE PRACTICE / LLM LESSONS / REAL CHECKS</p>
            <h1 id="hero-title" className="heroTitle" aria-label="Какой код пишем?">
              <span className="headlineStack"><span>КАКОЙ</span><span>КОД</span></span>
              <span className="mascotPeek" aria-hidden="true">
                <img
                  className="peekMascot"
                  src={mascotFrames[frameIndex]}
                  alt=""
                  onAnimationIteration={() => setFrameIndex((frameIndex + 1) % mascotFrames.length)}
                />
              </span>
              <span className="headlineStack"><span>ПИШЕМ?</span></span>
            </h1>
            <div className="heroActionRow">
              <button className="posterAction" type="button" onClick={() => showTab("chat")}>Реди</button>
            </div>
          </div>
          <span className="srOnly">Маскот-наставник CodeLearnML выглядывает из заголовка.</span>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell chatMode">
      <aside className="chatSidebar" aria-label="История диалогов">
        <button className="sidebarBrand" type="button" onClick={() => showTab("home")} aria-label="Вернуться на лендинг CodeLearnML">
          CodeLearnML
        </button>
        <button className="newChatButton" type="button" onClick={startNewChat} disabled={sending}>+ Новый чат</button>
        <nav className="chatHistory" aria-label="Сохранённые чаты">
          <p className="sidebarLabel">Недавние</p>
          {chatHistory.length ? chatHistory.map((chat) => (
            <button
              type="button"
              key={chat.id}
              aria-current={chat.id === chatId ? "page" : undefined}
              onClick={() => selectChat(chat)}
              disabled={sending}
            >
              {chat.label}
            </button>
          )) : <span className="historyEmpty">История появится после первого сообщения.</span>}
        </nav>
        <div className="sidebarContext">
          <span>{provider?.label || "LLM provider"}</span>
          <strong>{settings.providerModel || "Модель не выбрана"}</strong>
        </div>
      </aside>

      <section className="chatSurface" aria-label="Куратор LLM">
        <header className="chatTopbar">
          <div className="curatorIdentity">
            <img className="chatMascot" src={mascotFrames[frameIndex]} alt="" />
            <div><strong>Куратор LLM</strong><span>{activeChat?.label || "Новый диалог"}</span></div>
          </div>
          <div className={`curatorStatus ${providerReady && toolState.runtime?.ok !== false ? "ready" : ""}`} role="status">
            <span aria-hidden="true" />{curatorStatus}
          </div>
        </header>

        <div className="chatThread" aria-live="polite" aria-busy={sending}>
          {toolState.loading ? (
            <div className="chatEmpty loading"><p>Поднимаю сохранённый контекст…</p></div>
          ) : messages.length === 0 ? (
            <div className="chatEmpty">
              <p className="emptyEyebrow">CODELEARNML / CURATOR</p>
              <h2>Чем займёмся с кодом?</h2>
              <p>Опиши задачу своими словами или начни с одного из рабочих сценариев.</p>
              <div className="starterPrompts" aria-label="Примеры запросов">
                {starterPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => useStarterPrompt(prompt)}>{prompt}</button>)}
              </div>
            </div>
          ) : messages.map((message, index) => (
            <article className={`chatMessage ${message.role}`} key={message.createdAt || `${message.role}-${index}`}>
              <span className="messageAuthor">{message.role === "assistant" ? "Куратор" : message.role === "system" ? "Система" : "Вы"}</span>
              {message.role === "assistant" ? (
                <div className="chatMarkdown" dangerouslySetInnerHTML={{ __html: assistantMarkdownToHtml(message.content) }} />
              ) : <p>{message.content}</p>}
            </article>
          ))}
          {sending ? (
            <article className="chatMessage assistant pending">
              <span className="messageAuthor">Куратор</span>
              <p><span className="thinkingDot" />Обдумываю ответ</p>
            </article>
          ) : null}
          {toolState.error ? <p className="backendError" role="alert">Не удалось загрузить чат: {toolState.error}</p> : null}
          <div ref={threadEndRef} />
        </div>

        <div className="composerDock">
          {composerError ? <p className="composerError" role="alert">{composerError}</p> : null}
          <form className="chatComposer" onSubmit={sendMessage}>
            <label className="srOnly" htmlFor="chat-draft">Сообщение куратору</label>
            <textarea
              id="chat-draft"
              ref={composerRef}
              rows="1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Спроси о коде…"
              disabled={sending || toolState.loading}
            />
            <button type="submit" disabled={sending || toolState.loading || !draft.trim()} aria-label="Отправить сообщение">
              {sending ? "…" : "Отправить"}
            </button>
          </form>
          <p className="composerHint">Enter — отправить · Shift + Enter — новая строка</p>
        </div>
      </section>
    </main>
  );
}
