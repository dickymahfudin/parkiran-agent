import { BatteryMedium, Bell, Monitor, Store, Volume2, Wrench, type LucideIcon } from "lucide-react";
import { isClockTime } from "../../../../shared/src/sun.ts";
import { sound } from "../../audio/sound.ts";
import { requestNotificationPermission } from "../../notify/notifier.ts";
import type { CartMode, ChimeRepeat, FeedFilter, HabitMix, NameTags, PowerMode, SoundCue } from "../../state/settings.ts";
import { useApp } from "../../state/store.ts";
import { Choice, Labeled, Switch } from "./controls.tsx";
import type { CategoryId } from "./nav.ts";

export const CATEGORY_ICONS: Record<CategoryId, LucideIcon> = {
  sound: Volume2,
  notifications: Bell,
  display: Monitor,
  battery: BatteryMedium,
  street: Store,
  developer: Wrench,
};

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

function SoundSettings() {
  const settings = useApp((st) => st.settings);
  const audioEnabled = useApp((st) => st.audioEnabled);
  const st = useApp.getState();
  const percent = Math.round(settings.volume * 100);
  return (
    <>
      <Switch label="All sounds" hint="Also the speaker button in the toolbar" on={audioEnabled} onChange={(on) => st.setAudioEnabled(on)} />
      <Labeled label="Volume" hint={`${percent} %; let go to hear the chime`}>
        <input
          type="range"
          className="setting-range"
          aria-label="Volume"
          min={0}
          max={100}
          step={5}
          value={percent}
          disabled={!audioEnabled}
          aria-valuetext={`${percent} %`}
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
    </>
  );
}

function NotificationSettings() {
  const settings = useApp((st) => st.settings);
  const notificationsEnabled = useApp((st) => st.notificationsEnabled);
  const st = useApp.getState();
  const notifySupported = typeof Notification !== "undefined";
  const notifyBlocked = notifySupported && Notification.permission === "denied";
  return (
    <>
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
    </>
  );
}

function DisplaySettings() {
  const settings = useApp((st) => st.settings);
  const compact = useApp((st) => st.compact);
  const st = useApp.getState();
  return (
    <>
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
    </>
  );
}

function BatterySettings() {
  const powerMode = useApp((st) => st.settings.power);
  const st = useApp.getState();
  const power = POWER_OPTIONS.find((o) => o.value === powerMode) ?? POWER_OPTIONS[1]!;
  return (
    <>
      <Choice label="Battery" value={powerMode} options={POWER_OPTIONS} onChange={(power) => st.updateSettings({ power })} />
      <p className="setting-hint setting-note">{power.hint}</p>
    </>
  );
}

function StreetSettings() {
  const cart = useApp((st) => st.settings.cart);
  const traffic = useApp((st) => st.settings.traffic);
  const st = useApp.getState();
  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">Food carts</span>
          <span className="setting-hint">A vendor stops by the lot every 5 minutes</span>
        </div>
      </div>
      <Choice label="Food carts" value={cart} options={CART_OPTIONS} onChange={(cart) => st.updateSettings({ cart })} />
      <Switch label="Traffic" hint="Cars and ojek passing on the street" on={traffic} onChange={(on) => st.updateSettings({ traffic: on })} />
    </>
  );
}

/** Dev builds only: a free scene clock for checking the light at any hour (it used to sit in the toolbar). */
function DeveloperSettings() {
  const timeOverride = useApp((st) => st.timeOverride);
  const st = useApp.getState();
  return (
    <Labeled label="Scene time" hint={timeOverride ? `Fixed at ${timeOverride}; Live follows the clock again` : "Follows the clock; pick a time to fix it"}>
      <div className="setting-times">
        <label>
          Time
          <input
            type="time"
            value={timeOverride ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") st.setTimeOverride(null);
              else if (isClockTime(v)) st.setTimeOverride(v);
            }}
          />
        </label>
        <button type="button" className="setting-live" disabled={timeOverride === null} onClick={() => st.setTimeOverride(null)}>
          Live
        </button>
      </div>
    </Labeled>
  );
}

/** The controls of one category, the same ones (and texts) the old single-list panel had. */
export function CategoryContent({ id }: { id: CategoryId }) {
  switch (id) {
    case "sound":
      return <SoundSettings />;
    case "notifications":
      return <NotificationSettings />;
    case "display":
      return <DisplaySettings />;
    case "battery":
      return <BatterySettings />;
    case "street":
      return <StreetSettings />;
    case "developer":
      return <DeveloperSettings />;
  }
}
