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
let activeController;

const SURFACES = new Set(["chat", "test", "task", "settings", "graph-memory"]);

export function normalizeMascotContext(input = {}) {
  const surface = SURFACES.has(input.surface) ? input.surface : "chat";
  const context = { surface };
  if (surface === "task" && safeText(input.taskId, 120)) context.taskId = safeText(input.taskId, 120);
  if (surface === "test" && safeText(input.testId, 120)) context.testId = safeText(input.testId, 120);
  if (safeText(input.question, 500)) context.question = safeText(input.question, 500);
  if (safeText(input.status, 160)) context.status = safeText(input.status, 160);
  const evidence = normalizeExecutionEvidence(input.executionEvidence);
  if (evidence) context.executionEvidence = evidence;
  return context;
}

export function clampMascotSettings(settings = {}, viewport = {}) {
  const width = Math.max(1, Number(viewport.width) || 1);
  const height = Math.max(1, Number(viewport.height) || 1);
  const size = clamp(Number(settings.size) || DEFAULT_SETTINGS.size, MIN_SIZE, MAX_SIZE);
  const desktop = width > 720;
  const occupiedWidth = size;
  const occupiedHeight = size;
  const minX = desktop ? 112 : EDGE;
  return {
    x: clamp(Number(settings.x) || minX, minX, Math.max(minX, width - occupiedWidth - EDGE)),
    y: clamp(Number(settings.y) || EDGE, EDGE, Math.max(EDGE, height - occupiedHeight - EDGE)),
    size
  };
}

export function initMascotAssistant(options) {
  latestOptions = options;
  if (!widget) {
    injectMascotAssistantStyles();
    widget = createWidget();
    document.body.append(widget.root);
    widget.root.showPopover?.();
    bindWidget();
  }
  widget.settings = loadSettings(options.initialSettings);
  renderWidget();
  clampWidget();
}

export function raiseMascotAssistant(host = document.body) {
  if (!widget?.root.showPopover) return;
  widget.root.hidePopover?.();
  host.append(widget.root);
  widget.root.showPopover();
}

