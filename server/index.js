import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { RoomManager } from "./rooms.js";
import { attachSockets } from "./sockets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const isProd = process.env.NODE_ENV === "production";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "source-skirmish", uptime: process.uptime() });
});

if (isProd) {
  app.use(express.static(DIST, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.type("html").send(
      `<p>SOURCE Skirmish server is running. Open the Vite app at <a href="http://localhost:5173">http://localhost:5173</a>.</p>`
    );
  });
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: isProd ? true : true,
    methods: ["GET", "POST"],
  },
  pingTimeout: 20000,
  pingInterval: 10000,
});

const rooms = new RoomManager(io);
attachSockets(io, rooms);

server.listen(PORT, HOST, () => {
  console.log(`SOURCE Skirmish listening on http://${HOST}:${PORT} (${isProd ? "prod" : "dev"})`);
});
