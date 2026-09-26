import "@fontsource-variable/plus-jakarta-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

// Signs, posters and plates are drawn into canvases once; wait for the bundled font so they use it.
const FONT_WAIT_MS = 1500;
const fontsReady = Promise.all(["600", "700", "800", "900"].map((w) => document.fonts.load(`${w} 32px "Plus Jakarta Sans Variable"`)));
const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), FONT_WAIT_MS));
void Promise.race([fontsReady, timeout])
  .catch((err: unknown) => console.warn("font load failed, using the system font", err))
  .finally(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