export function assistantMarkdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];
  let listTag = "ul";
  let inCode = false;
  let codeLang = "";
  let code = [];
  let quote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html.push(`<${listTag}>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listTag}>`);
    list = [];
  };
  const flushCode = () => {
    const language = normalizedCodeLanguage(codeLang);
    html.push(`<pre class="mascotAssistantCode" data-language="${escapeAttr(language || "text")}"><code class="language-${escapeAttr(language || "text")}">${highlightCode(code.join("\n"), language)}</code></pre>`);
    code = [];
    codeLang = "";
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote><p>${inlineMarkdown(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        flushQuote();
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
      flushQuote();
      continue;
    }
    const tableHeaders = markdownTableCells(line);
    const tableDivider = markdownTableCells(lines[index + 1] || "");
    if (tableHeaders && tableDivider?.length === tableHeaders.length && tableDivider.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      flushParagraph();
      flushList();
      flushQuote();
      const rows = [];
      index += 2;
      while (index < lines.length) {
        const cells = markdownTableCells(lines[index]);
        if (!cells || cells.length !== tableHeaders.length) break;
        rows.push(cells);
        index += 1;
      }
      index -= 1;
      html.push(`<div class="markdownTableWrap"><table><thead><tr>${tableHeaders.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (bullet || ordered) {
      flushParagraph();
      const nextListTag = ordered ? "ol" : "ul";
      if (list.length && listTag !== nextListTag) flushList();
      listTag = nextListTag;
      list.push((ordered || bullet)[1]);
      continue;
    }
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    flushQuote();
    paragraph.push(line.trim());
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();
  flushQuote();
  return html.join("") || "<p>Ответ пуст.</p>";
}

function markdownTableCells(line) {
  const value = String(line || "").trim();
  if (!value.includes("|")) return null;
  return value.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
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
    root: element("section", { class: "mascotAssistant", "aria-label": "AI-наставник", popover: "manual" }),
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
  widget.root.style.setProperty("--mascot-x", `${widget.settings.x}px`);
  widget.root.style.setProperty("--mascot-y", `${widget.settings.y}px`);
  widget.root.innerHTML = `
    <button class="mascotAssistantBubble" type="button" aria-label="Открыть AI-наставника. Стрелки перемещают маскота" aria-expanded="${widget.open}" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space">
      <span class="mascotAssistantIcon" aria-hidden="true">
        ${iconFrames.map((frame) => `<img src="${latestOptions.mascotFrameBase}/frame_${frame}.png" alt="">`).join("")}
      </span>
    </button>
    <button class="mascotAssistantResize" type="button" aria-label="Изменить размер маскота стрелками" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"></button>
    ${widget.open ? renderDialog() : ""}
  `;
}

function getIconFrames() {
  const count = Math.max(1, Number(latestOptions.iconFrameCount) || 12);
  return Array.from({ length: count }, (_, index) => String(index + 1).padStart(2, "0"));
}

function renderDialog() {
  const assistantUrl = externalAssistantUrl();
  const contextLabel = mascotContextLabel(normalizeMascotContext(latestOptions.getPageContext()));
  const placement = window.innerWidth <= 720
    ? "mobile"
    : `${widget.settings.x + widget.settings.size + 424 <= window.innerWidth ? "right" : "left"} ${widget.settings.y > window.innerHeight / 2 ? "bottom" : "top"}`;
  if (assistantUrl) {
    return `
      <aside class="mascotAssistantDialog agent ${placement}" role="dialog" aria-label="OpenHands agent">
        <header>
          <div><strong>OpenHands</strong><span>${escapeHtml(contextLabel)}</span></div>
          <a href="${escapeAttr(assistantUrl)}" target="_blank" rel="noopener noreferrer">Открыть</a>
          <button type="button" data-mascot-close aria-label="Закрыть">×</button>
        </header>
        <iframe class="mascotAssistantAgentFrame" title="OpenHands agent" src="${escapeAttr(assistantUrl)}"></iframe>
      </aside>
    `;
  }
  return `
    <aside class="mascotAssistantDialog ${placement}" role="dialog" aria-label="AI-наставник">
      <header>
        <div><strong>AI-наставник</strong><span>${escapeHtml(contextLabel)}</span></div>
        <button type="button" data-mascot-close aria-label="Закрыть">×</button>
      </header>
      <div class="mascotAssistantMessages">
        ${messages.length ? messages.map(renderMessage).join("") : `<div class="mascotAssistantEmpty">Спросите по текущей задаче, коду или экрану.</div>`}
        ${errorText ? `<div class="mascotAssistantError">${escapeHtml(errorText)} <button type="button" data-mascot-retry>Повторить</button></div>` : ""}
      </div>
      <form class="mascotAssistantForm chatComposer composerGlass">
        <textarea rows="3" name="question" placeholder="Например: почему этот тест падает?">${escapeHtml(pendingQuestion)}</textarea>
        <button type="${loading ? "button" : "submit"}" ${loading ? "data-mascot-cancel" : ""} aria-label="${loading ? "Остановить ответ" : "Отправить сообщение"}">
          ${loading ? `<span class="stopStreamIcon" aria-hidden="true"></span>` : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 17 10-10M8 7h9v9"></path></svg>`}
        </button>
      </form>
    </aside>
  `;
}

function renderMessage(message) {
  const body = message.role === "assistant"
    ? message.content ? `<div class="mascotAssistantBody chatMarkdown">${assistantMarkdownToHtml(message.content)}</div>` : message.streaming ? `<p class="streamWaiting">Обдумываю ответ</p>` : ""
    : `<p>${escapeHtml(message.content)}</p>`;
  const reasoning = message.reasoning
    ? `<details class="mascotAssistantReasoning reasoningDisclosure"><summary>Краткое обоснование</summary><div class="mascotAssistantBody chatMarkdown">${assistantMarkdownToHtml(message.reasoning)}</div></details>`
    : "";
  const tools = message.tools?.length
    ? `<ul class="mascotAssistantTools">${message.tools.map((tool) => `<li class="${escapeAttr(tool.status || "done")}">${escapeHtml(tool.label)}</li>`).join("")}</ul>`
    : "";
  const author = message.role === "assistant" ? "Куратор" : "Вы";
  return `<article class="mascotAssistantMessage chatMessage ${message.role}"><span class="messageAuthor">${author}</span>${reasoning}${body}${tools}</article>`;
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
    if (event.target.closest("[data-mascot-cancel]")) {
      activeController?.abort();
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
  widget.root.addEventListener("keydown", handleWidgetKeyDown);
  window.addEventListener("pointermove", movePointerAction);
  window.addEventListener("pointerup", stopPointerAction);
  window.addEventListener("pointercancel", stopPointerAction);
  window.addEventListener("resize", handleViewportResize);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && widget.open) closeDialog();
  });
  window.addEventListener("mascot-assistant-open", () => {
    openAssistant();
  });
}

function handleWidgetKeyDown(event) {
  const bubble = event.target.closest(".mascotAssistantBubble");
  const resize = event.target.closest(".mascotAssistantResize");
  if (bubble && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openAssistant();
    return;
  }
  if (!bubble && !resize) return;
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!direction) return;
  event.preventDefault();
  if (resize) widget.settings.size += direction[0] * 8 - direction[1] * 8;
  else {
    widget.settings.x += direction[0] * 12;
    widget.settings.y += direction[1] * 12;
  }
  clampWidget();
  saveSettings();
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
  const previous = widget.settings;
  widget.settings = clampMascotSettings(widget.settings, { width: window.innerWidth, height: window.innerHeight, dialogOpen: widget.open });
  if (shouldRender) renderWidget();
  else {
    widget.root.style.setProperty("--mascot-x", `${widget.settings.x}px`);
    widget.root.style.setProperty("--mascot-y", `${widget.settings.y}px`);
  }
  return previous.x !== widget.settings.x || previous.y !== widget.settings.y || previous.size !== widget.settings.size;
}

function handleViewportResize() {
  if (clampWidget()) saveSettings();
}

async function sendQuestion(rawQuestion) {
  const question = String(rawQuestion || "").trim();
  if (!question || loading) return;
  pendingQuestion = "";
  lastQuestion = question;
  errorText = "";
  messages.push({ role: "user", content: question });
  let streamed = { role: "assistant", content: "", reasoning: "", tools: [], streaming: true };
  messages.push(streamed);
  loading = true;
  activeController = new AbortController();
  renderWidget();
  try {
    const context = normalizeMascotContext(latestOptions.getPageContext());
    const answer = await latestOptions.sendMessage({
      question,
      context,
      signal: activeController.signal,
      onEvent(event) {
        streamed = updateStreamedMessage(streamed, event);
        messages[messages.length - 1] = streamed;
        renderWidget();
      }
    });
    messages[messages.length - 1] = { ...streamed, ...answer, role: "assistant", streaming: false };
  } catch (error) {
    if (!streamed.content && !streamed.reasoning) messages.pop();
    errorText = error.name === "AbortError" ? "Ответ остановлен." : error.message || "Не удалось получить ответ.";
  } finally {
    activeController = undefined;
    loading = false;
    renderWidget();
  }
}

function updateStreamedMessage(message, event) {
  if (event.type === "text_delta") return { ...message, content: `${message.content}${event.delta || ""}` };
  if (event.type === "reasoning_delta") return { ...message, reasoning: `${message.reasoning}${event.delta || ""}` };
  if (event.type === "tool_start") return { ...message, tools: [...message.tools, { label: event.name || "Инструмент", status: "running" }] };
  if (event.type === "tool_complete" || event.type === "tool_error") {
    return { ...message, tools: [...message.tools, { label: event.name || (event.type === "tool_error" ? "Инструмент не выполнен" : "Инструмент выполнен"), status: event.type === "tool_error" ? "error" : "done" }] };
  }
  if (event.type === "complete") {
    const tools = [
      ...(event.action ? [{ label: event.action.label || "Действие выполнено", status: "done" }] : []),
      ...(event.toolErrors || []).map(() => ({ label: "Инструмент не выполнен", status: "error" }))
    ];
    return { ...message, ...event.message, tools: [...message.tools, ...tools], streaming: false };
  }
  return message;
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

function normalizeExecutionEvidence(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const evidence = {};
  for (const [key, limit] of [["status", 80], ["feedback", 500], ["stdout", 2000], ["stderr", 2000]]) {
    if (safeText(input[key], limit)) evidence[key] = safeText(input[key], limit);
  }
  if (Array.isArray(input.publicChecks)) {
    evidence.publicChecks = input.publicChecks.slice(0, 20).map((check) => ({
      name: safeText(check?.name, 200),
      passed: Boolean(check?.passed)
    })).filter((check) => check.name);
    if (!evidence.publicChecks.length) delete evidence.publicChecks;
  }
  return Object.keys(evidence).length ? evidence : null;
}

function safeText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function saveSettings() {
  Promise.resolve(latestOptions.saveSettings?.(widget.settings)).catch((error) => {
    errorText = error.message || "Не удалось сохранить позицию маскота.";
    if (widget.open) renderWidget();
  });
}

function mascotContextLabel(context) {
  return ({
    chat: "Текущий чат",
    test: "Текущий тест",
    task: "Текущая задача",
    settings: "Настройки",
    "graph-memory": "Graph Memory"
  })[context.surface];
}

function inlineMarkdown(value) {
  const code = [];
  const escaped = escapeHtml(value).replace(/`([^`]+)`/g, (_match, content) => {
    code.push(`<code>${content}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });
  return escaped
    .replace(/==(.+?)==/g, "<mark>$1</mark>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, "$1<em>$2</em>")
    .replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => code[Number(index)] || "");
}

function normalizedCodeLanguage(language) {
  const value = String(language || "").toLowerCase();
  return ({ javascript: "js", typescript: "ts", python: "py", shell: "bash", sh: "bash" })[value] || value.replace(/[^a-z0-9_+-]/g, "").slice(0, 24);
}

function highlightCode(value, language) {
  const source = String(value || "");
  const keywords = language === "py"
    ? "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|not|or|pass|raise|return|True|try|while|with|yield"
    : language === "bash"
      ? "case|do|done|elif|else|esac|export|fi|for|function|if|in|local|then|while"
      : "async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|yield";
  const comments = language === "py" || language === "bash" ? "#[^\\n]*" : "\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*";
  const pattern = new RegExp(`(${comments})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b(?:${keywords})\\b)|(\\b\\d+(?:\\.\\d+)?\\b)`, "g");
  let html = "";
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    html += escapeHtml(source.slice(offset, match.index));
    const className = match[1] ? "syntaxComment" : match[2] ? "syntaxString" : match[3] ? "syntaxKeyword" : "syntaxNumber";
    html += `<span class="${className}">${escapeHtml(match[0])}</span>`;
    offset = match.index + match[0].length;
  }
  return html + escapeHtml(source.slice(offset));
}

function injectMascotAssistantStyles() {
  if (document.querySelector("#mascotAssistantStyles")) return;
  const style = element("style", { id: "mascotAssistantStyles" });
  style.textContent = `
    .mascotAssistant{--chat-bg:#0d1013;--chat-panel:#171c21;--chat-raised:#1d2329;--chat-text:#f9f5f2;--chat-secondary:#c5c3c8;--chat-muted:#838891;--chat-line:rgba(249,245,242,.12);--chat-line-strong:rgba(249,204,115,.38);--chat-accent:#f9cc73;--chat-violet:#8584bd;--color-hi-vis-yellow:#f4ed36;position:fixed;inset:auto;left:var(--mascot-x);top:var(--mascot-y);z-index:70;display:flex;align-items:flex-start;gap:14px;margin:0;padding:0;overflow:visible;border:0;background:transparent;transition:filter .18s var(--ease)}
    .mascotAssistant.dragging,.mascotAssistant.resizing{filter:drop-shadow(0 18px 32px rgba(15,23,42,.2))}
    .mascotAssistantBubble{width:var(--mascot-size);height:var(--mascot-size);padding:0;border:0;background:transparent;display:block;overflow:hidden;box-shadow:none;touch-action:none}
    .mascotAssistantBubble:hover{transform:translateY(-2px) scale(1.02);box-shadow:none}
    .mascotAssistantIcon{width:calc(var(--mascot-frame-count,12) * 100%);height:100%;display:grid;grid-template-columns:repeat(var(--mascot-frame-count,12),1fr);pointer-events:none;animation:mascotAssistantFrames 2.4s steps(var(--mascot-frame-steps,11)) infinite}
    .mascotAssistantIcon img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
    .mascotAssistantResize{position:absolute;right:-4px;bottom:-4px;width:22px;height:22px;border-radius:50%;background:var(--chat-text);border:2px solid var(--chat-bg);box-shadow:0 4px 16px rgba(0,0,0,.28);touch-action:none}
    .mascotAssistantResize::before{content:"";position:absolute;inset:6px;border-right:2px solid white;border-bottom:2px solid white}
    .mascotAssistantDialog{position:absolute;width:min(392px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:rgba(13,17,22,.98);border:1px solid var(--chat-line-strong);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.42);overflow:hidden;color:var(--chat-text);animation:mascotDialogIn .18s var(--ease)}
    .mascotAssistantDialog.right{left:calc(100% + 14px)}.mascotAssistantDialog.left{right:calc(100% + 14px)}.mascotAssistantDialog.top{top:0}.mascotAssistantDialog.bottom{bottom:0}
    .mascotAssistantDialog.agent{width:min(760px,calc(100vw - 32px));height:min(680px,calc(100vh - 32px));grid-template-rows:auto minmax(0,1fr);background:#fff}
    .mascotAssistantDialog header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-bottom:1px solid var(--chat-line);background:rgba(255,255,255,.025)}
    .mascotAssistantDialog header strong,.mascotAssistantDialog header span{display:block}
    .mascotAssistantDialog header strong{color:var(--chat-text)}
    .mascotAssistantDialog header span{color:var(--chat-muted);font-size:12px}
    .mascotAssistantDialog header a{color:var(--chat-accent);font-weight:800;text-decoration:none}
    .mascotAssistantDialog header button{width:34px;height:34px;padding:0;border-radius:50%;font-size:20px}
    .mascotAssistantAgentFrame{width:100%;height:100%;border:0;background:#fff}
    .mascotAssistantMessages{overflow:auto;padding:14px;display:grid;align-content:start;gap:10px}
    .mascotAssistantMessage{word-break:break-word}
    .mascotAssistantMessage.user{max-width:88%;padding:10px 12px;border-radius:14px 14px 4px 14px}
    .mascotAssistantMessage.assistant{padding-left:16px}
    .mascotAssistantMessage .chatMarkdown{font-size:14px;line-height:1.55}
    .mascotAssistantCode{margin:8px 0 0;padding:10px;border-radius:8px;background:#0d1117;color:#f8fafc;white-space:pre;overflow:auto}
    .mascotAssistantCode code{padding:0;background:transparent;color:inherit}.syntaxKeyword{color:#c4b5fd}.syntaxString{color:#f9cc73}.syntaxNumber{color:#f4ed36}.syntaxComment{color:#94a3b8;font-style:italic}
    .mascotAssistantEmpty,.mascotAssistantError{padding:12px;border-radius:8px;background:rgba(255,255,255,.05);color:var(--chat-muted)}
    .mascotAssistantError{background:rgba(225,144,121,.12);color:#e19079}
    .mascotAssistantForm{margin:12px}
    .mascotAssistantForm textarea{min-height:54px;font-size:14px}
    .mascotAssistantForm button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    @keyframes mascotDialogIn{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
    @keyframes mascotAssistantFrames{to{transform:translateX(calc(-100% + (100% / var(--mascot-frame-count,12))))}}
    @media (max-width:720px){.mascotAssistant{gap:8px;z-index:73}.mascotAssistantBubble{width:min(var(--mascot-size),76px);height:min(var(--mascot-size),76px)}.mascotAssistantResize{width:18px;height:18px}.mascotAssistantResize::before{inset:5px}.mascotAssistantDialog{position:fixed;left:12px;bottom:12px;width:calc(100vw - 24px);max-height:calc(100vh - 24px)}.mascotAssistantForm{grid-template-columns:1fr}}
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
