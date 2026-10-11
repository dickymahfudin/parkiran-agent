import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS } from "../state/settings.ts";
import { useApp } from "../state/store.ts";
import { Icon } from "./icons.tsx";
import { CATEGORY_ICONS, CategoryContent } from "./settings/categories.tsx";
import { type CategoryId, categoriesFor, parseCategory, stepIndex, trapIndex } from "./settings/nav.ts";
import "./settings.css";

/** Same width as the sheet layout in settings.css. */
const PHONE_QUERY = "(max-width: 720px)";
const CATEGORY_KEY = "parkiran:settings-category";
const CATEGORIES = categoriesFor(import.meta.env.DEV);

function readCategory(): CategoryId {
  try {
    return parseCategory(sessionStorage.getItem(CATEGORY_KEY), CATEGORIES);
  } catch {
    // Storage blocked (private mode, sandboxed frame): start on the first category.
    return CATEGORIES[0]!.id;
  }
}

function saveCategory(id: CategoryId) {
  try {
    sessionStorage.setItem(CATEGORY_KEY, id);
  } catch {
    // Storage blocked: the choice is still remembered while this page stays open (component state).
  }
}

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const phoneNow = () => window.matchMedia(PHONE_QUERY).matches;
const usePhone = () => useSyncExternalStore(subscribePhone, phoneNow, () => false);

/** What Tab can reach in `root`, in order: enabled, visible, tabIndex ≥ 0, and of each radio group only the checked one. */
function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter((el) => {
    if (el.tabIndex < 0 || el.matches(":disabled") || el.getClientRects().length === 0) return false;
    if (el instanceof HTMLInputElement && el.type === "radio" && !el.checked) {
      const group = root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
      return ![...group].some((r) => r.checked);
    }
    return true;
  });
}

/** A key press in a text-like field is typing, never a shortcut (same rule as the HUD's shortcuts). */
const isTyping = (target: EventTarget): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement);

type PhoneView = "list" | "detail";

/**
 * Everything that is a preference rather than an action, in a modal dialog over the lot. Opened from the toolbar's
 * gear; Esc, the close button or a click on the dimmed backdrop close it and give the focus back to the gear.
 * Everything is saved in this browser at once. The chosen category (and, on a phone, whether it was open) survives
 * closing; the category also survives a reload of the tab.
 */
export function SettingsPanel() {
  const open = useApp((st) => st.settingsOpen);
  const [category, setCategory] = useState<CategoryId>(readCategory);
  const [phoneView, setPhoneView] = useState<PhoneView>("list");
  if (!open) return null;
  return (
    <SettingsDialog
      category={category}
      onCategory={(id) => {
        setCategory(id);
        saveCategory(id);
      }}
      phoneView={phoneView}
      onPhoneView={setPhoneView}
    />
  );
}

