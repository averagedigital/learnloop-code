const DAY_MS = 24 * 60 * 60 * 1000;
const mascotIds = new Set(["05_laptop_spiky", "organic_spiky_concept"]);
const mascotFrameCounts = { "05_laptop_spiky": 12, organic_spiky_concept: 24 };
const mascotStates = new Set(["idle", "inspect", "success", "thinking", "typing"]);

function dateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function activityTimestamps(app) {
  return [
    ...(app?.taskLogs || []).map((item) => item.updatedAt),
    ...(app?.assistantChats || []).flatMap((chat) => (chat.messages || []).map((message) => message.createdAt)),
    ...(app?.memoryEvents || []).map((item) => item.createdAt),
    ...(app?.quizAttempts || []).map((item) => item.createdAt)
  ].filter(Boolean);
}

export function buildActivityCalendar(app, requestedWeeks = 52, now = new Date()) {
  const weeksCount = Math.max(1, Math.min(52, Number(requestedWeeks) || 52));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(today.getTime() + (6 - today.getUTCDay()) * DAY_MS);
  const start = new Date(end.getTime() - (weeksCount * 7 - 1) * DAY_MS);
  const counts = new Map();

  for (const timestamp of activityTimestamps(app)) {
    const key = dateKey(timestamp);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }

  const weeks = Array.from({ length: weeksCount }, (_, weekIndex) => {
    return Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(start.getTime() + (weekIndex * 7 + dayIndex) * DAY_MS);
      const key = date.toISOString().slice(0, 10);
      const count = date > today ? 0 : counts.get(key) || 0;
      const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4;
      return { date: key, count, level, future: date > today };
    });
  });
  const visibleCells = weeks.flat().filter((cell) => !cell.future);

  return {
    weeks,
    total: visibleCells.reduce((sum, cell) => sum + cell.count, 0),
    activeDays: visibleCells.filter((cell) => cell.count > 0).length
  };
}

export function buildActivityEvents(app, requestedLimit = 8) {
  const limit = Math.max(1, Math.min(20, Number(requestedLimit) || 8));
  const quizEvents = (app?.quizAttempts || []).map((attempt) => ({
    id: attempt.id,
    type: "quiz",
    title: "Пройден тест",
    detail: attempt.topic || "Тест",
    value: `${attempt.correctCount}/${attempt.totalCount} баллов`,
    createdAt: attempt.createdAt
  }));
  const memoryEvents = (app?.memoryEvents || []).filter((event) => event.reviewStatus === "accepted").map((event) => ({
    id: event.id,
    type: "memory",
    title: "Память обновлена",
    detail: event.text,
    value: "Graph",
    createdAt: event.createdAt
  }));
  const taskEvents = (app?.taskLogs || []).map((event) => ({
    id: event.id,
    type: "task",
    title: "Событие задачи",
    detail: event.label || "Задача обновлена",
    value: event.status || "activity",
    createdAt: event.updatedAt
  }));
  return [...quizEvents, ...memoryEvents, ...taskEvents]
    .filter((event) => event.id && dateKey(event.createdAt))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, limit);
}

