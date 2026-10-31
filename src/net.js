import { io } from "socket.io-client";

const url = import.meta.env.VITE_SOCKET_URL || undefined;

export const socket = io(url, {
  transports: ["websocket", "polling"],
  autoConnect: true,
});

export function emit(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res || {}));
  });
}
