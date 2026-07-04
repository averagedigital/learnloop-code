export const MASCOT_STATES = [
  "idle",
  "laptop",
  "search",
  "thinking",
  "loading",
  "success",
  "error",
  "warning",
  "hint",
  "celebration",
  "reading",
  "coding",
  "testing",
  "memory",
  "reward",
  "sleep"
];

export const STATE_LABELS = {
  idle: "idle",
  laptop: "ноутбук",
  search: "лупа",
  thinking: "думает",
  loading: "загрузка",
  success: "успех",
  error: "ошибка",
  warning: "риск",
  hint: "подсказка",
  celebration: "праздник",
  reading: "читает",
  coding: "кодит",
  testing: "тесты",
  memory: "память",
  reward: "награда",
  sleep: "сон"
};

const animations = {
  idle: { speed: 16, bob: [0, 0, -1, 0], eyes: "open" },
  laptop: { speed: 12, bob: [0, -1, -1, 0], eyes: "focus", prop: "laptop" },
  search: { speed: 10, bob: [0, -1, 0, 1], eyes: "focus", prop: "magnifier" },
  thinking: { speed: 12, bob: [0, 0, -1, -1, 0, 1], eyes: "side", prop: "thought" },
  loading: { speed: 8, bob: [0, -1, -2, -1, 0, 1], eyes: "focus", prop: "spinner" },
  success: { speed: 9, bob: [0, -2, -4, -2, 0], eyes: "happy", prop: "check" },
  error: { speed: 9, bob: [0, 1, 0, 1], eyes: "flat", prop: "bug" },
  warning: { speed: 12, bob: [0, 0, -1, 0], eyes: "wide", prop: "warning" },
  hint: { speed: 11, bob: [0, -1, 0, -1, 0], eyes: "open", prop: "lamp" },
  celebration: { speed: 7, bob: [0, -3, -5, -2, 0, -1], eyes: "happy", prop: "confetti" },
  reading: { speed: 14, bob: [0, 0, -1, 0], eyes: "focus", prop: "book" },
  coding: { speed: 8, bob: [0, -1, -1, 0], eyes: "focus", prop: "terminal" },
  testing: { speed: 10, bob: [0, -1, 0, -1], eyes: "focus", prop: "clipboard" },
  memory: { speed: 13, bob: [0, 0, -1, 0], eyes: "open", prop: "cards" },
  reward: { speed: 8, bob: [0, -2, -3, -1, 0], eyes: "happy", prop: "medal" },
  sleep: { speed: 20, bob: [0, 0, 1, 0], eyes: "sleep", prop: "moon" }
};

export const MASCOT_REGISTRY = {
  hedgehog: {
    id: "hedgehog",
    label: "Ежик",
    role: "спокойный наставник и подсказки",
    kind: "hedgehog",
    palette: {
      outline: "#2a211b",
      dark: "#5b4634",
      mid: "#8a7256",
      light: "#d8bd91",
      face: "#f0d1aa",
      blush: "#ef8e98",
      accent: "#58c7a5"
    },
    animations
  },
  fox: {
    id: "fox",
    label: "Лисенок",
    role: "поиск, лупа и исследование",
    kind: "fox",
    palette: {
      outline: "#3a1d11",
      dark: "#8d3f1f",
      mid: "#e46f2e",
      light: "#ffb15d",
      face: "#fff0cf",
      blush: "#ff9a7e",
      accent: "#4aa3ff"
    },
    animations
  },
  owl: {
    id: "owl",
    label: "Совенок",
    role: "тесты, проверки и ошибки",
    kind: "owl",
    palette: {
      outline: "#1f2a59",
      dark: "#3349a3",
      mid: "#637df0",
      light: "#a7bcff",
      face: "#f3f0d2",
      blush: "#f5a0b5",
      accent: "#ffbf47"
    },
    animations
  },
  bunny: {
    id: "bunny",
    label: "Зайчонок",
    role: "память, прогресс и награды",
    kind: "bunny",
    palette: {
      outline: "#2f2d38",
      dark: "#8a8299",
      mid: "#d4ccdf",
      light: "#f1ecf7",
      face: "#fff8ef",
      blush: "#f49ab3",
      accent: "#ffcf4d"
    },
    animations
  }
};

