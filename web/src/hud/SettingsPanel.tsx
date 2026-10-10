import { useEffect, useRef, type ReactNode } from "react";
import { requestNotificationPermission } from "../notify/notifier.ts";
import { isClockTime } from "../../../shared/src/sun.ts";
import { sound } from "../audio/sound.ts";
import {
  DEFAULT_SETTINGS,
  type CartMode,
  type ChimeRepeat,
  type FeedFilter,
  type HabitMix,
  type NameTags,
  type PowerMode,
  type SoundCue,
} from "../state/settings.ts";
import { useApp } from "../state/store.ts";
import { Icon } from "./icons.tsx";

const POWER_OPTIONS: readonly { value: PowerMode; label: string; hint: string }[] = [
  { value: "saver", label: "Saver", hint: "20 fps at most and always light rendering: longest battery (the default)." },
  { value: "balanced", label: "Balanced", hint: "60 fps while you move the view, 30 while you watch, 15 in the background." },
  { value: "smooth", label: "Smooth", hint: "60 fps nearly all the time and full quality: uses the most battery." },
];

const CART_OPTIONS: readonly { value: CartMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "evening", label: "Evenings" },
  { value: "allDay", label: "All day" },
];

const TAG_OPTIONS: readonly { value: NameTags; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "name", label: "Name" },
  { value: "full", label: "Full" },
];

const REPEAT_OPTIONS: readonly { value: ChimeRepeat; label: string }[] = [
  { value: "25s", label: "Every 25 s" },
  { value: "60s", label: "Every minute" },
  { value: "once", label: "Once" },
];

const HABIT_OPTIONS: readonly { value: HabitMix; label: string }[] = [
  { value: "mixed", label: "Mixed" },
  { value: "noSmoking", label: "Nobody" },
  { value: "vapeOnly", label: "Vapes only" },
];

const FEED_OPTIONS: readonly { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needsYou", label: "Needs you" },
];

const CUE_ROWS: readonly { cue: SoundCue; label: string; hint: string }[] = [
  { cue: "needsYou", label: "Needs you", hint: "The chime when a session waits for you" },
  { cue: "turnDone", label: "Turn done", hint: "A soft ting when a turn finishes" },
  { cue: "lighter", label: "Lighter", hint: "When someone gets a light" },
  { cue: "cart", label: "Food carts", hint: "The vendor's ting-ting or tek-tek" },
];

