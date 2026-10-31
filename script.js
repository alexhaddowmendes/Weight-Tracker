const ME_KEY = "weight-me";

Chart.defaults.color = "#9aa1b2";
Chart.defaults.borderColor = "#2c313c";

const panelsEl = document.getElementById("panels");
const messageEl = document.getElementById("message");
const loadingEl = document.getElementById("chart-loading");
const rangeButtons = document.querySelectorAll(".range button");

let entries = [];
let goals = [];
let eating = [];
let rangeDays = 0;
let chart;

function todayString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function showMessage(text) {
  messageEl.textContent = text;
  messageEl.hidden = !text;
}

function getMe() {
  try {
    return localStorage.getItem(ME_KEY);
  } catch {
    return null;
  }
}

function setMe(name) {
  try {
    localStorage.setItem(ME_KEY, name);
  } catch {}
}

async function fetchData() {
  const response = await fetch(API_URL);
  const data = await response.json();
  // An older deployed script returns a bare list of entries with no goals.
  return Array.isArray(data) ? { entries: data, goals: [], eating: [] } : data;
}

async function postEntry(person, kg) {
  const response = await fetch(API_URL, {
    method: "POST",
    // text/plain avoids a CORS preflight, which Apps Script can't answer
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ date: todayString(), person, kg }),
  });
  return response.json();
}

async function postEating(person, rating) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ type: "eating", date: todayString(), person, rating }),
  });
  return response.json();
}

const RATINGS = [
  { value: "good", emoji: "😊", label: "Good" },
  { value: "ok", emoji: "😐", label: "OK" },
  { value: "bad", emoji: "😞", label: "Bad" },
];

function buildPanels() {
  panelsEl.replaceChildren(
    ...PEOPLE.map(({ name, color }) => {
      const panel = document.createElement("form");
      panel.className = "panel";
      panel.dataset.person = name;
      panel.style.setProperty("--accent", color);
      panel.innerHTML = `
        <h2>${name}</h2>
        <p class="status"></p>
        <p class="streak"></p>
        <p class="goal"></p>
        <div class="row">
          <input type="number" step="0.1" min="20" max="400" placeholder="Today's weight (kg)" required>
          <button type="submit">Save</button>
        </div>
        <div class="eating">
          <span class="eating-label">Eating today <small>(optional)</small></span>
          <div class="eating-buttons">
            ${RATINGS.map(
              (r) => `<button type="button" data-rating="${r.value}" aria-pressed="false">${r.emoji} ${r.label}</button>`
            ).join("")}
          </div>
        </div>`;
      panel.addEventListener("submit", (event) => onSave(event, name));
      panel.querySelectorAll(".eating-buttons button").forEach((b) =>
        b.addEventListener("click", () => onRate(name, b.dataset.rating))
      );
      return panel;
    })
  );

  const me = getMe();
  const myInput = panelsEl.querySelector(`[data-person="${me}"] input`);
  if (myInput) myInput.focus();
}

async function onSave(event, person) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.querySelector("input");
  const button = form.querySelector("button");
  const kg = Number(input.value);
  const goal = goals.find((g) => g.person === person)?.kg;
  // Confetti only fires the moment the goal is first reached, not on every save after.
  const reachesGoal = goal !== undefined && kg <= goal && !hasReachedGoal(person, goal);

  button.disabled = true;
  try {
    const result = await postEntry(person, kg);
    if (!result.ok) throw new Error(result.error);
    setMe(person);
    input.value = "";
    await refresh();
    celebrateSave(form);
    if (reachesGoal) launchConfetti();
  } catch (error) {
    showMessage(`Couldn't save: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function onRate(person, rating) {
  const today = todayString();
  const previous = eating.find((e) => e.person === person && e.date === today);
  if (previous?.rating === rating) return;

  // Update straight away; roll back if the save fails.
  setTodayRating(person, rating);
  renderEating(person);
  renderChart();
  try {
    const result = await postEating(person, rating);
    if (!result.ok) throw new Error(result.error);
    setMe(person);
    showMessage("");
  } catch (error) {
    setTodayRating(person, previous?.rating);
    renderEating(person);
    renderChart();
    showMessage(
      `Couldn't save eating day: ${error.message}. If this keeps happening, redeploy the Apps Script (see README).`
    );
  }
}