export function getMascotConfig(id = "hedgehog") {
  return MASCOT_REGISTRY[id] || MASCOT_REGISTRY.hedgehog;
}

export function getMascotState(mascotId, stateId = "idle") {
  const mascot = getMascotConfig(mascotId);
  return mascot.animations[stateId] ? { id: stateId, ...mascot.animations[stateId] } : { id: "idle", ...mascot.animations.idle };
}

export function mountPixelMascot(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const unit = canvas.width / 64;
  let tick = 0;
  let raf = 0;

  function draw() {
    const mascot = getMascotConfig(canvas.dataset.mascotId);
    const state = getMascotState(mascot.id, canvas.dataset.mascotState);
    const bob = state.bob[Math.floor(tick / state.speed) % state.bob.length];
    const shake = state.id === "error" ? Math.floor(tick / 5) % 2 : 0;
    const y = 6 + bob;
    const x = 1 + shake;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    scene(ctx, unit, state.id);
    stateBackProp(ctx, unit, mascot.palette, state.prop, tick);
    shadow(ctx, unit, bob);
    if (mascot.kind === "hedgehog") hedgehog(ctx, unit, mascot.palette, x, y, state);
    if (mascot.kind === "fox") fox(ctx, unit, mascot.palette, x, y, state);
    if (mascot.kind === "owl") owl(ctx, unit, mascot.palette, x, y, state);
    if (mascot.kind === "bunny") bunny(ctx, unit, mascot.palette, x, y, state);
    stateFrontProp(ctx, unit, mascot.palette, state.prop, tick, y);

    tick += 1;
    raf = requestAnimationFrame(draw);
  }

  draw();
  return () => cancelAnimationFrame(raf);
}

function px(ctx, unit, color, x, y, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x * unit), Math.round(y * unit), Math.round(w * unit), Math.round(h * unit));
}

function scene(ctx, unit, stateId) {
  const bg = stateId === "sleep" ? "#edf1fb" : "#eef6f0";
  px(ctx, unit, bg, 0, 0, 64, 64);
  px(ctx, unit, "rgba(255,255,255,.55)", 6, 4, 52, 42);
  px(ctx, unit, "rgba(35,54,80,.06)", 0, 48, 64, 16);
}

function shadow(ctx, unit, bob) {
  const shrink = Math.max(0, -bob);
  px(ctx, unit, "rgba(22,28,36,.18)", 18 + shrink, 53, 28 - shrink * 2, 3);
  px(ctx, unit, "rgba(22,28,36,.08)", 14 + shrink, 55, 36 - shrink * 2, 2);
}

function hedgehog(ctx, unit, c, x, y, state) {
  const blink = state.eyes === "sleep";
  jaggedBack(ctx, unit, c.outline, x + 15, y + 5);
  jaggedBack(ctx, unit, c.dark, x + 17, y + 6);
  px(ctx, unit, c.mid, x + 13, y + 16, 38, 25);
  px(ctx, unit, c.outline, x + 12, y + 21, 4, 16);
  px(ctx, unit, c.outline, x + 48, y + 21, 4, 16);
  px(ctx, unit, c.dark, x + 15, y + 35, 34, 7);
  px(ctx, unit, c.light, x + 20, y + 14, 24, 5);
  px(ctx, unit, c.face, x + 19, y + 20, 27, 18);
  px(ctx, unit, c.face, x + 22, y + 17, 21, 5);
  outlineFace(ctx, unit, c, x + 18, y + 18);
  ear(ctx, unit, c, x + 13, y + 26);
  ear(ctx, unit, c, x + 49, y + 26);
  eyes(ctx, unit, c.outline, x + 25, y + 28, state.eyes, blink);
  mouth(ctx, unit, c.outline, x + 31, y + 35, state.eyes);
  cheeks(ctx, unit, c.blush, x + 20, y + 32);
  feet(ctx, unit, c, x + 19, y + 44);
  px(ctx, unit, "rgba(255,255,255,.35)", x + 25, y + 19, 13, 2);
}

