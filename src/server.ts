import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time?: string;
  category: "pessoal" | "trabalho" | "saude" | "estudo" | "outro";
  notes?: string;
  createdAt: string;
};

const port = Number(process.env.PORT ?? 3000);
const rootDir = resolve(__dirname, "..");
const publicDir = join(rootDir, "public");
const dataDir = join(rootDir, "data");
const eventsFile = join(dataDir, "events.json");

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

async function ensureStorage() {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(eventsFile, "utf8");
  } catch {
    await writeFile(eventsFile, "[]", "utf8");
  }
}

async function readEvents(): Promise<CalendarEvent[]> {
  await ensureStorage();
  const raw = await readFile(eventsFile, "utf8");
  return JSON.parse(raw) as CalendarEvent[];
}

async function writeEvents(events: CalendarEvent[]) {
  await ensureStorage();
  await writeFile(eventsFile, JSON.stringify(events, null, 2), "utf8");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response: ServerResponse, statusCode: number, message: string) {
  sendJson(response, statusCode, { error: message });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";

    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 1_000_000) {
        request.destroy();
        rejectBody(new Error("Payload muito grande."));
      }
    });

    request.on("end", () => resolveBody(body));
    request.on("error", rejectBody);
  });
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function parseEventPayload(payload: unknown): Omit<CalendarEvent, "id" | "createdAt"> | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const title = normalizeText(source.title, 80);
  const date = source.date;
  const time = source.time;
  const category = source.category;
  const notes = normalizeText(source.notes, 400);
  const allowedCategories = ["pessoal", "trabalho", "saude", "estudo", "outro"];

  if (!title || !isValidDate(date) || !allowedCategories.includes(String(category))) {
    return null;
  }

  return {
    title,
    date,
    category: category as CalendarEvent["category"],
    ...(isValidTime(time) ? { time } : {}),
    ...(notes ? { notes } : {})
  };
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (url.pathname === "/api/events" && request.method === "GET") {
    const events = await readEvents();
    const date = url.searchParams.get("date");
    const filtered = date ? events.filter((event) => event.date === date) : events;
    sendJson(response, 200, filtered.sort(sortEvents));
    return;
  }

  if (url.pathname === "/api/events" && request.method === "POST") {
    const rawBody = await readBody(request);
    const payload = parseEventPayload(JSON.parse(rawBody || "{}"));

    if (!payload) {
      sendError(response, 400, "Evento invalido. Informe titulo, data e categoria.");
      return;
    }

    const events = await readEvents();
    const event: CalendarEvent = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...payload
    };

    events.push(event);
    await writeEvents(events);
    sendJson(response, 201, event);
    return;
  }

  if (url.pathname.startsWith("/api/events/") && request.method === "DELETE") {
    const id = decodeURIComponent(url.pathname.replace("/api/events/", ""));
    const events = await readEvents();
    const nextEvents = events.filter((event) => event.id !== id);

    if (nextEvents.length === events.length) {
      sendError(response, 404, "Evento nao encontrado.");
      return;
    }

    await writeEvents(nextEvents);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendError(response, 404, "Rota da API nao encontrada.");
}

function sortEvents(a: CalendarEvent, b: CalendarEvent) {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) {
    return dateCompare;
  }

  return (a.time ?? "23:59").localeCompare(b.time ?? "23:59");
}

function serveStatic(request: IncomingMessage, response: ServerResponse, url: URL) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(publicDir, normalizedPath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Acesso negado");
    return;
  }

  const extension = extname(filePath);
  const stream = createReadStream(filePath);

  stream.on("open", () => {
    response.writeHead(200, {
      "Content-Type": contentTypes[extension] ?? "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600"
    });
    stream.pipe(response);
  });

  stream.on("error", () => {
    const fallback = createReadStream(join(publicDir, "index.html"));
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    fallback.pipe(response);
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    sendError(response, 500, "Erro interno do servidor.");
  }
});

server.listen(port, () => {
  console.log(`Agenda Online disponivel em http://localhost:${port}`);
});
