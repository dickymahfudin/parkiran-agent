import { useEffect } from "react";
import { AppErrorBoundary } from "./AppErrorBoundary.tsx";
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
  const ambienceEnabled = useApp((s) => s.ambienceEnabled);
  useEffect(() => sound.setEnabled(audioEnabled && audioUnlocked), [audioEnabled, audioUnlocked]);
  useEffect(() => sound.setAmbience(ambienceEnabled), [ambienceEnabled]);
  // Watching from another window: the street and the keyboards drop to a murmur, the chime and the "ting" do not.
  // Coming back also wakes a context the browser suspended meanwhile.
  useEffect(() => {
    const update = () => {
      const away = document.hidden || !document.hasFocus();
      sound.setDucked(away);
      if (!document.hidden) sound.resume();
    };
    update();
    for (const ev of ["visibilitychange", "focus", "blur"]) window.addEventListener(ev, update);
    return () => {
      for (const ev of ["visibilitychange", "focus", "blur"]) window.removeEventListener(ev, update);
    };
  }, []);
  // Some browsers only resume audio inside a user gesture: every click or key gets the chance (cheap while running).
  useEffect(() => {
    const wake = () => sound.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);
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
    <AppErrorBoundary>
      <div className={`app${compact ? " compact" : ""}${cinematic ? " cinematic" : ""}`}>
        <Scene />
        <Hud />
      </div>
    </AppErrorBoundary>
  );
}
