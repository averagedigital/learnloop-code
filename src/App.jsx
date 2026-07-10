import { useEffect, useRef, useState } from "react";
import { assistantMarkdownToHtml } from "./mascot-assistant.js";
import ProfileOverlay from "./ProfileOverlay.jsx";
import { providers } from "./platform.js";
import { profileAvatarSrc, profileMascotFrameSrc } from "./profile.js";

const starterPrompts = [
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

function currentRoute() {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  if (hash === "chat") return { tab: "chat", testId: "" };
  if (hash === "tests") return { tab: "tests", testId: "" };
  if (hash.startsWith("tests/")) return { tab: "tests", testId: hash.slice(6) };
  return { tab: "home", testId: "" };
}

function CanvasNeuralFlow() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastFrame = 0;
    let particles = [];

    function resetParticle(particle, randomX = false) {
      particle.x = randomX ? Math.random() * width : -20 - Math.random() * width * 0.16;
      particle.y = 7 + Math.random() * Math.max(12, height - 14);
      particle.speed = 0.42 + Math.random() * 0.72;
      particle.seed = Math.random() * 100;
      particle.radius = 0.7 + Math.random() * 1.35;
      particle.trailLength = 10 + Math.floor(Math.random() * 15);
      particle.trail = Array.from({ length: 9 }, (_, index) => ({
        x: particle.x - (8 - index) * (2.8 + particle.speed),
        y: particle.y + Math.sin(index * 0.72 + particle.seed) * (1.4 + particle.radius)
      }));
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const count = Math.max(24, Math.min(42, Math.round(width / 30)));
      particles = Array.from({ length: count }, () => {
        const particle = {};
        resetParticle(particle, true);
        return particle;
      });
      draw(0, 0);
    }

    function drawConnections() {
      for (let left = 0; left < particles.length; left += 1) {
        for (let right = left + 1; right < particles.length; right += 1) {
          const a = particles[left];
          const b = particles[right];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 88 || distance < 16) continue;
          const alpha = (1 - distance / 88) * 0.19;
          const bend = Math.sin((a.seed + b.seed) * 0.8) * 8;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + bend, b.x, b.y);
          context.strokeStyle = `rgba(249, 204, 115, ${alpha})`;
          context.lineWidth = 0.65;
          context.stroke();
        }
      }
    }

    function drawTrail(particle) {
      const trail = particle.trail;
      if (trail.length < 3) return;
      context.beginPath();
      context.moveTo(trail[0].x, trail[0].y);
      for (let index = 1; index < trail.length - 1; index += 1) {
        const point = trail[index];
        const next = trail[index + 1];
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      context.strokeStyle = `rgba(249, 204, 115, ${0.1 + particle.radius * 0.075})`;
      context.lineWidth = 0.65 + particle.radius * 0.32;
      context.stroke();
    }

    function draw(time, step) {
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        const field = Math.sin(particle.x * 0.018 + time * 0.00042 + particle.seed)
          + Math.cos(particle.y * 0.085 - time * 0.00031 + particle.seed * 1.7)
          + Math.sin((particle.x + particle.y) * 0.01 + particle.seed * 0.46);
        const angle = field * 0.24;
        particle.x += Math.max(0.24, Math.cos(angle) * particle.speed) * step;
        particle.y += Math.sin(angle) * particle.speed * 1.35 * step;
        particle.trail.push({ x: particle.x, y: particle.y });
        if (particle.trail.length > particle.trailLength) particle.trail.shift();
        if (particle.x > width + 24 || particle.y < -18 || particle.y > height + 18) resetParticle(particle);
      }
      drawConnections();
      for (const particle of particles) {
        drawTrail(particle);
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(244, 237, 54, ${0.28 + particle.radius * 0.16})`;
        context.fill();
      }
    }

    function animate(time) {
      const step = Math.min(2, Math.max(0.35, (time - lastFrame) / 16.67 || 1));
      lastFrame = time;
      draw(time, step);
      frame = window.requestAnimationFrame(animate);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (!reducedMotion.matches) frame = window.requestAnimationFrame(animate);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="composerNeuralCanvas" aria-hidden="true" />;
}

function ProfileTrigger({ settings, onClick, compact = false }) {
  const name = settings?.profileName || "Локальный ученик";
  return (
    <button className={`profileTrigger liquidGlass ${compact ? "compact" : ""}`} type="button" onClick={onClick} aria-label="Открыть профиль и настройки">
      <img src={profileAvatarSrc(settings?.mascotId)} alt="" />
      {!compact ? <div><strong>{name}</strong><span>Профиль и настройки</span></div> : null}
      {!compact ? <span aria-hidden="true">↗</span> : null}
    </button>
  );
}

function QuizView({ tests, selectedTestId, requestJson, onAttemptSaved }) {
  const selected = tests.find((test) => test.id === selectedTestId) || tests[0];
  const [answers, setAnswers] = useState({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAnswers({});
    setQuestionIndex(0);
    setFinished(false);
    setSaving(false);
    setError("");
  }, [selected?.id]);

  if (!selected) {
    return (
      <div className="testsEmpty">
        <p className="emptyEyebrow">CODELEARNML / TESTS</p>
        <h2>Тестов пока нет</h2>
        <p>Попроси куратора в чате: «Сформируй тест по теме».</p>
      </div>
    );
  }

  const score = selected.questions.reduce((total, question, index) => total + (answers[index] === question.correctAnswer ? 1 : 0), 0);
  const question = selected.questions[questionIndex];
  const selectedAnswer = answers[questionIndex];
  const answered = Number.isInteger(selectedAnswer);

  async function nextQuestion() {
    if (!answered || saving) return;
    if (questionIndex < selected.questions.length - 1) {
      setQuestionIndex((current) => current + 1);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await requestJson(`/api/tests/${encodeURIComponent(selected.id)}/attempts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: selected.questions.map((_, index) => answers[index]) })
      });
      setFinished(true);
      onAttemptSaved(result.attempt);
    } catch (requestError) {
      setError(requestError.message || "Не удалось сохранить результат теста.");
    } finally {
      setSaving(false);
    }
  }

  function restartTest() {
    setAnswers({});
    setQuestionIndex(0);
    setFinished(false);
    setError("");
  }

  return (
    <div className="testsView">
      <header className="testsHeader">
        <div><p>CODELEARNML / TESTS</p><h1>{selected.topic}</h1><span>{selected.level} · {selected.questions.length} вопросов</span></div>
      </header>
      {finished ? (
        <section className="quizResultCard" aria-live="polite">
          <p>Тест завершён</p>
          <strong className="quizResultValue">{score}<span> / {selected.questions.length}</span></strong>
          <h2>правильных ответов</h2>
          <button type="button" onClick={restartTest}>Пройти ещё раз</button>
        </section>
      ) : (
        <section className="quizCard" aria-labelledby="quiz-question">
          <div className="quizProgress">
            <span>Вопрос {questionIndex + 1} / {selected.questions.length}</span>
            <strong>Правильно {score} / {questionIndex + (answered ? 1 : 0)}</strong>
          </div>
          <div className="quizProgressTrack" aria-hidden="true"><span style={{ width: `${((questionIndex + (answered ? 1 : 0)) / selected.questions.length) * 100}%` }} /></div>
          <h2 id="quiz-question">{question.prompt}</h2>
          <div className="quizOptions">
            {question.options.map((option, optionIndex) => {
              const state = answered
                ? optionIndex === selectedAnswer
                  ? optionIndex === question.correctAnswer ? "correct" : "incorrect"
                  : optionIndex === question.correctAnswer ? "correctAnswer" : "muted"
                : "";
              return <button className={`quizOption ${state}`} type="button" key={optionIndex} disabled={answered} aria-pressed={selectedAnswer === optionIndex} onClick={() => setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }))}>{option}</button>;
            })}
          </div>
          {answered ? <p className={`quizExplanation ${selectedAnswer === question.correctAnswer ? "correct" : "incorrect"}`}>{question.explanation}</p> : null}
          <div className="quizCardFooter">
            <span>{answered ? selectedAnswer === question.correctAnswer ? "Верно" : "Неверно" : "Выбери один ответ"}</span>
            <button type="button" onClick={nextQuestion} disabled={!answered || saving}>{saving ? "Сохраняю…" : questionIndex === selected.questions.length - 1 ? "Завершить тест" : "Следующий вопрос"}</button>
          </div>
          {error ? <p className="quizError" role="alert">{error}</p> : null}
        </section>
      )}
    </div>
  );
}

