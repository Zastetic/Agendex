"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = require("node:http");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const port = Number(process.env.PORT ?? 3000);
const rootDir = (0, node_path_1.resolve)(__dirname, "..");
const publicDir = (0, node_path_1.join)(rootDir, "public");
const dataDir = (0, node_path_1.join)(rootDir, "data");
const eventsFile = (0, node_path_1.join)(dataDir, "events.json");
const contentTypes = {
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
    await (0, promises_1.mkdir)(dataDir, { recursive: true });
    try {
        await (0, promises_1.readFile)(eventsFile, "utf8");
    }
    catch {
        await (0, promises_1.writeFile)(eventsFile, "[]", "utf8");
    }
}
async function readEvents() {
    await ensureStorage();
    const raw = await (0, promises_1.readFile)(eventsFile, "utf8");
    return JSON.parse(raw);
}
async function writeEvents(events) {
    await ensureStorage();
    await (0, promises_1.writeFile)(eventsFile, JSON.stringify(events, null, 2), "utf8");
}
function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(payload));
}
function sendError(response, statusCode, message) {
    sendJson(response, statusCode, { error: message });
}
function readBody(request) {
    return new Promise((resolveBody, rejectBody) => {
        let body = "";
        request.on("data", (chunk) => {
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
function isValidDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function isValidTime(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function normalizeText(value, maxLength) {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim().slice(0, maxLength);
}
function parseEventPayload(payload) {
    if (!payload || typeof payload !== "object") {
        return null;
    }
    const source = payload;
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
        category: category,
        ...(isValidTime(time) ? { time } : {}),
        ...(notes ? { notes } : {})
    };
}
async function handleApi(request, response, url) {
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
        const event = {
            id: (0, node_crypto_1.randomUUID)(),
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
function sortEvents(a, b) {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) {
        return dateCompare;
    }
    return (a.time ?? "23:59").localeCompare(b.time ?? "23:59");
}
function serveStatic(request, response, url) {
    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const normalizedPath = (0, node_path_1.normalize)(requestedPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = (0, node_path_1.resolve)((0, node_path_1.join)(publicDir, normalizedPath));
    if (!filePath.startsWith(publicDir)) {
        response.writeHead(403);
        response.end("Acesso negado");
        return;
    }
    const extension = (0, node_path_1.extname)(filePath);
    const stream = (0, node_fs_1.createReadStream)(filePath);
    stream.on("open", () => {
        response.writeHead(200, {
            "Content-Type": contentTypes[extension] ?? "application/octet-stream",
            "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600"
        });
        stream.pipe(response);
    });
    stream.on("error", () => {
        const fallback = (0, node_fs_1.createReadStream)((0, node_path_1.join)(publicDir, "index.html"));
        response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store"
        });
        fallback.pipe(response);
    });
}
const server = (0, node_http_1.createServer)(async (request, response) => {
    try {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (url.pathname.startsWith("/api/")) {
            await handleApi(request, response, url);
            return;
        }
        serveStatic(request, response, url);
    }
    catch (error) {
        console.error(error);
        sendError(response, 500, "Erro interno do servidor.");
    }
});
server.listen(port, () => {
    console.log(`Agenda Online disponivel em http://localhost:${port}`);
});