function setTodayRating(person, rating) {
  const today = todayString();
  eating = eating.filter((e) => !(e.person === person && e.date === today));
  if (rating) eating.push({ date: today, person, rating });
}

function renderEating(name) {
  const rating = eating.find((e) => e.person === name && e.date === todayString())?.rating;
  panelsEl.querySelectorAll(`[data-person="${name}"] .eating-buttons button`).forEach((b) => {
    const active = b.dataset.rating === rating;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
}

function renderStatus() {
  const today = todayString();
  for (const { name } of PEOPLE) {
    const entry = entries.find((e) => e.person === name && e.date === today);
    const status = panelsEl.querySelector(`[data-person="${name}"] .status`);
    status.textContent = entry ? `✅ Logged today: ${entry.kg} kg` : "⏳ Not logged yet today";
    status.classList.toggle("done", Boolean(entry));
    renderStreak(name);
    renderGoal(name);
    renderEating(name);
  }
}

function hasReachedGoal(name, goal) {
  const latest = latestEntry(name);
  return Boolean(latest) && latest.kg <= goal;
}

function latestEntry(name) {
  return entries
    .filter((e) => e.person === name)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function shiftDate(dateString, days) {
  const d = new Date(dateString + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv");
}

// Consecutive days logged. A streak stays alive until the end of today, so
// not having logged yet today doesn't reset it.
function computeStreak(name) {
  const dates = new Set(entries.filter((e) => e.person === name).map((e) => e.date));
  let day = todayString();
  if (!dates.has(day)) day = shiftDate(day, -1);
  let count = 0;
  while (dates.has(day)) {
    count++;
    day = shiftDate(day, -1);
  }
  return count;
}

function renderStreak(name) {
  const el = panelsEl.querySelector(`[data-person="${name}"] .streak`);
  const count = computeStreak(name);
  const loggedToday = entries.some((e) => e.person === name && e.date === todayString());
  el.textContent = count === 0
    ? ""
    : `🔥 ${count} day streak${loggedToday ? "" : " · log today to keep it going"}`;
  el.classList.toggle("hot", count >= 7);
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function celebrateSave(panel) {
  if (reducedMotion.matches) return;
  panel.classList.remove("saved");
  void panel.offsetWidth; // restart the animation if saved twice quickly
  panel.classList.add("saved");

  const burst = document.createElement("span");
  burst.className = "burst";
  burst.textContent = "✓ Logged!";
  panel.append(burst);
  burst.addEventListener("animationend", () => burst.remove());
  panel.addEventListener("animationend", function done(e) {
    if (e.target !== panel) return; // ignore child animations bubbling up
    panel.classList.remove("saved");
    panel.removeEventListener("animationend", done);
  });
}

function launchConfetti() {
  if (reducedMotion.matches) return;
  const canvas = document.getElementById("confetti");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.scale(dpr, dpr);

  const colors = [...PEOPLE.map((p) => p.color), "#fde68a", "#4ade80", "#ffffff"];
  const pieces = Array.from({ length: 160 }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
    const speed = 9 + Math.random() * 9;
    return {
      x: fromLeft ? 0 : window.innerWidth,
      y: window.innerHeight * 0.75,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });

  const start = performance.now();
  const duration = 3500;
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of pieces) {
      p.vy += 0.25;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (duration - t) / 800));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  })(start);
}

function renderGoal(name) {
  const goalEl = panelsEl.querySelector(`[data-person="${name}"] .goal`);
  const goal = goals.find((g) => g.person === name)?.kg;
  const latest = latestEntry(name);

  if (goal === undefined) {
    goalEl.textContent = "";
    return;
  }
  if (!latest) {
    goalEl.textContent = `Goal: ${goal} kg`;
    return;
  }

  const diff = Math.round((latest.kg - goal) * 10) / 10;
  if (diff > 0) goalEl.textContent = `Goal: ${goal} kg · ${diff} kg to lose`;
  else if (diff < 0) goalEl.textContent = `Goal: ${goal} kg · ${-diff} kg under goal`;
  else goalEl.textContent = `Goal: ${goal} kg · reached 🎉`;
}

function dayRange(from, to) {
  const days = [];
  const cursor = new Date(from + "T12:00:00");
  const end = new Date(to + "T12:00:00");
  while (cursor <= end) {
    days.push(cursor.toLocaleDateString("sv"));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// Draws a straight dashed horizontal line across the whole chart for each goal.
const goalLinePlugin = {
  id: "goalLines",
  afterDatasetsDraw(chart, args, options) {
    const { ctx, chartArea, scales } = chart;
    // Labels sit at the left edge, nudged apart so two close goals don't overlap.
    const placed = [];
    for (const { kg, color, label } of options.lines ?? []) {
      const y = scales.y.getPixelForValue(kg);
      if (y < chartArea.top || y > chartArea.bottom) continue;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      const clash = placed.some((p) => Math.abs(p - y) < 14);
      const labelY = clash ? y + 14 : y - 5;
      placed.push(labelY);
      ctx.fillText(label, chartArea.left + 6, labelY);
      ctx.restore();
    }
  },
};

// Chart.js draws emoji as points when given a canvas as the point style.
const emojiPointCache = {};
function emojiPoint(emoji) {
  if (!emojiPointCache[emoji]) {
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.font = `${size - 6}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, size / 2, size / 2 + 1);
    emojiPointCache[emoji] = canvas;
  }
  return emojiPointCache[emoji];
}

function renderChart() {
  if (entries.length === 0) {
    chart?.destroy();
    chart = null;
    return;
  }

  const today = todayString();
  const allDates = entries.map((e) => e.date).sort();
  let start = allDates[0];
  if (rangeDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeDays + 1);
    const cutoffString = cutoff.toLocaleDateString("sv");
    if (cutoffString > start) start = cutoffString;
  }
  const labels = dayRange(start, today);

  const datasets = PEOPLE.flatMap(({ name, color }) => {
    const byDate = new Map(entries.filter((e) => e.person === name).map((e) => [e.date, e.kg]));
    const ratingByDate = new Map(eating.filter((e) => e.person === name).map((e) => [e.date, e.rating]));
    // Good = 👍, bad = 👎; OK or unrated days stay a regular dot.
    const emojiFor = { good: "👍", bad: "👎" };
    const pointStyle = labels.map((date) => {
      const emoji = emojiFor[ratingByDate.get(date)];
      return emoji ? emojiPoint(emoji) : "circle";
    });
    const line = {
      label: name,
      data: labels.map((date) => byDate.get(date) ?? null),
      borderColor: color,
      backgroundColor: color,
      spanGaps: true,
      tension: 0.2,
      pointStyle,
      pointRadius: labels.map((_, i) => (pointStyle[i] === "circle" ? 3 : 12)),
      pointHoverRadius: labels.map((_, i) => (pointStyle[i] === "circle" ? 5 : 14)),
    };

    return [line];
  });

  // Goal lines are drawn by a plugin so they span the full width of the graph,
  // however few days of data there are.
  const goalLines = PEOPLE.flatMap(({ name, color }) => {
    const kg = goals.find((g) => g.person === name)?.kg;
    return kg === undefined ? [] : [{ kg, color, label: `${name} goal · ${kg} kg` }];
  });

  const visibleKg = entries.filter((e) => e.date >= start).map((e) => e.kg);
  const allKg = [...visibleKg, ...goalLines.map((g) => g.kg)];
  const yMax = Math.max(...allKg) + 10;
  const yMin = Math.max(0, Math.min(...allKg) - 30);

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.options.scales.y.min = yMin;
    chart.options.scales.y.max = yMax;
    chart.options.plugins.goalLines.lines = goalLines;
    chart.update();
    return;
  }

  chart = new Chart(document.getElementById("chart"), {
    type: "line",
    data: { labels, datasets },
    plugins: [goalLinePlugin],
    options: {
      plugins: { goalLines: { lines: goalLines } },
      scales: { y: { min: yMin, max: yMax, title: { display: true, text: "kg" } } },
      interaction: { mode: "index", intersect: false },
    },
  });
}

async function refresh() {
  loadingEl.hidden = false;
  try {
    ({ entries, goals, eating = [] } = await fetchData());
    showMessage("");
    renderStatus();
    renderChart();
  } finally {
    loadingEl.hidden = true;
  }
}

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    rangeDays = Number(button.dataset.days);
    rangeButtons.forEach((b) => b.classList.toggle("active", b === button));
    renderChart();
  });
});

buildPanels();
if (!API_URL) {
  showMessage("Not set up yet: add the Apps Script URL to config.js (see README).");
} else {
  refresh().catch(() => showMessage("Couldn't load data. Check your connection and refresh."));
}

// Lets the site be installed to the home screen (needs https or localhost).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