function jaggedBack(ctx, unit, color, x, y) {
  px(ctx, unit, color, x + 6, y, 6, 5);
  px(ctx, unit, color, x + 2, y + 4, 9, 7);
  px(ctx, unit, color, x + 14, y - 3, 7, 9);
  px(ctx, unit, color, x + 22, y - 1, 6, 8);
  px(ctx, unit, color, x + 0, y + 10, 32, 22);
  px(ctx, unit, color, x - 2, y + 18, 36, 15);
}

function fox(ctx, unit, c, x, y, state) {
  tail(ctx, unit, c, x + 4, y + 28);
  triangleEar(ctx, unit, c, x + 18, y + 8, -1);
  triangleEar(ctx, unit, c, x + 41, y + 8, 1);
  px(ctx, unit, c.outline, x + 18, y + 15, 29, 28);
  px(ctx, unit, c.mid, x + 20, y + 14, 25, 27);
  px(ctx, unit, c.light, x + 25, y + 18, 15, 5);
  px(ctx, unit, c.face, x + 23, y + 25, 20, 13);
  px(ctx, unit, c.face, x + 28, y + 35, 10, 6);
  px(ctx, unit, c.dark, x + 17, y + 28, 4, 12);
  px(ctx, unit, c.dark, x + 44, y + 28, 4, 12);
  eyes(ctx, unit, c.outline, x + 27, y + 29, state.eyes);
  px(ctx, unit, c.outline, x + 32, y + 35, 2, 2);
  mouth(ctx, unit, c.outline, x + 31, y + 38, state.eyes);
  cheeks(ctx, unit, c.blush, x + 23, y + 34);
  feet(ctx, unit, c, x + 22, y + 44);
  px(ctx, unit, "rgba(255,255,255,.30)", x + 26, y + 18, 12, 2);
}

function tail(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y + 4, 12, 10);
  px(ctx, unit, c.dark, x + 1, y + 5, 12, 8);
  px(ctx, unit, c.mid, x + 3, y + 3, 11, 7);
  px(ctx, unit, c.face, x + 1, y + 10, 5, 4);
}

function triangleEar(ctx, unit, c, x, y, dir) {
  px(ctx, unit, c.outline, x, y + 7, 8, 8);
  px(ctx, unit, c.outline, x + dir * 2, y + 3, 6, 7);
  px(ctx, unit, c.mid, x + 1, y + 8, 6, 6);
  px(ctx, unit, c.face, x + 2, y + 9, 3, 3);
}

function owl(ctx, unit, c, x, y, state) {
  px(ctx, unit, c.outline, x + 18, y + 12, 28, 33);
  px(ctx, unit, c.dark, x + 17, y + 16, 30, 27);
  px(ctx, unit, c.mid, x + 20, y + 11, 24, 33);
  px(ctx, unit, c.light, x + 25, y + 15, 14, 21);
  px(ctx, unit, c.outline, x + 20, y + 9, 9, 7);
  px(ctx, unit, c.outline, x + 35, y + 9, 9, 7);
  px(ctx, unit, c.face, x + 22, y + 19, 9, 10);
  px(ctx, unit, c.face, x + 33, y + 19, 9, 10);
  eyes(ctx, unit, c.outline, x + 25, y + 23, state.eyes);
  px(ctx, unit, c.accent, x + 31, y + 30, 3, 3);
  px(ctx, unit, c.dark, x + 16, y + 28, 5, 12);
  px(ctx, unit, c.dark, x + 43, y + 28, 5, 12);
  featherRows(ctx, unit, c, x + 25, y + 35);
  feet(ctx, unit, c, x + 22, y + 45);
}

