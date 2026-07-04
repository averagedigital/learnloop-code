const DEFAULT_SETTINGS = { size: 118 };
const MIN_SIZE = 82;
const MAX_SIZE = 190;
const EDGE = 12;
const DRAG_THRESHOLD = 8;

let widget;
let latestOptions;
let messages = [];
let pendingQuestion = "";
let loading = false;
let errorText = "";
let lastQuestion = "";

export function initMascotAssistant(options) {
  latestOptions = options;
  if (!widget) {
    injectMascotAssistantStyles();
    widget = createWidget();
    document.body.append(widget.root);
    bindWidget();
  }
  widget.settings = loadSettings(options.initialSettings);
  renderWidget();
  clampWidget();
}

export function assistantMarkdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];
  let inCode = false;
  let codeLang = "";
  let code = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushCode = () => {
    html.push(`<pre class="mascotAssistantCode"><code data-language="${escapeAttr(codeLang)}">${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
    codeLang = "";
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLang = line.slice(3).trim().split(/\s+/)[0] || "";
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    paragraph.push(line.trim());
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();
  return html.join("") || "<p>Ответ пуст.</p>";
}

export function buildMascotAssistantPrompt(question, context) {
  return [
    "Ты AI-наставник в браузерном тренажере программирования.",
    "Отвечай на русском, кратко и структурно. Markdown разрешен. Код давай только когда он нужен для объяснения.",
    "Не раскрывай полное решение без явного запроса. Сначала объясняй следующий маленький шаг.",
    "",
    "# Контекст страницы",
    JSON.stringify(context, null, 2),
    "",
    "# Вопрос ученика",
    question
  ].join("\n");
}

export function extractAssistantText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const responseText = data?.output?.flatMap((item) => item.content || []).find((content) => typeof content.text === "string")?.text;
  if (responseText) return responseText;
  const chatText = data?.choices?.[0]?.message?.content;
  if (typeof chatText === "string") return chatText;
  return JSON.stringify(data, null, 2);
}

function createWidget() {
  return {
    root: element("section", { class: "mascotAssistant", "aria-label": "AI-наставник" }),
    settings: loadSettings(),
    open: false,
    dragging: false,
    resizing: false,
    moved: false,
    openAfterPointer: false
  };
}

function renderWidget() {
  const size = widget.settings.size;
  const iconFrames = getIconFrames();
  widget.root.style.setProperty("--mascot-size", `${size}px`);
  widget.root.style.setProperty("--mascot-frame-count", iconFrames.length);
  widget.root.style.setProperty("--mascot-frame-steps", Math.max(1, iconFrames.length - 1));
  widget.root.style.transform = `translate(${widget.settings.x}px, ${widget.settings.y}px)`;
  widget.root.innerHTML = `
    <button class="mascotAssistantBubble" type="button" aria-label="Открыть AI-наставника" aria-expanded="${widget.open}">
      <span class="mascotAssistantIcon" aria-hidden="true">
        ${iconFrames.map((frame) => `<img src="${latestOptions.mascotFrameBase}/frame_${frame}.png" alt="">`).join("")}
      </span>
    </button>
    <button class="mascotAssistantResize" type="button" aria-label="Изменить размер маскота"></button>
    ${widget.open ? renderDialog() : ""}
  `;
}

function getIconFrames() {
  const count = Math.max(1, Number(latestOptions.iconFrameCount) || 12);
  return Array.from({ length: count }, (_, index) => String(index + 1).padStart(2, "0"));
}

function renderDialog() {
  const assistantUrl = externalAssistantUrl();
  if (assistantUrl) {
    return `
      <aside class="mascotAssistantDialog agent" role="dialog" aria-label="OpenHands agent">
        <header>
          <div><strong>OpenHands</strong><span>${escapeHtml(latestOptions.getPageContext().title || "Текущая страница")}</span></div>
          <a href="${escapeAttr(assistantUrl)}" target="_blank" rel="noopener noreferrer">Открыть</a>
          <button type="button" data-mascot-close aria-label="Закрыть">×</button>
        </header>
        <iframe class="mascotAssistantAgentFrame" title="OpenHands agent" src="${escapeAttr(assistantUrl)}"></iframe>
      </aside>
    `;
  }
  return `
    <aside class="mascotAssistantDialog" role="dialog" aria-label="AI-наставник">
      <header>
        <div><strong>AI-наставник</strong><span>${escapeHtml(latestOptions.getPageContext().title || "Текущая страница")}</span></div>
        <button type="button" data-mascot-close aria-label="Закрыть">×</button>
      </header>
      <div class="mascotAssistantMessages">
        ${messages.length ? messages.map(renderMessage).join("") : `<div class="mascotAssistantEmpty">Спросите по текущей задаче, коду или экрану.</div>`}
        ${loading ? `<div class="mascotAssistantMessage assistant">Думаю…</div>` : ""}
        ${errorText ? `<div class="mascotAssistantError">${escapeHtml(errorText)} <button type="button" data-mascot-retry>Повторить</button></div>` : ""}
      </div>
      <form class="mascotAssistantForm">
        <textarea rows="3" name="question" placeholder="Например: почему этот тест падает?">${escapeHtml(pendingQuestion)}</textarea>
        <button type="submit" ${loading ? "disabled" : ""}>Отправить</button>
      </form>
    </aside>
  `;
}

function renderMessage(message) {
  const body = message.role === "assistant" ? assistantMarkdownToHtml(message.content) : `<p>${escapeHtml(message.content)}</p>`;
  return `<article class="mascotAssistantMessage ${message.role}">${body}</article>`;
}

function bindWidget() {
  widget.root.addEventListener("click", (event) => {
    if (event.target.closest("[data-mascot-close]")) {
      closeDialog();
      return;
    }
    if (event.target.closest("[data-mascot-retry]")) {
      sendQuestion(lastQuestion);
      return;
    }
    if (event.target.closest(".mascotAssistantBubble") && !widget.moved) {
      openAssistant();
    }
  });
  widget.root.addEventListener("input", (event) => {
    if (event.target.name === "question") pendingQuestion = event.target.value;
  });
  widget.root.addEventListener("submit", (event) => {
    event.preventDefault();
    sendQuestion(new FormData(event.target).get("question"));
  });
  widget.root.addEventListener("pointerdown", startPointerAction);
  window.addEventListener("pointermove", movePointerAction);
  window.addEventListener("pointerup", stopPointerAction);
  window.addEventListener("resize", clampWidget);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && widget.open) closeDialog();
  });
  window.addEventListener("mascot-assistant-open", () => {
    openAssistant();
  });
}

function startPointerAction(event) {
  if (event.target.closest(".mascotAssistantResize")) {
    widget.resizing = { startX: event.clientX, startSize: widget.settings.size };
  } else if (event.target.closest(".mascotAssistantBubble")) {
    widget.dragging = { startX: event.clientX, startY: event.clientY, x: widget.settings.x, y: widget.settings.y };
    widget.openAfterPointer = true;
  } else {
    return;
  }
  widget.moved = false;
  widget.root.setPointerCapture?.(event.pointerId);
  widget.root.classList.add(widget.resizing ? "resizing" : "dragging");
}

function movePointerAction(event) {
  if (widget.resizing) {
    const delta = event.clientX - widget.resizing.startX;
    widget.settings.size = clamp(widget.resizing.startSize + delta, MIN_SIZE, MAX_SIZE);
    widget.moved = Math.abs(delta) > DRAG_THRESHOLD;
    renderWidget();
    clampWidget();
  }
  if (widget.dragging) {
    const dx = event.clientX - widget.dragging.startX;
    const dy = event.clientY - widget.dragging.startY;
    widget.settings.x = widget.dragging.x + dx;
    widget.settings.y = widget.dragging.y + dy;
    widget.moved = Math.hypot(dx, dy) > DRAG_THRESHOLD;
    clampWidget(false);
  }
}

function stopPointerAction() {
  if (!widget.dragging && !widget.resizing) return;
  const shouldOpen = widget.openAfterPointer && !widget.moved;
  const shouldSave = widget.moved;
  widget.dragging = false;
  widget.resizing = false;
  widget.openAfterPointer = false;
  widget.root.classList.remove("dragging", "resizing");
  clampWidget();
  if (shouldSave) saveSettings();
  if (shouldOpen) {
    openAssistant();
  }
  setTimeout(() => { widget.moved = false; }, 0);
}

function clampWidget(shouldRender = true) {
  const dialogWidth = widget.open ? 392 : 0;
  const width = widget.settings.size + dialogWidth + 18;
  const height = widget.open ? Math.max(widget.settings.size, 460) : widget.settings.size;
  const minX = window.innerWidth > 720 ? 112 : EDGE;
  widget.settings.x = clamp(widget.settings.x, minX, Math.max(minX, window.innerWidth - width - EDGE));
  widget.settings.y = clamp(widget.settings.y, EDGE, Math.max(EDGE, window.innerHeight - height - EDGE));
  if (shouldRender) renderWidget();
  else widget.root.style.transform = `translate(${widget.settings.x}px, ${widget.settings.y}px)`;
}

async function sendQuestion(rawQuestion) {
  const question = String(rawQuestion || "").trim();
  if (!question || loading) return;
  pendingQuestion = "";
  lastQuestion = question;
  errorText = "";
  messages.push({ role: "user", content: question });
  loading = true;
  renderWidget();
  try {
    const context = latestOptions.getPageContext();
    const answer = await latestOptions.sendMessage({ question, context });
    messages.push({ role: "assistant", content: answer });
  } catch (error) {
    errorText = error.message || "Не удалось получить ответ.";
  } finally {
    loading = false;
    renderWidget();
  }
}

function closeDialog() {
  widget.open = false;
  errorText = "";
  renderWidget();
}

function externalAssistantUrl() {
  const url = String(latestOptions.openAssistantUrl || "").trim();
  return url || "";
}

function openAssistant() {
  widget.open = true;
  renderWidget();
  clampWidget();
  if (!externalAssistantUrl()) requestAnimationFrame(() => widget.root.querySelector("textarea")?.focus());
}

function loadSettings(settings) {
  if (Number.isFinite(settings?.x) && Number.isFinite(settings?.y)) {
    return { ...DEFAULT_SETTINGS, ...settings };
  }
  return {
    ...DEFAULT_SETTINGS,
    x: Math.max(EDGE, window.innerWidth - DEFAULT_SETTINGS.size - EDGE - 18),
    y: Math.max(EDGE, window.innerHeight - DEFAULT_SETTINGS.size - EDGE - 18)
  };
}

function saveSettings() {
  latestOptions.saveSettings?.(widget.settings);
}

function inlineMarkdown(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function injectMascotAssistantStyles() {
  if (document.querySelector("#mascotAssistantStyles")) return;
  const style = element("style", { id: "mascotAssistantStyles" });
  style.textContent = `
    .mascotAssistant{position:fixed;left:0;top:0;z-index:70;display:flex;align-items:flex-start;gap:14px;touch-action:none;transition:filter .18s var(--ease)}
    .mascotAssistant.dragging,.mascotAssistant.resizing{filter:drop-shadow(0 18px 32px rgba(15,23,42,.2))}
    .mascotAssistantBubble{width:var(--mascot-size);height:var(--mascot-size);padding:0;border:0;background:transparent;display:block;overflow:hidden;box-shadow:none}
    .mascotAssistantBubble:hover{transform:translateY(-2px) scale(1.02);box-shadow:none}
    .mascotAssistantIcon{width:calc(var(--mascot-frame-count,12) * 100%);height:100%;display:grid;grid-template-columns:repeat(var(--mascot-frame-count,12),1fr);pointer-events:none;animation:mascotAssistantFrames 2.4s steps(var(--mascot-frame-steps,11)) infinite}
    .mascotAssistantIcon img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
    .mascotAssistantResize{position:absolute;right:-4px;bottom:-4px;width:22px;height:22px;border-radius:50%;background:var(--ink);border:2px solid var(--surface);box-shadow:var(--shadow-sm)}
    .mascotAssistantResize::before{content:"";position:absolute;inset:6px;border-right:2px solid white;border-bottom:2px solid white}
    .mascotAssistantDialog{width:min(392px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:rgba(5,12,9,.96);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);overflow:hidden;animation:mascotDialogIn .18s var(--ease)}
    .mascotAssistantDialog.agent{width:min(760px,calc(100vw - 32px));height:min(680px,calc(100vh - 32px));grid-template-rows:auto minmax(0,1fr);background:#fff}
    .mascotAssistantDialog header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-bottom:1px solid var(--line)}
    .mascotAssistantDialog header strong,.mascotAssistantDialog header span{display:block}
    .mascotAssistantDialog header span{color:var(--muted);font-size:12px}
    .mascotAssistantDialog header a{color:var(--ink);font-weight:800;text-decoration:none}
    .mascotAssistantDialog header button{width:34px;height:34px;padding:0;border-radius:50%;font-size:20px}
    .mascotAssistantAgentFrame{width:100%;height:100%;border:0;background:#fff}
    .mascotAssistantMessages{overflow:auto;padding:14px;display:grid;align-content:start;gap:10px}
    .mascotAssistantMessage{max-width:92%;padding:10px 12px;border-radius:8px;background:var(--soft);word-break:break-word}
    .mascotAssistantMessage.user{justify-self:end;background:linear-gradient(135deg,rgba(57,255,136,.24),rgba(8,18,14,.94));color:var(--ink)}
    .mascotAssistantMessage.assistant{justify-self:start;background:var(--accent-soft)}
    .mascotAssistantMessage p,.mascotAssistantMessage ul,.mascotAssistantMessage h3,.mascotAssistantMessage h4,.mascotAssistantMessage h5{margin:0 0 8px}
    .mascotAssistantMessage p:last-child,.mascotAssistantMessage ul:last-child,.mascotAssistantMessage h3:last-child,.mascotAssistantMessage h4:last-child,.mascotAssistantMessage h5:last-child{margin-bottom:0}
    .mascotAssistantMessage ul{padding-left:20px}
    .mascotAssistantMessage code{padding:1px 4px;border-radius:5px;background:rgba(0,0,0,.08)}
    .mascotAssistantCode{margin:8px 0 0;padding:10px;border-radius:8px;background:#0d1117;color:#f8fafc;white-space:pre;overflow:auto}
    .mascotAssistantCode code{padding:0;background:transparent;color:inherit}
    .mascotAssistantEmpty,.mascotAssistantError{padding:12px;border-radius:8px;background:var(--soft);color:var(--muted)}
    .mascotAssistantError{background:var(--red-soft);color:var(--red)}
    .mascotAssistantForm{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:14px;border-top:1px solid var(--line)}
    .mascotAssistantForm textarea{min-height:68px;resize:vertical;border-radius:8px}
    .mascotAssistantForm button{align-self:end;border-radius:8px;background:var(--fire);color:#031008}
    @keyframes mascotDialogIn{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
    @keyframes mascotAssistantFrames{to{transform:translateX(calc(-100% + (100% / var(--mascot-frame-count,12))))}}
    @media (max-width:720px){.mascotAssistant{gap:8px;z-index:3}.mascotAssistantBubble{width:min(var(--mascot-size),76px);height:min(var(--mascot-size),76px)}.mascotAssistantResize{width:18px;height:18px}.mascotAssistantResize::before{inset:5px}.mascotAssistantDialog{width:calc(100vw - 24px)}.mascotAssistantForm{grid-template-columns:1fr}}
    @media (prefers-reduced-motion:reduce){.mascotAssistant *{animation:none!important;transition:none!important}}
  `;
  document.head.append(style);
}

function element(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
