import { useEffect, useRef, useState } from "react";
import { assistantMarkdownToHtml, buildMascotAssistantPrompt, initMascotAssistant, raiseMascotAssistant } from "./mascot-assistant.js";
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

async function requestAssistantStream(chatId, signal, onEvent) {
  const response = await fetch("/api/assistant/respond/stream", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ chatId }),
    signal
  });
  if (!response.ok) {
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Backend вернул невалидный ответ (${response.status}).`);
    }
    throw new Error(data.message || data.error || `Backend ответил ${response.status}.`);
  }
  if (!/^text\/event-stream/i.test(response.headers.get("content-type") || "") || !response.body) {
    throw new Error("Backend не открыл поток ответа.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator) {
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (data) {
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          throw new Error("Backend вернул повреждённое событие потока.");
        }
        if (event.type === "error") throw new Error(event.message || event.error || "Provider stream failed.");
        onEvent(event);
        if (event.type === "complete") completed = event;
      }
      separator = buffer.match(/\r?\n\r?\n/);
    }
    if (done) break;
  }
  if (!completed) throw new Error("Поток завершился без финального ответа.");
  return completed;
}

function parsedMascotSettings(value) {
  try {
    const settings = JSON.parse(String(value || ""));
    return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : undefined;
  } catch {
    return undefined;
  }
}

function isMascotChat(chat) {
  return String(chat?.label || "").startsWith("Помощь · ");
}

function currentRoute() {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  if (hash === "chat") return { tab: "chat", testId: "", taskId: "" };
  if (hash === "tasks") return { tab: "tasks", testId: "", taskId: "" };
  if (hash.startsWith("tasks/")) return { tab: "tasks", testId: "", taskId: hash.slice(6) };
  if (hash === "tests") return { tab: "tests", testId: "", taskId: "" };
  if (hash.startsWith("tests/")) return { tab: "tests", testId: hash.slice(6), taskId: "" };
  return { tab: "home", testId: "", taskId: "" };
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

function TaskView({ tasks, selectedTaskId, chats, mascotId, requestJson, onTaskUpdated, onChatUpdated, onExecutionEvidence }) {
  const selected = tasks.find((task) => task.id === selectedTaskId) || tasks[0];
  const [log, setLog] = useState(null);
  const [code, setCode] = useState("");
  const [output, setOutput] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const taskChat = chats.find((chat) => chat.taskId === selected?.id);
  const [tutorChatId, setTutorChatId] = useState("");
  const [tutorMessages, setTutorMessages] = useState([]);
  const [tutorDraft, setTutorDraft] = useState("");
  const [tutorSending, setTutorSending] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const tutorAbortRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!selected) return undefined;
    setLog(null);
    setOutput(null);
    setError("");
    requestJson(`/api/tasks/${encodeURIComponent(selected.id)}/log`).then((result) => {
      if (cancelled) return;
      setLog(result);
      setCode(result.userCode || result.task.starterCode || "");
    }).catch((requestError) => {
      if (!cancelled) setError(requestError.message || "Не удалось загрузить задачу.");
    });
    return () => { cancelled = true; };
  }, [selected?.id, requestJson]);

  useEffect(() => {
    setTutorChatId(taskChat?.id || "");
    setTutorMessages(taskChat?.messages || []);
    setTutorDraft("");
  }, [selected?.id, taskChat?.id]);

  if (!selected) return <div className="testsEmpty"><p className="emptyEyebrow">CODELEARNML / TASKS</p><h2>Задач пока нет</h2><p>Попроси куратора: «Создай coding-задачу».</p></div>;
  if (!log && !error) return <div className="chatEmpty loading"><p>Загружаю рабочее состояние задачи…</p></div>;

  async function execute(mode) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await requestJson(`/api/tasks/${encodeURIComponent(selected.id)}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, mode })
      });
      setOutput(result);
      onExecutionEvidence(selected.id, {
        status: result.execution.status,
        feedback: result.feedback,
        stdout: result.execution.stdout,
        stderr: result.execution.stderr,
        publicChecks: result.execution.public_test_results
      });
      onTaskUpdated({ ...selected, status: result.taskStatus, finalResult: result.feedback, updatedAt: new Date().toISOString() });
    } catch (requestError) {
      setError(requestError.message || "Не удалось выполнить код.");
    } finally {
      setLoading(false);
    }
  }

  async function requestTutor(content) {
    if (!content || tutorSending) return;
    const userMessages = [...tutorMessages, { role: "user", content }];
    let streamed = { role: "assistant", content: "", reasoning: "", streaming: true, createdAt: `task-stream-${Date.now()}` };
    setTutorMessages([...userMessages, streamed]);
    setTutorDraft("");
    setTutorSending(true);
    const controller = new AbortController();
    tutorAbortRef.current = controller;
    try {
      let id = tutorChatId;
      let createdChat = null;
      if (!id) {
        const created = await requestJson("/api/assistant/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label: selected.title, taskId: selected.id })
        });
        createdChat = created.chat;
        id = created.chat.id;
        setTutorChatId(id);
      }
      await requestJson(`/api/assistant/chats/${encodeURIComponent(id)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "user", content })
      });
      const result = await requestAssistantStream(id, controller.signal, (streamEvent) => {
        if (streamEvent.type === "text_delta") streamed = { ...streamed, content: `${streamed.content}${streamEvent.delta}` };
        if (streamEvent.type === "reasoning_delta") streamed = { ...streamed, reasoning: `${streamed.reasoning}${streamEvent.delta}` };
        if (["text_delta", "reasoning_delta"].includes(streamEvent.type)) setTutorMessages([...userMessages, streamed]);
      });
      const completed = [...userMessages, result.message];
      setTutorMessages(completed);
      onChatUpdated(id, completed, createdChat || taskChat || { id, label: selected.title, taskId: selected.id });
    } catch (requestError) {
      const partial = streamed.content || streamed.reasoning ? { ...streamed, streaming: false, interrupted: true } : null;
      setTutorMessages(partial ? [...userMessages, partial] : userMessages);
      setError(requestError.name === "AbortError" ? "Ответ куратора остановлен." : requestError.message || "Куратор недоступен.");
    } finally {
      tutorAbortRef.current = null;
      setTutorSending(false);
    }
  }

  async function askTutor(event) {
    event.preventDefault();
    const content = tutorDraft.trim();
    if (!content) return;
    await requestTutor(content);
  }

  async function reviewSolution() {
    if (reviewing || tutorSending) return;
    setReviewing(true);
    setError("");
    try {
      await requestJson(`/api/tasks/${encodeURIComponent(selected.id)}/progress`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code })
      });
      setTutorOpen(true);
      await requestTutor("Проведи ревью текущего решения: оцени корректность, читаемость, граничные случаи и соответствие acceptance criteria. Учти последние результаты исполнения, если они есть.");
    } catch (requestError) {
      setError(requestError.message || "Не удалось запросить ревью.");
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="taskView">
      <header className="taskHeader"><div><p>CODELEARNML / TASK</p><h1>{log?.task.title || selected.title}</h1><span>{log?.task.language || "python"} · {selected.difficulty || "средняя"} · {selected.minutes || 20} мин</span></div></header>
      <div className="taskWorkbench">
        <section className="taskBrief" aria-label="Условие задачи">
          <h2>Условие</h2>
          <p>{log?.task.prompt}</p>
          <h3>Готово, когда</h3>
          <ul>{(log?.task.acceptanceCriteria || []).map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
        </section>
        <section className="taskEditor" aria-label="Редактор решения">
          <div className="taskEditorBar"><span>{log?.task.language === "javascript" ? "solution.js" : "solution.py"}</span><small>{loading ? "выполняется" : "сохраняется при запуске или ревью"}</small></div>
          <textarea aria-label="Код решения" value={code} onChange={(event) => setCode(event.target.value)} spellCheck="false" disabled={loading} />
          <div className="taskActions"><button type="button" onClick={() => execute("run")} disabled={loading}>Запустить код</button><button type="button" className="primary" onClick={reviewSolution} disabled={reviewing || tutorSending}>{reviewing ? "Ревью…" : "Ревью LLM"}</button></div>
          {output ? <div className={`taskOutput ${output.execution.status}`} role="status"><strong>{output.feedback}</strong><pre>{[output.execution.stdout, output.execution.stderr].filter(Boolean).join("\n") || output.execution.public_test_results.map((check) => `${check.passed ? "✓" : "×"} ${check.name}`).join("\n")}</pre></div> : null}
          {error ? <p className="composerError" role="alert">{error}</p> : null}
        </section>
      </div>
      <details className="taskTutor" open={tutorOpen} onToggle={(event) => setTutorOpen(event.currentTarget.open)}>
        <summary><img className="taskTutorMascot" src={profileMascotFrameSrc(mascotId, tutorSending ? "thinking" : "idle", 0)} alt="" />Диалог с куратором <span>{tutorMessages.length ? tutorMessages.length : ""}</span></summary>
        <div className="taskTutorThread">
          {tutorMessages.length ? tutorMessages.map((message, index) => <div className={`taskTutorMessage ${message.role}`} key={message.createdAt || `${message.role}-${index}`}>
            {message.reasoning ? <details className="reasoningDisclosure"><summary>Краткое обоснование</summary><div className="chatMarkdown" dangerouslySetInnerHTML={{ __html: assistantMarkdownToHtml(message.reasoning) }} /></details> : null}
            {message.content ? <div className="chatMarkdown" dangerouslySetInnerHTML={{ __html: assistantMarkdownToHtml(message.content) }} /> : <span>Обдумываю…</span>}
          </div>) : <p>Спроси о текущем коде или результате запуска.</p>}
        </div>
        <form className="taskTutorComposer" onSubmit={askTutor}><input aria-label="Вопрос куратору по задаче" value={tutorDraft} onChange={(event) => setTutorDraft(event.target.value)} placeholder="Почему не проходит проверка?" disabled={tutorSending} /><button type={tutorSending ? "button" : "submit"} onClick={tutorSending ? () => tutorAbortRef.current?.abort() : undefined} disabled={!tutorSending && !tutorDraft.trim()}>{tutorSending ? "Стоп" : "Спросить"}</button></form>
      </details>
    </div>
  );
}

export default function App() {
  const [frameIndex, setFrameIndex] = useState(0);
  const initialRoute = currentRoute();
  const [activeTab, setActiveTab] = useState(initialRoute.tab);
  const [selectedTestId, setSelectedTestId] = useState(initialRoute.testId);
  const [selectedTaskId, setSelectedTaskId] = useState(initialRoute.taskId);
  const [toolState, setToolState] = useState({ loading: true, error: "", app: null, runtime: null });
  const [chatHistory, setChatHistory] = useState([]);
  const [tests, setTests] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [chatId, setChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState("");
  const [memoryNotice, setMemoryNotice] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSection, setProfileSection] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [taskExecutionEvidence, setTaskExecutionEvidence] = useState({});
  const composerRef = useRef(null);
  const threadEndRef = useRef(null);
  const activeRequestRef = useRef(null);
  const mascotContextRef = useRef({ surface: "chat" });
  const mascotSendRef = useRef(null);

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
        const initialChat = history.find((chat) => !chat.taskId && !isMascotChat(chat));
        setToolState({ loading: false, error: "", app, runtime });
        setChatHistory(history);
        setTests(Array.isArray(savedTests.tests) ? savedTests.tests : []);
        setTasks(Array.isArray(app.tasks) ? app.tasks : []);
        if (!runtime?.graph?.configured) setMemoryNotice("Graph memory не настроена. В запрос войдёт только локальная подтверждённая память.");
        else if (!runtime.graph.ok) setMemoryNotice("Graph memory недоступна. Результаты graph retrieval не используются.");
        if (initialChat) {
          setChatId(initialChat.id);
          setMessages(initialChat.messages || []);
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
      setSelectedTaskId(route.taskId);
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

  function openTask(taskId) {
    window.location.hash = `tasks/${encodeURIComponent(taskId)}`;
    setActiveTab("tasks");
    setSelectedTaskId(taskId);
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

  function updateTask(task) {
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
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

  function recordTaskExecution(taskId, evidence) {
    setTaskExecutionEvidence((current) => ({ ...current, [taskId]: evidence }));
  }

  async function sendMascotMessage({ question, context, signal, onEvent }) {
    const created = await requestJson("/api/assistant/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: `Помощь · ${context.surface}`,
        ...(context.surface === "task" && context.taskId ? { taskId: context.taskId } : {})
      })
    });
    const content = buildMascotAssistantPrompt(question, context);
    await requestJson(`/api/assistant/chats/${encodeURIComponent(created.chat.id)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user", content })
    });
    const result = await requestAssistantStream(created.chat.id, signal, onEvent);
    if (result.task) setTasks((current) => [result.task, ...current.filter((task) => task.id !== result.task.id)]);
    if (result.test) setTests((current) => [result.test, ...current.filter((test) => test.id !== result.test.id)]);
    return result.message;
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

    const streamId = `stream-${Date.now()}`;
    let streamedMessage = { role: "assistant", content: "", reasoning: "", streaming: true, createdAt: streamId };
    const controller = new AbortController();
    activeRequestRef.current = controller;

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

      setMessages([...nextMessages, streamedMessage]);
      const result = await requestAssistantStream(id, controller.signal, (streamEvent) => {
        if (streamEvent.type === "text_delta") {
          streamedMessage = { ...streamedMessage, content: `${streamedMessage.content}${streamEvent.delta}` };
          setMessages([...nextMessages, streamedMessage]);
        } else if (streamEvent.type === "reasoning_delta") {
          streamedMessage = { ...streamedMessage, reasoning: `${streamedMessage.reasoning}${streamEvent.delta}` };
          setMessages([...nextMessages, streamedMessage]);
        } else if (streamEvent.type === "complete") {
          streamedMessage = streamEvent.message;
          setMessages([...nextMessages, streamEvent.message]);
        }
      });
      const completedMessages = [...nextMessages, result.message];
      setMessages(completedMessages);
      updateChatHistory(id, completedMessages);
      if (result.task) setTasks((current) => [result.task, ...current.filter((task) => task.id !== result.task.id)]);
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
      const partial = streamedMessage.content || streamedMessage.reasoning
        ? { ...streamedMessage, streaming: false, interrupted: true }
        : null;
      setMessages(partial ? [...nextMessages, partial] : nextMessages);
      setComposerError(error.name === "AbortError"
        ? "Ответ остановлен. Частичный текст не сохранён в истории."
        : error.message || "Не удалось получить ответ куратора.");
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      setSending(false);
    }
  }

  function cancelResponse() {
    activeRequestRef.current?.abort();
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
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || tasks[0];
  const selectedTest = tests.find((test) => test.id === selectedTestId) || tests[0];
  mascotContextRef.current = profileOpen
    ? profileSection === "graph-memory"
      ? { surface: "graph-memory", question: "Что куратор помнит", status: toolState.runtime?.graph?.ok ? "online" : "offline" }
      : { surface: "settings", question: "Настройки учебного контура", status: providerReady ? "provider-ready" : "provider-not-configured" }
    : activeTab === "task" || activeTab === "tasks"
      ? { surface: "task", taskId: selectedTask?.id, question: selectedTask?.title, status: selectedTask?.status, executionEvidence: taskExecutionEvidence[selectedTask?.id] }
      : activeTab === "tests"
        ? { surface: "test", testId: selectedTest?.id, question: selectedTest?.topic, status: selectedTest ? `${selectedTest.questions?.length || 0} questions` : "empty" }
        : { surface: "chat", question: messages.at(-1)?.content || "Диалог с куратором", status: curatorStatus };
  mascotSendRef.current = sendMascotMessage;

  useEffect(() => {
    if (!toolState.app) return;
    const mascotId = settings.mascotId || "05_laptop_spiky";
    initMascotAssistant({
      initialSettings: parsedMascotSettings(settings.mascotAssistantSettings),
      mascotFrameBase: `/assets/mascots/${encodeURIComponent(mascotId)}/frames/idle`,
      iconFrameCount: mascotId.startsWith("organic") ? 24 : 12,
      getPageContext: () => mascotContextRef.current,
      sendMessage: (payload) => mascotSendRef.current(payload),
      saveSettings: async (nextSettings) => {
        const result = await requestJson("/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mascotAssistantSettings: JSON.stringify(nextSettings) })
        });
        applySettings(result);
      }
    });
  }, [settings.mascotAssistantSettings, settings.mascotId, toolState.app]);

  const profileOverlay = (
    <ProfileOverlay
      open={profileOpen}
      onClose={() => setProfileOpen(false)}
      app={toolState.app}
      runtime={toolState.runtime}
      requestJson={requestJson}
      onSettingsSaved={applySettings}
      onRuntimeUpdated={applyRuntime}
      onSectionChange={setProfileSection}
      onOpened={raiseMascotAssistant}
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
        <aside className={`chatSidebar ${sidebarOpen ? "open" : ""}`} aria-label={activeTab === "tests" ? "Навигация по тестам" : activeTab === "tasks" ? "Навигация по задачам" : "История диалогов"}>
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
            <button type="button" aria-current={activeTab === "tasks" ? "page" : undefined} onClick={() => showTab("tasks")}>Задачи {tasks.length ? <small>{tasks.length}</small> : null}</button>
            <button type="button" aria-current={activeTab === "tests" ? "page" : undefined} onClick={() => showTab("tests")}>Тесты {tests.length ? <small>{tests.length}</small> : null}</button>
          </nav>
        <nav className={`chatHistory ${activeTab !== "chat" ? "testHistory" : ""}`} aria-label={activeTab === "tests" ? "Сохранённые тесты" : activeTab === "tasks" ? "Сохранённые задачи" : "Сохранённые чаты"}>
          <p className="sidebarLabel">{activeTab === "tests" ? "Мои тесты" : activeTab === "tasks" ? "Мои задачи" : "Недавние"}</p>
          {activeTab === "tests" ? tests.map((test) => (
            <button type="button" key={test.id} aria-current={test.id === (selectedTestId || tests[0]?.id) ? "page" : undefined} onClick={() => openTest(test.id)}>
              <strong>{test.topic}</strong>
              <span>{test.level} · {test.questions.length} вопросов</span>
            </button>
          )) : activeTab === "tasks" ? tasks.map((task) => (
            <button type="button" key={task.id} aria-current={task.id === (selectedTaskId || tasks[0]?.id) ? "page" : undefined} onClick={() => openTask(task.id)}>
              <strong>{task.title}</strong>
              <span>{task.language || "python"} · {task.status}</span>
            </button>
          )) : chatHistory.some((chat) => !chat.taskId && !isMascotChat(chat)) ? chatHistory.filter((chat) => !chat.taskId && !isMascotChat(chat)).map((chat) => (
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
          {activeTab === "tasks" && !tasks.length ? <span className="historyEmpty">Попросите куратора создать первую задачу.</span> : null}
        </nav>
          <ProfileTrigger settings={settings} onClick={() => setProfileOpen(true)} />
        </aside>

        <section className={`chatSurface ${activeTab === "tests" ? "testsMode" : activeTab === "tasks" ? "tasksMode" : ""}`} aria-label={activeTab === "tests" ? "Тесты" : activeTab === "tasks" ? "Задачи" : "Куратор LLM"}>
          <div className={`curatorStatus ${providerReady && toolState.runtime?.ok !== false ? "ready" : ""}`} role="status">
            <span aria-hidden="true" />{activeTab === "tests" ? `${tests.length} сохранено` : activeTab === "tasks" ? `${tasks.length} задач` : curatorStatus}
          </div>

        {activeTab === "tests" ? (
          <QuizView tests={tests} selectedTestId={selectedTestId} requestJson={requestJson} onAttemptSaved={recordQuizAttempt} />
        ) : activeTab === "tasks" ? (
          <TaskView tasks={tasks} selectedTaskId={selectedTaskId} chats={chatHistory} mascotId={settings.mascotId} requestJson={requestJson} onTaskUpdated={updateTask} onChatUpdated={updateChatHistory} onExecutionEvidence={recordTaskExecution} />
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
              {message.reasoning ? (
                <details className="reasoningDisclosure">
                  <summary>Краткое обоснование</summary>
                  <div className="chatMarkdown" dangerouslySetInnerHTML={{ __html: assistantMarkdownToHtml(message.reasoning) }} />
                </details>
              ) : null}
              {message.content ? <div className="chatMarkdown" dangerouslySetInnerHTML={{ __html: assistantMarkdownToHtml(message.content) }} /> : message.streaming ? <p className="streamWaiting"><span className="thinkingDot" />Обдумываю ответ</p> : null}
              {message.interrupted ? <span className="streamInterrupted">Ответ прерван · не сохранён</span> : null}
              {message.action?.type === "open_test" ? <button className="messageAction" type="button" onClick={() => openTest(message.action.targetId)}>{message.action.label}</button> : null}
              {message.action?.type === "open_task" ? <button className="messageAction" type="button" onClick={() => openTask(message.action.targetId)}>{message.action.label}</button> : null}
            </article>
          ))}
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
                <button type={sending ? "button" : "submit"} onClick={sending ? cancelResponse : undefined} disabled={toolState.loading || (!sending && !draft.trim())} aria-label={sending ? "Остановить ответ" : "Отправить сообщение"}>
                  {sending ? <span className="stopStreamIcon" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 17 10-10M8 7h9v9" /></svg>}
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