function featherRows(ctx, unit, c, x, y) {
  px(ctx, unit, c.dark, x, y, 3, 2);
  px(ctx, unit, c.dark, x + 6, y, 3, 2);
  px(ctx, unit, c.dark, x + 12, y, 3, 2);
  px(ctx, unit, c.light, x + 3, y + 4, 3, 2);
  px(ctx, unit, c.light, x + 9, y + 4, 3, 2);
}

function bunny(ctx, unit, c, x, y, state) {
  bunnyEar(ctx, unit, c, x + 21, y + 3, 0);
  bunnyEar(ctx, unit, c, x + 35, y + 2, 1);
  px(ctx, unit, c.outline, x + 17, y + 19, 30, 25);
  px(ctx, unit, c.mid, x + 19, y + 17, 26, 26);
  px(ctx, unit, c.light, x + 22, y + 19, 20, 19);
  px(ctx, unit, c.face, x + 24, y + 25, 16, 12);
  eyes(ctx, unit, c.outline, x + 27, y + 28, state.eyes);
  px(ctx, unit, c.outline, x + 32, y + 34, 2, 2);
  mouth(ctx, unit, c.outline, x + 31, y + 37, state.eyes);
  cheeks(ctx, unit, c.blush, x + 23, y + 33);
  px(ctx, unit, c.dark, x + 15, y + 31, 5, 10);
  px(ctx, unit, c.dark, x + 44, y + 31, 5, 10);
  feet(ctx, unit, c, x + 22, y + 45);
}

function bunnyEar(ctx, unit, c, x, y, tilt) {
  px(ctx, unit, c.outline, x + tilt, y, 7, 18);
  px(ctx, unit, c.mid, x + 1 + tilt, y + 2, 5, 15);
  px(ctx, unit, c.blush, x + 2 + tilt, y + 5, 3, 9);
}

function ear(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y, 6, 9);
  px(ctx, unit, c.mid, x + 1, y + 1, 4, 7);
  px(ctx, unit, c.light, x + 2, y + 3, 2, 3);
}

function outlineFace(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y + 6, 2, 14);
  px(ctx, unit, c.outline, x + 27, y + 6, 2, 14);
  px(ctx, unit, c.outline, x + 5, y + 1, 19, 2);
  px(ctx, unit, c.outline, x + 4, y + 20, 21, 2);
}

function eyes(ctx, unit, color, x, y, mode) {
  if (mode === "sleep") {
    px(ctx, unit, color, x, y + 2, 5, 1);
    px(ctx, unit, color, x + 11, y + 2, 5, 1);
    return;
  }
  if (mode === "happy") {
    px(ctx, unit, color, x, y + 1, 2, 1);
    px(ctx, unit, color, x + 2, y + 2, 2, 1);
    px(ctx, unit, color, x + 11, y + 2, 2, 1);
    px(ctx, unit, color, x + 13, y + 1, 2, 1);
    return;
  }
  if (mode === "flat") {
    px(ctx, unit, color, x, y + 2, 5, 1);
    px(ctx, unit, color, x + 11, y + 2, 5, 1);
    return;
  }
  if (mode === "wide") {
    px(ctx, unit, color, x - 1, y - 1, 5, 5);
    px(ctx, unit, color, x + 12, y - 1, 5, 5);
    return;
  }
  px(ctx, unit, color, x, y, 4, 5);
  px(ctx, unit, color, x + 12, y, 4, 5);
  if (mode === "side") {
    px(ctx, unit, "#ffffff", x + 2, y + 1, 1, 1);
    px(ctx, unit, "#ffffff", x + 14, y + 1, 1, 1);
  } else {
    px(ctx, unit, "#ffffff", x + 1, y + 1, 1, 1);
    px(ctx, unit, "#ffffff", x + 13, y + 1, 1, 1);
  }
}