function SettingsDialog({
  category,
  onCategory,
  phoneView,
  onPhoneView,
}: {
  category: CategoryId;
  onCategory(id: CategoryId): void;
  phoneView: PhoneView;
  onPhoneView(view: PhoneView): void;
}) {
  const phone = usePhone();
  const uid = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const current = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0]!;
  const showNav = !phone || phoneView === "list";
  const showContent = !phone || phoneView === "detail";
  const titleId = `${uid}-title`;
  const tabId = (id: CategoryId) => `${uid}-tab-${id}`;
  const panelId = `${uid}-panel`;

  const close = () => useApp.getState().setSettingsOpen(false);
  const focusCategory = (id: CategoryId) => dialog.current?.querySelector<HTMLElement>(`[data-category="${id}"]`)?.focus();

  // Focus goes into the dialog on open, and again whenever the phone layout swaps the list and a category.
  useEffect(() => {
    const root = dialog.current;
    if (!root) return;
    const target =
      phone && phoneView === "detail"
        ? root.querySelector<HTMLElement>(".settings-back")
        : root.querySelector<HTMLElement>(`[data-category="${categoryRef.current}"]`);
    (target ?? tabbables(root)[0] ?? root).focus();
  }, [phone, phoneView]);

  // Modal keyboard: Esc closes, Tab and Shift+Tab wrap inside the dialog, focus that escapes is pulled back. On close
  // the focus returns to the toolbar's gear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = dialog.current;
      if (!root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        useApp.getState().setSettingsOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = tabbables(root);
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const to = trapIndex(list.indexOf(document.activeElement as HTMLElement), list.length, e.shiftKey);
      if (to !== null) {
        e.preventDefault();
        list[to]!.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const root = dialog.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) (tabbables(root)[0] ?? root).focus();
    };
    // Capture on window: runs before the page's own Esc handler (closing the session detail) and works even when the
    // focused element was just removed (focus on <body>).
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      document.querySelector<HTMLElement>(".settings-button")?.focus();
    };
  }, []);

  const onNavKey = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = stepIndex(e.key, index, CATEGORIES.length);
    if (to === null) return;
    e.preventDefault();
    const next = CATEGORIES[to]!.id;
    // Desktop: a tablist whose selection follows focus. Phone: a list; Enter or a tap opens the category.
    if (!phone) onCategory(next);
    focusCategory(next);
  };

  return (
    <div
      className="settings-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className="panel settings-dialog settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-layout={phone ? `phone-${phoneView}` : "desktop"}
        // The page underneath must not react to keys pressed here (R or Home would reset the camera, ? would open the
        // shortcut list behind the dialog). The "," shortcut (open or close the settings) is handled here instead.
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "," && !e.metaKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing && !isTyping(e.target)) {
            e.preventDefault();
            close();
          }
        }}
      >
        <header className="settings-head">
          {phone && phoneView === "detail" && (
            <button type="button" className="icon-button settings-back" onClick={() => onPhoneView("list")} aria-label="Back to all settings" title="Back">
              <ChevronLeft className="icon" strokeWidth={2.25} aria-hidden="true" focusable="false" />
            </button>
          )}
          <h2 id={titleId}>{phone && phoneView === "detail" ? current.label : "Settings"}</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Close settings" title="Close (Esc)">
            <Icon name="close" />
          </button>
        </header>

        {showNav &&
          (phone ? (
            <nav className="settings-nav" aria-label="Settings categories">
              {CATEGORIES.map((c, i) => {
                const Glyph = CATEGORY_ICONS[c.id];
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-category={c.id}
                    className={c.id === category ? "current" : undefined}
                    aria-current={c.id === category ? "true" : undefined}
                    onClick={() => {
                      onCategory(c.id);
                      onPhoneView("detail");
                    }}
                    onKeyDown={(e) => onNavKey(e, i)}
                  >
                    <Glyph className="icon" strokeWidth={2.25} aria-hidden="true" focusable="false" />
                    <span>{c.label}</span>
                    <ChevronRight className="icon settings-chevron" strokeWidth={2.25} aria-hidden="true" focusable="false" />
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings categories">
              {CATEGORIES.map((c, i) => {
                const Glyph = CATEGORY_ICONS[c.id];
                const selected = c.id === category;
                return (
                  <button
                    key={c.id}
                    id={tabId(c.id)}
                    type="button"
                    role="tab"
                    data-category={c.id}
                    aria-selected={selected}
                    aria-controls={panelId}
                    tabIndex={selected ? 0 : -1}
                    className={selected ? "current" : undefined}
                    onClick={() => onCategory(c.id)}
                    onKeyDown={(e) => onNavKey(e, i)}
                  >
                    <Glyph className="icon" strokeWidth={2.25} aria-hidden="true" focusable="false" />
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          ))}

        {showContent &&
          (phone ? (
            <div key={category} className="settings-content">
              <CategoryContent id={category} />
            </div>
          ) : (
            <div key={category} id={panelId} className="settings-content" role="tabpanel" aria-labelledby={tabId(category)}>
              <h3 className="settings-category-title">{current.label}</h3>
              <CategoryContent id={category} />
            </div>
          ))}

        <footer className="settings-foot">
          <span className="setting-hint">Saved in this browser</span>
          <button type="button" className="setting-reset" onClick={() => useApp.getState().updateSettings(DEFAULT_SETTINGS)}>
            Reset to defaults
          </button>
        </footer>
      </div>
    </div>
  );
}
