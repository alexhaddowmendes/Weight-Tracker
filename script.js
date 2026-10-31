const STORAGE_KEY = "weight-entries";

const form = document.getElementById("entry-form");
const dateInput = document.getElementById("date");
const weightInput = document.getElementById("weight");
const list = document.getElementById("entries");

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function save(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function render(entries) {
  list.replaceChildren(
    ...entries.map(({ date, weight }) => {
      const li = document.createElement("li");
      li.textContent = `${date}: ${weight} kg`;
      return li;
    })
  );
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const entries = load();
  entries.push({ date: dateInput.value, weight: Number(weightInput.value) });
  entries.sort((a, b) => b.date.localeCompare(a.date));
  save(entries);
  render(entries);
  form.reset();
  dateInput.valueAsDate = new Date();
});

dateInput.valueAsDate = new Date();
render(load());
