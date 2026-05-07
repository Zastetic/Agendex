const state = {
  visibleDate: new Date(),
  selectedDate: toDateKey(new Date()),
  events: [],
  deferredInstallPrompt: null
};

const STORAGE_KEY = "agenda-online-events";

const calendarGrid = document.querySelector("#calendarGrid");
const calendarTitle = document.querySelector("#calendarTitle");
const selectedDayTitle = document.querySelector("#selectedDayTitle");
const eventCount = document.querySelector("#eventCount");
const eventList = document.querySelector("#eventList");
const eventForm = document.querySelector("#eventForm");
const eventDate = document.querySelector("#eventDate");
const formStatus = document.querySelector("#formStatus");
const todayLabel = document.querySelector("#todayLabel");
const installButton = document.querySelector("#installButton");

const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric"
});
const dayFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
});

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function eventsForDate(dateKey) {
  return state.events.filter((event) => event.date === dateKey);
}

function categoryLabel(category) {
  const labels = {
    pessoal: "Pessoal",
    trabalho: "Trabalho",
    saude: "Saude",
    estudo: "Estudo",
    outro: "Outro"
  };
  return labels[category] ?? "Outro";
}

function isNativeApp() {
  return location.protocol === "capacitor:" || location.protocol === "file:";
}

function sortEvents(a, b) {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) {
    return dateCompare;
  }

  return (a.time || "23:59").localeCompare(b.time || "23:59");
}

function readLocalEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).sort(sortEvents) : [];
  } catch {
    return [];
  }
}

function writeLocalEvents(events) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

function createLocalEvent(payload) {
  const events = readLocalEvents();
  const event = {
    id: crypto.randomUUID(),
    title: String(payload.title || "").trim(),
    date: payload.date,
    category: payload.category,
    createdAt: new Date().toISOString()
  };

  if (payload.time) {
    event.time = payload.time;
  }

  const notes = String(payload.notes || "").trim();
  if (notes) {
    event.notes = notes;
  }

  events.push(event);
  writeLocalEvents(events.sort(sortEvents));
  return event;
}

function deleteLocalEvent(id) {
  const events = readLocalEvents();
  writeLocalEvents(events.filter((event) => event.id !== id));
}

async function loadEvents() {
  if (isNativeApp()) {
    state.events = readLocalEvents();
    return;
  }

  try {
    const response = await fetch("/api/events");
    if (!response.ok) {
      throw new Error("Nao foi possivel carregar os eventos.");
    }

    state.events = (await response.json()).sort(sortEvents);
  } catch {
    state.events = readLocalEvents();
  }
}

function renderCalendar() {
  const year = state.visibleDate.getFullYear();
  const month = state.visibleDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  const todayKey = toDateKey(new Date());

  calendarTitle.textContent = capitalize(monthFormatter.format(state.visibleDate));
  calendarGrid.innerHTML = "";

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);

    const dateKey = toDateKey(date);
    const dayEvents = eventsForDate(dateKey);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-button";
    button.dataset.date = dateKey;
    button.setAttribute("aria-label", `${dayFormatter.format(date)} com ${dayEvents.length} eventos`);

    if (date.getMonth() !== month) {
      button.classList.add("outside");
    }

    if (dateKey === state.selectedDate) {
      button.classList.add("selected");
    }

    if (dateKey === todayKey) {
      button.classList.add("today");
    }

    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = String(date.getDate());

    const dots = document.createElement("span");
    dots.className = "day-dots";

    dayEvents.slice(0, 4).forEach((event) => {
      const dot = document.createElement("span");
      dot.className = `dot ${event.category}`;
      dots.appendChild(dot);
    });

    button.append(number, dots);
    button.addEventListener("click", () => selectDate(dateKey));
    calendarGrid.appendChild(button);
  }
}

function renderSelectedDay() {
  const selected = fromDateKey(state.selectedDate);
  const dayEvents = eventsForDate(state.selectedDate);

  selectedDayTitle.textContent = capitalize(dayFormatter.format(selected));
  eventCount.textContent = `${dayEvents.length} ${dayEvents.length === 1 ? "evento" : "eventos"}`;
  eventList.innerHTML = "";

  if (dayEvents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nenhum evento para este dia.";
    eventList.appendChild(empty);
    return;
  }

  dayEvents.forEach((event) => {
    const card = document.createElement("article");
    card.className = `event-card ${event.category}`;

    const header = document.createElement("div");
    header.className = "event-card-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = event.title;

    const meta = document.createElement("div");
    meta.className = "event-meta";
    meta.textContent = `${event.time || "Sem hora"} • ${categoryLabel(event.category)}`;

    titleWrap.append(title, meta);

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.title = "Excluir evento";
    deleteButton.setAttribute("aria-label", `Excluir ${event.title}`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => deleteEvent(event.id));

    header.append(titleWrap, deleteButton);
    card.appendChild(header);

    if (event.notes) {
      const notes = document.createElement("p");
      notes.textContent = event.notes;
      card.appendChild(notes);
    }

    eventList.appendChild(card);
  });
}

function renderNav() {
  const links = document.querySelectorAll("[data-section-link]");
  const hash = window.location.hash.replace("#", "") || "agenda";

  links.forEach((link) => {
    link.classList.toggle("active", link.dataset.sectionLink === hash);
  });
}

function render() {
  todayLabel.textContent = capitalize(dayFormatter.format(new Date()));
  eventDate.value = state.selectedDate;
  renderCalendar();
  renderSelectedDay();
  renderNav();
}

function selectDate(dateKey) {
  state.selectedDate = dateKey;
  state.visibleDate = fromDateKey(dateKey);
  render();
}

async function createEvent(formData) {
  const payload = Object.fromEntries(formData);

  if (isNativeApp()) {
    return createLocalEvent(payload);
  }

  const response = await fetch("/api/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error ?? "Nao foi possivel salvar.");
  }

  return response.json();
}

async function deleteEvent(id) {
  if (isNativeApp()) {
    deleteLocalEvent(id);
    await loadEvents();
    render();
    return;
  }

  const response = await fetch(`/api/events/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    formStatus.textContent = "Nao foi possivel excluir o evento.";
    return;
  }

  await loadEvents();
  render();
}

document.querySelector("#prevMonth").addEventListener("click", () => {
  state.visibleDate = new Date(state.visibleDate.getFullYear(), state.visibleDate.getMonth() - 1, 1);
  renderCalendar();
});

document.querySelector("#nextMonth").addEventListener("click", () => {
  state.visibleDate = new Date(state.visibleDate.getFullYear(), state.visibleDate.getMonth() + 1, 1);
  renderCalendar();
});

document.querySelector("#goToday").addEventListener("click", () => {
  selectDate(toDateKey(new Date()));
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.textContent = "Salvando...";

  try {
    const formData = new FormData(eventForm);
    const savedEvent = await createEvent(formData);
    state.selectedDate = savedEvent.date;
    state.visibleDate = fromDateKey(savedEvent.date);
    eventForm.reset();
    await loadEvents();
    render();
    formStatus.textContent = "Evento salvo.";
    window.location.hash = "#eventos";
  } catch (error) {
    formStatus.textContent = error.message;
  }
});

window.addEventListener("hashchange", renderNav);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  installButton.classList.remove("hidden");
});

installButton.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) {
    return;
  }

  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  installButton.classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js");
  });
}

loadEvents()
  .then(render)
  .catch(() => {
    eventList.innerHTML = '<div class="empty-state">Nao foi possivel carregar a agenda.</div>';
  });
