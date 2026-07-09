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
    ...(app?.memoryEvents || []).map((item) => item.createdAt)
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
