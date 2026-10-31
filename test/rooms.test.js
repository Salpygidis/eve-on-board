import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { io as ioc } from "socket.io-client";
import { RoomManager } from "../server/rooms.js";
import { attachSockets } from "../server/sockets.js";
import { starterFleet } from "../shared/rules.js";

function client(port) {
  return ioc(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true });
}

function ask(socket, event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function wait(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

describe("multiplayer rooms", () => {
  let httpServer;
  let io;
  let port;

  before(async () => {
    process.env.BOT_DELAY_MS = "40";
    const app = express();
    httpServer = http.createServer(app);
    io = new Server(httpServer);
    attachSockets(io, new RoomManager(io));
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    port = httpServer.address().port;
  });

  after(async () => {
    await new Promise((resolve) => io.close(() => httpServer.close(resolve)));
  });

  it("creates a room, seats a pilot and a spectator, and starts in the fleet phase", { timeout: 8000 }, async () => {
    const host = client(port);
    const pilot = client(port);
    const spec = client(port);
    await Promise.all([wait(host, "connect"), wait(pilot, "connect"), wait(spec, "connect")]);

    const created = await ask(host, "room:create", { name: "Rook" });
    assert.equal(created.isHost, true);

    const joined = await ask(pilot, "room:join", { name: "Vex", code: created.code });
    assert.equal(joined.isSpectator, false);

    const watching = await ask(spec, "room:join", { name: "Eye", code: created.code, spectator: true });
    assert.equal(watching.isSpectator, true);

    const started = wait(pilot, "state");
    const start = await ask(host, "room:start");
    assert.equal(start.ok, true);
    const snap = await started;
    assert.equal(snap.state.phase, "fleet");
    assert.equal(snap.state.hexes.length, 61);
    assert.ok(snap.state.players.some((p) => p.isSpectator));

    const fleet = wait(spec, "state");
    const locked = await ask(pilot, "game:fleet", { ships: starterFleet() });
    assert.equal(locked.ok, true);
    const view = await fleet;
    assert.equal(view.state.phase, "fleet");
    assert.equal(view.state.ships.length, 0);

    host.close();
    pilot.close();
    spec.close();
  });
});