function mouth(ctx, unit, color, x, y, mode) {
  if (mode === "flat" || mode === "focus") {
    px(ctx, unit, color, x, y, 6, 1);
    return;
  }
  if (mode === "happy") {
    px(ctx, unit, color, x, y, 1, 1);
    px(ctx, unit, color, x + 1, y + 1, 4, 1);
    px(ctx, unit, color, x + 5, y, 1, 1);
    return;
  }
  px(ctx, unit, color, x + 1, y, 4, 1);
}

function cheeks(ctx, unit, color, x, y) {
  px(ctx, unit, color, x, y, 4, 3);
  px(ctx, unit, color, x + 21, y, 4, 3);
}

function feet(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y, 9, 4);
  px(ctx, unit, c.outline, x + 17, y, 9, 4);
  px(ctx, unit, c.dark, x + 1, y - 1, 7, 4);
  px(ctx, unit, c.dark, x + 18, y - 1, 7, 4);
}

function stateBackProp(ctx, unit, c, prop, tick) {
  if (prop === "confetti") {
    px(ctx, unit, c.accent, 9, 9 + (tick % 8), 2, 2);
    px(ctx, unit, c.mid, 53, 7 + (tick % 10), 2, 2);
    px(ctx, unit, c.light, 48, 17 + (tick % 7), 2, 2);
  }
  if (prop === "moon") {
    px(ctx, unit, "#f6df84", 49, 8, 7, 7);
    px(ctx, unit, "#edf1fb", 52, 7, 6, 7);
    px(ctx, unit, "#8ca0d9", 43, 14, 2, 1);
    px(ctx, unit, "#8ca0d9", 51, 20, 2, 1);
  }
}

function stateFrontProp(ctx, unit, c, prop, tick, y) {
  if (prop === "laptop") laptop(ctx, unit, c, 19, 43);
  if (prop === "terminal") terminal(ctx, unit, c, 18, 42, tick);
  if (prop === "magnifier") magnifier(ctx, unit, c, 42, 32);
  if (prop === "thought") thought(ctx, unit, c, 44, 12, tick);
  if (prop === "spinner") spinner(ctx, unit, c, 47, 18, tick);
  if (prop === "check") badge(ctx, unit, c, 43, 13, "check");
  if (prop === "bug") bug(ctx, unit, c, 43, 15);
  if (prop === "warning") warning(ctx, unit, c, 44, 15);
  if (prop === "lamp") lamp(ctx, unit, c, 45, 14);
  if (prop === "book") book(ctx, unit, c, 18, 43);
  if (prop === "clipboard") clipboard(ctx, unit, c, 42, 15);
  if (prop === "cards") cards(ctx, unit, c, 42, 15);
  if (prop === "medal") medal(ctx, unit, c, 43, 14);
  if (prop === "confetti") {
    px(ctx, unit, c.accent, 15, y + 5, 2, 2);
    px(ctx, unit, c.mid, 50, y + 12, 2, 2);
  }
}

function laptop(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y, 27, 13);
  px(ctx, unit, "#dbeafe", x + 2, y + 2, 23, 8);
  px(ctx, unit, c.accent, x + 5, y + 5, 8, 2);
  px(ctx, unit, c.dark, x + 15, y + 5, 6, 2);
  px(ctx, unit, c.outline, x - 2, y + 13, 31, 3);
}

function terminal(ctx, unit, c, x, y, tick) {
  laptop(ctx, unit, c, x, y);
  px(ctx, unit, "#111827", x + 3, y + 3, 21, 7);
  px(ctx, unit, "#7dd3fc", x + 5, y + 5, 4, 1);
  px(ctx, unit, c.accent, x + 11, y + 5, 4 + (tick % 4), 1);
}

function magnifier(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y, 10, 10);
  px(ctx, unit, "#dbeafe", x + 2, y + 2, 6, 6);
  px(ctx, unit, c.outline, x + 8, y + 9, 7, 3);
  px(ctx, unit, c.accent, x + 3, y + 3, 2, 1);
}

