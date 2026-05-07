const state = {
  visibleDate: new Date(),
  selectedDate: toDateKey(new Date()),
  events: [],
  deferredInstallPrompt: null,
  lastDayClickDate: "",
  lastDayClickTime: 0,
  calendarTouchStart: null,
  drawerTouchStart: null
};

const STORAGE_KEY = "agenda-online-events";
const DOUBLE_TAP_DELAY = 420;
const SWIPE_THRESHOLD = 70;

const calendarSection = document.querySelector("#agenda");
const calendarGrid = document.querySelector("#calendarGrid");
const calendarTitle = document.querySelector("#calendarTitle");
const yearSelect = document.querySelector("#yearSelect");
const selectedDayTitle = document.querySelector("#selectedDayTitle");
const eventCount = document.querySelector("#eventCount");
const eventList = document.querySelector("#eventList");
const eventForm = document.querySelector("#eventForm");
const eventDate = document.querySelector("#eventDate");
const eventScreen = document.querySelector("#eventScreen");
const closeEventScreenButton = document.querySelector("#closeEventScreen");
const formStatus = document.querySelector("#formStatus");
const todayLabel = document.querySelector("#todayLabel");
const installButton = document.querySelector("#installButton");
const openMenuButton = document.querySelector("#openMenu");
const drawerBackdrop = document.querySelector("#drawerBackdrop");

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

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
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
  return Boolean(window.Capacitor?.isNativePlatform?.())
    || Boolean(window.Capacitor)
    || location.protocol === "capacitor:"
    || location.protocol === "file:";
}

function responseIsJson(response) {
  return response.headers.get("content-type")?.includes("application/json");
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
    if (!response.ok || !responseIsJson(response)) {
      throw new Error("Nao foi possivel carregar os eventos.");
    }

    state.events = (await response.json()).sort(sortEvents);
  } catch {
    state.events = readLocalEvents();
  }
}

function renderYearOptions() {
  const visibleYear = state.visibleDate.getFullYear();
  const startYear = visibleYear - 8;
  const endYear = visibleYear + 8;

  yearSelect.innerHTML = "";

  for (let year = startYear; year <= endYear; year += 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  }

  yearSelect.value = String(visibleYear);
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
    button.title = "Abrir agenda do dia";

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
    button.addEventListener("click", () => handleDayClick(dateKey));
    button.addEventListener("dblclick", () => openEventScreen(dateKey));
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

  links.forEach((link) => {
    link.classList.toggle("active", link.dataset.sectionLink === "agenda");
  });
}

function render() {
  todayLabel.textContent = capitalize(dayFormatter.format(new Date()));
  eventDate.value = state.selectedDate;
  renderYearOptions();
  renderCalendar();
  renderSelectedDay();
  renderNav();
}

function selectDate(dateKey) {
  state.selectedDate = dateKey;
  state.visibleDate = fromDateKey(dateKey);
  render();
}

function selectVisibleMonth(year, month) {
  const selected = fromDateKey(state.selectedDate);
  const day = Math.min(selected.getDate(), daysInMonth(year, month));
  selectDate(toDateKey(new Date(year, month, day)));
}

function changeVisibleMonth(delta) {
  const next = new Date(state.visibleDate.getFullYear(), state.visibleDate.getMonth() + delta, 1);
  selectVisibleMonth(next.getFullYear(), next.getMonth());
}

function handleDayClick(dateKey) {
  const now = Date.now();
  const isDoubleTap = state.lastDayClickDate === dateKey && now - state.lastDayClickTime < DOUBLE_TAP_DELAY;

  state.lastDayClickDate = dateKey;
  state.lastDayClickTime = now;
  selectDate(dateKey);

  if (isDoubleTap) {
    openEventScreen(dateKey);
  }
}

function openEventScreen(dateKey) {
  selectDate(dateKey);
  formStatus.textContent = "";
  eventScreen.classList.remove("hidden");
  document.body.classList.add("event-screen-open");
  closeEventScreenButton.focus();
}

function closeEventScreen() {
  eventScreen.classList.add("hidden");
  document.body.classList.remove("event-screen-open");
}

function openDrawer() {
  drawerBackdrop.classList.remove("hidden");
  document.body.classList.add("drawer-open");
}

function closeDrawer() {
  drawerBackdrop.classList.add("hidden");
  document.body.classList.remove("drawer-open");
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

  if (!response.ok || !responseIsJson(response)) {
    if (!responseIsJson(response)) {
      return createLocalEvent(payload);
    }

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

  if (!response.ok || !responseIsJson(response)) {
    if (!responseIsJson(response)) {
      deleteLocalEvent(id);
      await loadEvents();
      render();
      return;
    }

    formStatus.textContent = "Nao foi possivel excluir o evento.";
    return;
  }

  await loadEvents();
  render();
}

document.querySelector("#prevMonth").addEventListener("click", () => {
  changeVisibleMonth(-1);
});

document.querySelector("#nextMonth").addEventListener("click", () => {
  changeVisibleMonth(1);
});

document.querySelector("#goToday").addEventListener("click", () => {
  selectDate(toDateKey(new Date()));
});

yearSelect.addEventListener("change", () => {
  selectVisibleMonth(Number(yearSelect.value), state.visibleDate.getMonth());
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
  } catch (error) {
    formStatus.textContent = error.message;
  }
});

closeEventScreenButton.addEventListener("click", closeEventScreen);

openMenuButton.addEventListener("click", openDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", closeDrawer);
});

eventScreen.addEventListener("click", (event) => {
  if (event.target === eventScreen) {
    closeEventScreen();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !eventScreen.classList.contains("hidden")) {
    closeEventScreen();
  }

  if (event.key === "Escape" && document.body.classList.contains("drawer-open")) {
    closeDrawer();
  }
});

calendarSection.addEventListener("touchstart", (event) => {
  const touch = event.touches[0];
  state.calendarTouchStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

calendarSection.addEventListener("touchend", (event) => {
  if (!state.calendarTouchStart) {
    return;
  }

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - state.calendarTouchStart.x;
  const deltaY = touch.clientY - state.calendarTouchStart.y;
  state.calendarTouchStart = null;

  if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaY) < 55) {
    changeVisibleMonth(deltaX < 0 ? 1 : -1);
  }
}, { passive: true });

window.addEventListener("touchstart", (event) => {
  const touch = event.touches[0];
  const drawerIsOpen = document.body.classList.contains("drawer-open");

  if (touch.clientX < 28 || drawerIsOpen) {
    state.drawerTouchStart = { x: touch.clientX, y: touch.clientY, wasOpen: drawerIsOpen };
  }
}, { passive: true });

window.addEventListener("touchend", (event) => {
  if (!state.drawerTouchStart) {
    return;
  }

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - state.drawerTouchStart.x;
  const deltaY = touch.clientY - state.drawerTouchStart.y;
  const wasOpen = state.drawerTouchStart.wasOpen;
  state.drawerTouchStart = null;

  if (Math.abs(deltaY) > 70) {
    return;
  }

  if (!wasOpen && deltaX > SWIPE_THRESHOLD) {
    openDrawer();
  }

  if (wasOpen && deltaX < -SWIPE_THRESHOLD) {
    closeDrawer();
  }
}, { passive: true });

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