export default function App() {
  const [frameIndex, setFrameIndex] = useState(0);
  const initialRoute = currentRoute();
  const [activeTab, setActiveTab] = useState(initialRoute.tab);
  const [selectedTestId, setSelectedTestId] = useState(initialRoute.testId);
  const [toolState, setToolState] = useState({ loading: true, error: "", app: null, runtime: null });
  const [chatHistory, setChatHistory] = useState([]);
  const [tests, setTests] = useState([]);
  const [chatId, setChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState("");
  const [memoryNotice, setMemoryNotice] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const composerRef = useRef(null);
  const threadEndRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = window.setInterval(() => setFrameIndex((current) => current + 1), 110);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadChat() {
      try {
        const [app, runtime, chats, savedTests] = await Promise.all([
          requestJson("/api/app-state"),
          requestJson("/api/runtime/health"),
          requestJson("/api/assistant/chats"),
          requestJson("/api/tests")
        ]);
        if (cancelled) return;
        const history = Array.isArray(chats.chats) ? chats.chats : [];
        setToolState({ loading: false, error: "", app, runtime });
        setChatHistory(history);
        setTests(Array.isArray(savedTests.tests) ? savedTests.tests : []);
        if (!runtime?.graph?.configured) setMemoryNotice("Graph memory не настроена. В запрос войдёт только локальная подтверждённая память.");
        else if (!runtime.graph.ok) setMemoryNotice("Graph memory недоступна. Результаты graph retrieval не используются.");
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
    const syncTab = () => {
      const route = currentRoute();
      setActiveTab(route.tab);
      setSelectedTestId(route.testId);
    };
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

  function showTab(tab) {
    window.location.hash = tab === "home" ? "" : tab;
    setActiveTab(tab);
  }

  function openTest(testId) {
    window.location.hash = `tests/${encodeURIComponent(testId)}`;
    setActiveTab("tests");
    setSelectedTestId(testId);
  }

  function startNewChat() {
    showTab("chat");
    setChatId("");
    setMessages([]);
    setDraft("");
    setComposerError("");
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function selectChat(chat) {
    showTab("chat");
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

  function applySettings(result) {
    setToolState((current) => ({
      ...current,
      app: current.app ? {
        ...current.app,
        settings: { ...current.app.settings, ...result.settings },
        providerStatus: result.providerStatus || current.app.providerStatus
      } : current.app
    }));
  }

  function applyRuntime(runtime) {
    setToolState((current) => ({ ...current, runtime }));
    if (runtime?.graph?.ok) setMemoryNotice("");
    else if (runtime?.graph?.configured) setMemoryNotice("Graph memory запускается или недоступна. Результаты graph retrieval пока не используются.");
    else setMemoryNotice("Graph memory не настроена. Настрой её в профиле → LLM и стек.");
  }

  function recordQuizAttempt(attempt) {
    setToolState((current) => ({
      ...current,
      app: current.app ? { ...current.app, quizAttempts: [attempt, ...(current.app.quizAttempts || [])] } : current.app
    }));
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

      const result = await requestJson("/api/assistant/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: id })
      });
      const completedMessages = [...nextMessages, result.message];
      setMessages(completedMessages);
      updateChatHistory(id, completedMessages);
      if (result.test) setTests((current) => [result.test, ...current.filter((test) => test.id !== result.test.id)]);
      const storedMemories = (result.memoryWrites || []).reduce((total, write) => total + Number(write.memory?.storedCount || 0), 0);
      const failedMemoryWrite = result.toolErrors?.find((error) => error.error === "graph_memory_write_failed");
      if (storedMemories) setMemoryNotice(`Graph Memory обновлена: ${storedMemories} наблюдений.`);
      else if (failedMemoryWrite) setMemoryNotice("Наблюдения сохранены локально, но Graph Memory не синхронизирована.");
      else if (!result.memory?.graph?.configured) setMemoryNotice("Graph memory не настроена. Ответ использует только локальную подтверждённую память.");
      else if (!result.memory.graph.ok) setMemoryNotice("Graph memory недоступна. Ответ получен без graph results.");
      else setMemoryNotice("");
      if (result.providerError) setComposerError("Provider не завершил финальный ответ; созданный тест сохранён и доступен.");
      else if (result.toolErrors?.length) setComposerError(`Инструмент не выполнил действие: ${result.toolErrors[0].error}`);
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
  const curatorStatus = toolState.loading
    ? "Подключаю контекст"
    : toolState.error
      ? "Backend недоступен"
      : providerReady
        ? toolState.runtime?.ok === false ? "Runtime требует внимания" : "Куратор готов"
        : "Нужна настройка модели";
  const profileOverlay = (
    <ProfileOverlay
      open={profileOpen}
      onClose={() => setProfileOpen(false)}
      app={toolState.app}
      runtime={toolState.runtime}
      requestJson={requestJson}
      onSettingsSaved={applySettings}
      onRuntimeUpdated={applyRuntime}
    />
  );

  if (activeTab === "home") {
    return (
      <>
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
                    src={profileMascotFrameSrc("05_laptop_spiky", "idle", frameIndex)}
                    alt=""
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
        <div className="landingProfileTrigger"><ProfileTrigger settings={settings} compact onClick={() => setProfileOpen(true)} /></div>
        {profileOverlay}
      </>
    );
  }

  return (
    <>
      <main className="appShell chatMode">
        <aside className={`chatSidebar ${sidebarOpen ? "open" : ""}`} aria-label={activeTab === "tests" ? "Навигация по тестам" : "История диалогов"}>
          <div className="sidebarHeader">
            <button className="sidebarHandle" type="button" aria-label={sidebarOpen ? "Свернуть боковую панель" : "Открыть боковую панель"} aria-expanded={sidebarOpen} onMouseDown={(event) => event.preventDefault()} onClick={() => setSidebarOpen((current) => !current)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
            </button>
            <button className="sidebarBrand" type="button" onClick={() => showTab("home")} aria-label="Вернуться на лендинг CodeLearnML">CodeLearnML</button>
            {activeTab === "chat" ? <button className="newChatButton" type="button" onClick={startNewChat} disabled={sending} aria-label="Новый чат">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button> : null}
          </div>
          <nav className="workspaceNav" aria-label="Рабочие разделы">
            <button type="button" aria-current={activeTab === "chat" ? "page" : undefined} onClick={() => showTab("chat")}>Чаты</button>
            <button type="button" disabled>Задачи <small>soon</small></button>
            <button type="button" aria-current={activeTab === "tests" ? "page" : undefined} onClick={() => showTab("tests")}>Тесты {tests.length ? <small>{tests.length}</small> : null}</button>
          </nav>
        <nav className={`chatHistory ${activeTab === "tests" ? "testHistory" : ""}`} aria-label={activeTab === "tests" ? "Сохранённые тесты" : "Сохранённые чаты"}>
          <p className="sidebarLabel">{activeTab === "tests" ? "Мои тесты" : "Недавние"}</p>
          {activeTab === "tests" ? tests.map((test) => (
            <button type="button" key={test.id} aria-current={test.id === (selectedTestId || tests[0]?.id) ? "page" : undefined} onClick={() => openTest(test.id)}>
              <strong>{test.topic}</strong>
              <span>{test.level} · {test.questions.length} вопросов</span>
            </button>
          )) : chatHistory.length ? chatHistory.map((chat) => (
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
          {activeTab === "tests" && !tests.length ? <span className="historyEmpty">Попросите куратора сформировать первый тест.</span> : null}
        </nav>
          <ProfileTrigger settings={settings} onClick={() => setProfileOpen(true)} />
        </aside>

        <section className={`chatSurface ${activeTab === "tests" ? "testsMode" : ""}`} aria-label={activeTab === "tests" ? "Тесты" : "Куратор LLM"}>
          <div className={`curatorStatus ${providerReady && toolState.runtime?.ok !== false ? "ready" : ""}`} role="status">
            <span aria-hidden="true" />{activeTab === "tests" ? `${tests.length} сохранено` : curatorStatus}
          </div>

        {activeTab === "tests" ? (
          <QuizView tests={tests} selectedTestId={selectedTestId} requestJson={requestJson} onAttemptSaved={recordQuizAttempt} />
        ) : <>
        <div className="chatThread" aria-live="polite" aria-busy={sending}>
          {toolState.loading ? (
            <div className="chatEmpty loading"><p>Поднимаю сохранённый контекст…</p></div>
          ) : messages.length === 0 ? (
            <div className="chatEmpty">
              <p className="emptyEyebrow">CODELEARNML / CURATOR</p>
              <h2>Что попрактикуем сегодня?</h2>
              <p>Опиши задачу своими словами или начни с одного из рабочих сценариев.</p>
              <div className="starterPrompts" aria-label="Примеры запросов">
                {starterPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => useStarterPrompt(prompt)}>{prompt}</button>)}
              </div>
            </div>
          ) : messages.map((message, index) => (
            <article className={`chatMessage ${message.role}`} key={message.createdAt || `${message.role}-${index}`}>
              <span className="messageAuthor">{message.role === "assistant" ? "Куратор" : message.role === "system" ? "Система" : "Вы"}</span>
              <div className="chatMarkdown" dangerouslySetInnerHTML={{ __html: assistantMarkdownToHtml(message.content) }} />
              {message.action?.type === "open_test" ? <button className="messageAction" type="button" onClick={() => openTest(message.action.targetId)}>{message.action.label}</button> : null}
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
          <div className="composerRow">
            <img className="composerMascot" src={profileMascotFrameSrc(settings.mascotId, sending ? "thinking" : draft.trim() ? "typing" : "idle", frameIndex)} alt="" />
            <div className="composerColumn">
              {memoryNotice ? <p className="memoryNotice" role="status">{memoryNotice}</p> : null}
              {composerError ? <p className="composerError" role="alert">{composerError}</p> : null}
              <form className="chatComposer composerGlass" onSubmit={sendMessage}>
                <CanvasNeuralFlow />
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
                  {sending ? "…" : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 17 10-10M8 7h9v9" /></svg>}
                </button>
              </form>
              <p className="composerHint">Enter — отправить · Shift + Enter — новая строка</p>
            </div>
          </div>
        </div>
        </>}
        </section>
      </main>
      {profileOverlay}
    </>
  );
}
