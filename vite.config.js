import { defineConfig } from "vite";

const serverPort = Number(process.env.PORT_SERVER || 3000);

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: true,
    port: Number(process.env.PORT_CLIENT || 5173),
    proxy: {
      "/socket.io": {
        target: `http://localhost:${serverPort}`,
        ws: true,
      },
      "/api": {
        target: `http://localhost:${serverPort}`,
      },
    },
  },
});
