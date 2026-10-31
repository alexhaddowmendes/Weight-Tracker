const ME_KEY = "weight-me";

Chart.defaults.color = "#9aa1b2";
Chart.defaults.borderColor = "#2c313c";

const panelsEl = document.getElementById("panels");
const messageEl = document.getElementById("message");
const rangeButtons = document.querySelectorAll(".range button");

let entries = [];
let goals = [];
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
  return Array.isArray(data) ? { entries: data, goals: [] } : data;
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
        <p class="goal"></p>
        <div class="row">
          <input type="number" step="0.1" min="20" max="400" placeholder="Today's weight (kg)" required>
          <button type="submit">Save</button>
        </div>`;
      panel.addEventListener("submit", (event) => onSave(event, name));
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

  button.disabled = true;
  try {
    const result = await postEntry(person, kg);
    if (!result.ok) throw new Error(result.error);
    setMe(person);
    input.value = "";
    await refresh();
  } catch (error) {
    showMessage(`Couldn't save: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function renderStatus() {
  const today = todayString();
  for (const { name } of PEOPLE) {
    const entry = entries.find((e) => e.person === name && e.date === today);
    const status = panelsEl.querySelector(`[data-person="${name}"] .status`);
    status.textContent = entry ? `✅ Logged today: ${entry.kg} kg` : "⏳ Not logged yet today";
    status.classList.toggle("done", Boolean(entry));
    renderGoal(name);
  }
}

function renderGoal(name) {
  const goalEl = panelsEl.querySelector(`[data-person="${name}"] .goal`);
  const goal = goals.find((g) => g.person === name)?.kg;
  const latest = entries
    .filter((e) => e.person === name)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

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
    const line = {
      label: name,
      data: labels.map((date) => byDate.get(date) ?? null),
      borderColor: color,
      backgroundColor: color,
      spanGaps: true,
      tension: 0.2,
    };

    const goal = goals.find((g) => g.person === name)?.kg;
    if (goal === undefined) return [line];
    const goalLine = {
      label: `${name} goal`,
      data: labels.map(() => goal),
      borderColor: color,
      backgroundColor: color,
      borderDash: [6, 6],
      borderWidth: 1.5,
      pointRadius: 0,
    };
    return [line, goalLine];
  });

  const visibleKg = entries.filter((e) => e.date >= start).map((e) => e.kg);
  const yMax = Math.max(...visibleKg) + 10;
  const yMin = Math.max(0, Math.min(...visibleKg) - 30);

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.options.scales.y.min = yMin;
    chart.options.scales.y.max = yMax;
    chart.update();
    return;
  }

  chart = new Chart(document.getElementById("chart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      scales: { y: { min: yMin, max: yMax, title: { display: true, text: "kg" } } },
      interaction: { mode: "index", intersect: false },
    },
  });
}

async function refresh() {
  ({ entries, goals } = await fetchData());
  showMessage("");
  renderStatus();
  renderChart();
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
