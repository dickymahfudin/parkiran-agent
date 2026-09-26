import { useEffect } from "react";
import { sound } from "./audio/sound.ts";
import { Hud } from "./hud/Hud.tsx";
import { connect } from "./net/connection.ts";
import { requestNotificationPermission, startNotifier } from "./notify/notifier.ts";
import { Gallery } from "./scene/Gallery.tsx";
import { Scene } from "./scene/Scene.tsx";
import { useApp } from "./state/store.ts";

const gallery = import.meta.env.DEV && new URLSearchParams(location.search).has("gallery");

/** Browsers only allow audio (and permission prompts) after a user gesture: the first click unlocks both. */
function useFirstClick(): void {
  useEffect(() => {
    const unlock = () => {
      const st = useApp.getState();
      st.unlockAudio();
      sound.start();
      sound.setEnabled(st.audioEnabled);
      if (st.notificationsEnabled) void requestNotificationPermission();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  const audioEnabled = useApp((s) => s.audioEnabled);
  const audioUnlocked = useApp((s) => s.audioUnlocked);
  useEffect(() => sound.setEnabled(audioEnabled && audioUnlocked), [audioEnabled, audioUnlocked]);
}

export function App() {
  useEffect(() => (gallery ? undefined : connect()), []);
  useEffect(() => (gallery ? undefined : startNotifier()), []);
  useFirstClick();
  const compact = useApp((s) => s.compact);
  const cinematic = useApp((s) => s.cameraMode === "cinematic" && s.selectedId === null);
  if (gallery) {
    return (
      <div className="app">
        <Gallery />
      </div>
    );
  }
  return (
    <div className={`app${compact ? " compact" : ""}${cinematic ? " cinematic" : ""}`}>
      <Scene />
      <Hud />
    </div>
  );
}