export function buildMemoryGraph(items, requestedEdges = 16) {
  const limit = Math.max(1, Math.min(24, Number(requestedEdges) || 16));
  const sourceEdges = (items || []).filter((item) => item?.subject && item?.object).slice(0, limit).map((item, index) => ({
    ...item,
    subject: String(item.subject).trim(),
    relation: String(item.relation || "связано с").trim(),
    object: String(item.object).trim(),
    index
  }));
  const degrees = new Map();
  for (const edge of sourceEdges) {
    degrees.set(edge.subject, (degrees.get(edge.subject) || 0) + 1);
    degrees.set(edge.object, (degrees.get(edge.object) || 0) + 1);
  }
  const ids = [...degrees].sort((left, right) => right[1] - left[1] || compareText(left[0], right[0])).map(([id]) => id);
  const nodeWidth = 180;
  const nodeHeight = 56;
  const padding = 48;
  const columnGap = 64;
  const rowGap = 56;
  const columns = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(ids.length * 1.45))));
  const rows = Math.max(1, Math.ceil(ids.length / columns));
  const gridWidth = columns * nodeWidth + (columns - 1) * columnGap;
  const gridHeight = rows * nodeHeight + (rows - 1) * rowGap;
  const width = Math.max(960, gridWidth + padding * 2);
  const nodeAreaHeight = Math.max(440, gridHeight + padding * 2);
  const height = Math.max(520, nodeAreaHeight + 52);
  const offsetX = (width - gridWidth) / 2;
  const nodes = ids.map((id, index) => ({
    id,
    x: offsetX + (index % columns) * (nodeWidth + columnGap),
    y: padding + Math.floor(index / columns) * (nodeHeight + rowGap),
    width: nodeWidth,
    height: nodeHeight,
    degree: degrees.get(id)
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const labelBoxes = [];
  const edges = sourceEdges.map((edge) => {
    const from = byId.get(edge.subject);
    const to = byId.get(edge.object);
    const start = rectangleBoundary(from, to);
    const end = rectangleBoundary(to, from);
    const relation = compactGraphText(edge.relation, 20);
    const labelWidth = Math.max(64, Math.min(168, relation.length * 7 + 22));
    const labelBox = placeEdgeLabel(start, end, labelWidth, nodes, labelBoxes, edge.index, nodeAreaHeight, width);
    labelBoxes.push(labelBox);
    const labelCenter = { x: labelBox.x + labelBox.width / 2, y: labelBox.y + labelBox.height / 2 };
    return {
      ...edge,
      from,
      to,
      start,
      end,
      relationLabel: relation,
      labelBox,
      control: {
        x: labelCenter.x * 2 - (start.x + end.x) / 2,
        y: labelCenter.y * 2 - (start.y + end.y) / 2
      }
    };
  });
  return { width, height, nodes, edges };
}

export function fitMemoryGraphView(graph) {
  return { x: 0, y: 0, width: graph.width, height: graph.height };
}

export function zoomMemoryGraphView(view, factor, graph, anchor = { x: 0.5, y: 0.5 }) {
  const scale = Number(factor) || 1;
  const width = Math.max(graph.width / 4, Math.min(graph.width, view.width / scale));
  const height = Math.max(graph.height / 4, Math.min(graph.height, view.height / scale));
  const x = view.x + view.width * anchor.x - width * anchor.x;
  const y = view.y + view.height * anchor.y - height * anchor.y;
  return clampMemoryGraphView({ x, y, width, height }, graph);
}

export function panMemoryGraphView(view, dx, dy, graph) {
  return clampMemoryGraphView({ ...view, x: view.x + dx, y: view.y + dy }, graph);
}

function clampMemoryGraphView(view, graph) {
  return {
    x: Math.max(0, Math.min(graph.width - view.width, view.x)),
    y: Math.max(0, Math.min(graph.height - view.height, view.y)),
    width: view.width,
    height: view.height
  };
}

function compactGraphText(value, limit) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function rectangleBoundary(from, to) {
  const center = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const target = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const scale = 1 / Math.max(Math.abs(dx) / (from.width / 2), Math.abs(dy) / (from.height / 2), 1);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function placeEdgeLabel(start, end, width, nodes, labels, index, nodeAreaHeight, graphWidth) {
  const height = 26;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const normal = { x: -dy / distance, y: dx / distance };
  const offsets = [0, 28, -28, 52, -52, 76, -76];
  const positions = [0.5, 0.35, 0.65, 0.2, 0.8];
  for (const position of positions) {
    for (const offset of offsets) {
      const box = {
        x: start.x + dx * position + normal.x * offset - width / 2,
        y: start.y + dy * position + normal.y * offset - height / 2,
        width,
        height
      };
      if (!nodes.some((node) => boxesOverlap(box, node, 4)) && !labels.some((label) => boxesOverlap(box, label, 3))) return box;
    }
  }
  return {
    x: 24 + ((index * 181) % Math.max(1, graphWidth - width - 48)),
    y: nodeAreaHeight + 12,
    width,
    height
  };
}

function boxesOverlap(left, right, gap) {
  return left.x - gap < right.x + right.width && left.x + left.width + gap > right.x && left.y - gap < right.y + right.height && left.y + left.height + gap > right.y;
}

export function profileAvatarSrc(mascotId) {
  const id = mascotIds.has(mascotId) ? mascotId : "05_laptop_spiky";
  return `/assets/mascots/${id}/states/idle.png`;
}

export function profileMascotFrameSrc(mascotId, state = "idle", frameIndex = 0) {
  const id = mascotIds.has(mascotId) ? mascotId : "05_laptop_spiky";
  const animation = mascotStates.has(state) ? state : "idle";
  const frame = ((Math.max(0, Number(frameIndex) || 0) % mascotFrameCounts[id]) + 1).toString().padStart(2, "0");
  return `/assets/mascots/${id}/frames/${animation}/frame_${frame}.png`;
}
