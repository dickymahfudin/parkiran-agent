import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEFAULT_PORT, DEFAULT_WEB_PORT, parseEnvFile } from "../shared/src/env.ts";

const root = resolve(import.meta.dirname, "..");
let env: Record<string, string> = {};
try {
  env = parseEnvFile(readFileSync(resolve(root, ".env"), "utf8"));
} catch {
  // no .env yet: defaults
}
const serverPort = Number(process.env.PARKIRAN_PORT ?? env.PARKIRAN_PORT ?? DEFAULT_PORT);
const webPort = Number(process.env.PARKIRAN_WEB_PORT ?? env.PARKIRAN_WEB_PORT ?? DEFAULT_WEB_PORT);

export default defineConfig({
  plugins: [react()],
  // Bun's isolated installs can hand R3F its own React/three copy; one instance of each is required.
  resolve: { dedupe: ["react", "react-dom", "three", "@react-three/fiber", "zustand"] },
  // Pre-bundle everything in one pass; a second discovery pass would load a second React copy.
  optimizeDeps: {
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "three",
      "three/examples/jsm/loaders/HDRLoader.js",
      "three/examples/jsm/loaders/KTX2Loader.js",
      "three/examples/jsm/utils/SkeletonUtils.js",
      "three/examples/jsm/utils/BufferGeometryUtils.js",
      "@dgreenheck/ez-tree",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/postprocessing",
      "postprocessing",
      "zustand",
    ],
  },
  // The page always opens its WebSocket on its own origin (`/ws`): in production the server serves the page, in dev
  // Vite proxies `/ws` to the server. Nothing about the server port is baked into the build.
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    fs: { allow: [root] },
    proxy: { "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true, changeOrigin: true } },
  },
  preview: { host: "127.0.0.1", port: webPort, strictPort: true },
  // ez-tree (lazy-loaded, textures inlined) is a 4 MB chunk by itself.
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 4200 },
});