function Switch({
  label,
  hint,
  on,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  on: boolean;
  disabled?: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <div className={`setting-row${disabled ? " disabled" : ""}`}>
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <button type="button" role="switch" className="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}

/** Native radios (arrow keys move between them), drawn as a segmented control. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(v: T): void;
}) {
  const name = `setting-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <fieldset className="segmented setting-choice">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? "checked" : undefined}>
          <input type="radio" className="choice-input" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

/** A label and hint above a control that needs the panel's full width (choices, sliders, times). */
function Labeled({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">{label}</span>
          {hint && <span className="setting-hint">{hint}</span>}
        </div>
      </div>
      {children}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="setting-section" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Everything that is a preference rather than an action. Opened from the toolbar's gear; Esc, the close button or a
 * click outside close it and give the focus back to the gear. Everything is saved in this browser at once.
 */
export function SettingsPanel() {
  const open = useApp((st) => st.settingsOpen);
  const settings = useApp((st) => st.settings);
  const audioEnabled = useApp((st) => st.audioEnabled);
  const notificationsEnabled = useApp((st) => st.notificationsEnabled);
  const compact = useApp((st) => st.compact);
  const root = useRef<HTMLDivElement>(null);
  const st = useApp.getState();

  const close = () => {
    useApp.getState().setSettingsOpen(false);
    document.querySelector<HTMLElement>(".settings-button")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("button, [role='switch']")?.focus();
    const away = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!root.current?.contains(target) && !target?.closest(".settings-button")) useApp.getState().setSettingsOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  if (!open) return null;
  const notifySupported = typeof Notification !== "undefined";
  const notifyBlocked = notifySupported && Notification.permission === "denied";
  const power = POWER_OPTIONS.find((o) => o.value === settings.power) ?? POWER_OPTIONS[1]!;

  return (
    <div
      ref={root}
      className="panel settings-panel"
      role="dialog"
      aria-label="Settings"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header>
        <h2>Settings</h2>
        <button type="button" className="icon-button" onClick={close} aria-label="Close settings" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>

      <Section title="Sound">
        <Switch label="All sounds" hint="Also the speaker button in the toolbar" on={audioEnabled} onChange={(on) => st.setAudioEnabled(on)} />
        <Labeled label="Volume" hint={`${Math.round(settings.volume * 100)} %; let go to hear the chime`}>
          <input
            type="range"
            className="setting-range"
            aria-label="Volume"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.volume * 100)}
            disabled={!audioEnabled}
            aria-valuetext={`${Math.round(settings.volume * 100)} %`}
            onChange={(e) => st.updateSettings({ volume: Number(e.target.value) / 100 })}
            onPointerUp={() => sound.preview()}
            onKeyUp={(e) => {
              if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key.startsWith("Page")) sound.preview();
            }}
          />
        </Labeled>
        {CUE_ROWS.map((r) => (
          <Switch
            key={r.cue}
            label={r.label}
            hint={r.hint}
            on={settings.cues[r.cue]}
            disabled={!audioEnabled}
            onChange={(on) => st.updateSettings({ cues: { [r.cue]: on } })}
          />
        ))}
      </Section>

      <Section title="Notifications">
        <Switch
          label="System notifications"
          hint={
            !notifySupported
              ? "Not supported by this browser"
              : notifyBlocked
                ? "Blocked by the browser: allow notifications for this site in its settings"
                : "When a session needs you and this page is not in front"
          }
          on={notificationsEnabled && !notifyBlocked && notifySupported}
          disabled={notifyBlocked || !notifySupported}
          onChange={(on) => {
            st.setNotificationsEnabled(on);
            if (on) void requestNotificationPermission();
          }}
        />
        <Labeled label="Chime repeats" hint="While a session keeps waiting for you">
          <Choice label="Chime repeats" value={settings.chimeRepeat} options={REPEAT_OPTIONS} onChange={(chimeRepeat) => st.updateSettings({ chimeRepeat })} />
        </Labeled>
        <Switch
          label="Quiet hours"
          hint="No chime in this window; the banner and system notifications still come"
          on={settings.quietHours.on}
          onChange={(on) => st.updateSettings({ quietHours: { on } })}
        />
        {settings.quietHours.on && (
          <div className="setting-times">
            <label>
              From
              <input
                type="time"
                value={settings.quietHours.from}
                onChange={(e) => {
                  if (isClockTime(e.target.value)) st.updateSettings({ quietHours: { from: e.target.value } });
                }}
              />
            </label>
            <label>
              To
              <input
                type="time"
                value={settings.quietHours.to}
                onChange={(e) => {
                  if (isClockTime(e.target.value)) st.updateSettings({ quietHours: { to: e.target.value } });
                }}
              />
            </label>
          </div>
        )}
      </Section>

      <Section title="Display">
        <Switch label="Compact mode" hint="Smaller HUD and lower resolution, for a second monitor" on={compact} onChange={(on) => st.setCompact(on)} />
        <Labeled label="Name tags" hint="Over each head; need bubbles always show">
          <Choice label="Name tags" value={settings.nameTags} options={TAG_OPTIONS} onChange={(nameTags) => st.updateSettings({ nameTags })} />
        </Labeled>
        <Labeled label="Smoking" hint="What the people and Pak Joko smoke, e.g. nobody when others watch your screen">
          <Choice label="Smoking" value={settings.habits} options={HABIT_OPTIONS} onChange={(habits) => st.updateSettings({ habits })} />
        </Labeled>
        <Switch
          label="Start in cinematic"
          hint="The camera goes where things happen as soon as the page opens"
          on={settings.startCinematic}
          onChange={(on) => st.updateSettings({ startCinematic: on })}
        />
        <Labeled label="Event feed opens on" hint="The filter it shows when the page loads">
          <Choice label="Event feed opens on" value={settings.feedFilter} options={FEED_OPTIONS} onChange={(feedFilter) => st.updateSettings({ feedFilter })} />
        </Labeled>
      </Section>

      <Section title="Battery">
        <Choice label="Battery" value={settings.power} options={POWER_OPTIONS} onChange={(power) => st.updateSettings({ power })} />
        <p className="setting-hint setting-note">{power.hint}</p>
      </Section>

      <Section title="Street life">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Food carts</span>
            <span className="setting-hint">A vendor stops by the lot every 5 minutes</span>
          </div>
        </div>
        <Choice label="Food carts" value={settings.cart} options={CART_OPTIONS} onChange={(cart) => st.updateSettings({ cart })} />
        <Switch label="Traffic" hint="Cars and ojek passing on the street" on={settings.traffic} onChange={(on) => st.updateSettings({ traffic: on })} />
      </Section>

      <footer>
        <span className="setting-hint">Saved in this browser</span>
        <button type="button" className="setting-reset" onClick={() => st.updateSettings(DEFAULT_SETTINGS)}>
          Reset to defaults
        </button>
      </footer>
    </div>
  );
}
