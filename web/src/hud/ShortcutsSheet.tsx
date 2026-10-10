import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/store.ts";
import { Icon } from "./icons.tsx";
import { SHORTCUTS, shortcutFor } from "./shortcuts.ts";

/**
 * The HUD's keyboard shortcuts: "," toggles the settings, "?" toggles this sheet (never while typing). The sheet is a
 * small dialog listing every shortcut; Esc closes it and focus goes back to where it was.
 */
export function ShortcutsSheet() {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const root = useRef<HTMLDivElement>(null);
  // Where the focus was when the sheet opened; it goes back there when the sheet closes by keyboard.
  const back = useRef<HTMLElement | null>(null);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    const to = back.current;
    back.current = null;
    if (restoreFocus && to?.isConnected) to.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const which = shortcutFor(e);
      if (!which) return;
      e.preventDefault();
      if (which === "help") {
        if (openRef.current) closeRef.current(true);
        else {
          back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setOpen(true);
        }
        return;
      }
      if (openRef.current) closeRef.current(false);
      const st = useApp.getState();
      const closing = st.settingsOpen;
      st.setSettingsOpen(!closing);
      // The settings dialog unmounts on close: focus inside it would fall to <body>, so it goes to the gear instead.
      if (closing && document.activeElement?.closest(".settings-panel")) document.querySelector<HTMLElement>(".settings-button")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("button")?.focus();
    // A click elsewhere closes it; the focus stays where that click put it.
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && closeRef.current(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={root}
      className="panel shortcuts-sheet"
      role="dialog"
      aria-labelledby="shortcuts-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Esc here closes the sheet only, not the selected session behind it.
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <header>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button type="button" className="icon-button" onClick={() => close(true)} aria-label="Close shortcuts" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>
      <dl>
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="shortcut">
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{s.does}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