function thought(ctx, unit, c, x, y, tick) {
  px(ctx, unit, "rgba(255,255,255,.86)", x, y + 8, 4, 4);
  px(ctx, unit, "rgba(255,255,255,.90)", x + 5, y + 4, 6 + (tick % 2), 6);
  px(ctx, unit, "rgba(255,255,255,.95)", x + 12, y, 9, 7);
  px(ctx, unit, c.outline, x + 15, y + 3, 2, 2);
}

function spinner(ctx, unit, c, x, y, tick) {
  const step = Math.floor(tick / 5) % 4;
  px(ctx, unit, c.outline, x + 4, y, 2, 2);
  px(ctx, unit, c.outline, x + 8, y + 4, 2, 2);
  px(ctx, unit, c.outline, x + 4, y + 8, 2, 2);
  px(ctx, unit, c.outline, x, y + 4, 2, 2);
  px(ctx, unit, c.accent, x + [4, 8, 4, 0][step], y + [0, 4, 8, 4][step], 2, 2);
}

function badge(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y, 13, 13);
  px(ctx, unit, "#d9f99d", x + 1, y + 1, 11, 11);
  px(ctx, unit, c.outline, x + 3, y + 6, 2, 2);
  px(ctx, unit, c.outline, x + 5, y + 8, 2, 2);
  px(ctx, unit, c.outline, x + 7, y + 5, 4, 2);
}

function bug(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x + 2, y + 2, 9, 8);
  px(ctx, unit, "#ef4444", x + 3, y + 3, 7, 6);
  px(ctx, unit, c.outline, x, y + 4, 3, 1);
  px(ctx, unit, c.outline, x + 10, y + 4, 3, 1);
  px(ctx, unit, c.outline, x + 5, y, 1, 3);
  px(ctx, unit, c.outline, x + 8, y, 1, 3);
}

function warning(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x + 5, y, 3, 3);
  px(ctx, unit, c.outline, x + 3, y + 3, 7, 4);
  px(ctx, unit, c.outline, x + 1, y + 7, 11, 4);
  px(ctx, unit, "#fde047", x + 4, y + 4, 5, 5);
  px(ctx, unit, c.outline, x + 6, y + 5, 1, 3);
}

function lamp(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x + 2, y, 9, 9);
  px(ctx, unit, "#fde68a", x + 3, y + 1, 7, 7);
  px(ctx, unit, c.outline, x + 5, y + 9, 5, 3);
  px(ctx, unit, c.accent, x + 1, y + 12, 11, 2);
}

function book(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y, 29, 13);
  px(ctx, unit, "#fff7ed", x + 2, y + 2, 11, 9);
  px(ctx, unit, "#e0f2fe", x + 16, y + 2, 11, 9);
  px(ctx, unit, c.dark, x + 14, y + 1, 1, 11);
}

function clipboard(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y, 13, 17);
  px(ctx, unit, "#f8fafc", x + 2, y + 2, 9, 13);
  px(ctx, unit, c.accent, x + 4, y, 5, 3);
  px(ctx, unit, c.outline, x + 4, y + 6, 5, 1);
  px(ctx, unit, c.outline, x + 4, y + 10, 5, 1);
}

function cards(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x, y + 3, 11, 13);
  px(ctx, unit, c.light, x + 1, y + 4, 9, 11);
  px(ctx, unit, c.outline, x + 5, y, 11, 13);
  px(ctx, unit, "#fef3c7", x + 6, y + 1, 9, 11);
  px(ctx, unit, c.accent, x + 8, y + 4, 5, 2);
}

function medal(ctx, unit, c, x, y) {
  px(ctx, unit, c.outline, x + 3, y, 8, 6);
  px(ctx, unit, c.dark, x + 4, y + 1, 2, 5);
  px(ctx, unit, c.accent, x + 8, y + 1, 2, 5);
  px(ctx, unit, c.outline, x + 2, y + 6, 10, 10);
  px(ctx, unit, "#facc15", x + 3, y + 7, 8, 8);
  px(ctx, unit, "#fff7ad", x + 5, y + 9, 4, 3);
}
