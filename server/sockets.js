export function attachSockets(io, rooms) {
  io.on("connection", (socket) => {
    socket.on("room:create", (payload = {}, cb) => {
      const { room, player } = rooms.create(socket, payload);
      ack(cb, joinedPayload(room, player));
      rooms.broadcast(room);
    });

    socket.on("room:join", (payload = {}, cb) => {
      const result = rooms.join(socket, payload);
      if (result.error) return ack(cb, { error: result.error });
      ack(cb, joinedPayload(result.room, result.player));
      rooms.broadcast(result.room);
    });

    socket.on("room:rejoin", (payload = {}, cb) => {
      const result = rooms.rejoin(socket, payload);
      if (result.error) return ack(cb, { error: result.error });
      ack(cb, joinedPayload(result.room, result.player));
      rooms.broadcast(result.room);
    });

    socket.on("room:start", (_payload, cb) => {
      try {
        const result = rooms.start(socket);
        if (result.error) return ack(cb, { error: result.error });
        ack(cb, { ok: true });
        rooms.broadcast(result.room);
      } catch (err) {
        console.error("room:start failed", err);
        ack(cb, { error: "Could not start the skirmish." });
      }
    });

    socket.on("room:bots", (payload = {}, cb) => {
      const result = rooms.setBots(socket, payload);
      if (result.error) return ack(cb, { error: result.error });
      ack(cb, { ok: true, count: result.room.lobby.filter((p) => p.isBot).length });
      rooms.broadcast(result.room);
    });

    socket.on("room:again", (_payload, cb) => {
      const result = rooms.again(socket);
      if (result.error) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
      rooms.broadcast(result.room);
    });

    socket.on("game:fleet", (payload = {}, cb) => {
      const { result, error } = rooms.act(socket, (game, id) => game.submitFleet(id, payload.ships));
      if (error) return ack(cb, { error });
      if (result && !result.ok) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
    });

    socket.on("game:orders", (payload = {}, cb) => {
      const { result, error } = rooms.act(socket, (game, id) => game.submitOrders(id, payload.orders));
      if (error) return ack(cb, { error });
      if (result && !result.ok) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
    });

    socket.on("game:attack", (payload = {}, cb) => {
      const { result, error } = rooms.act(socket, (game, id) => game.submitAttacks(id, payload.attacks));
      if (error) return ack(cb, { error });
      if (result && !result.ok) return ack(cb, { error: result.error });
      ack(cb, { ok: true });
    });

    socket.on("disconnect", () => {
      rooms.disconnect(socket);
    });
  });
}

function joinedPayload(room, player) {
  return {
    playerId: player.id,
    code: room.code,
    isHost: player.id === room.hostId,
    isSpectator: !!player.isSpectator,
    name: player.name,
  };
}

function ack(cb, payload) {
  if (typeof cb === "function") cb(payload);
}
