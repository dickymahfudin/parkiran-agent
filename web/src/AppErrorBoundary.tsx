import { Component, type ReactNode } from "react";

/**
 * Last line of defence: an error that escapes the scene's asset boundaries (or the HUD) shows a message with a reload
 * button instead of React unmounting the whole page to white.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  override state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  override componentDidCatch(error: unknown): void {
    console.error("parkiran crashed", error);
  }
  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="crash" role="alert">
        <p className="crash-title">Parkiran Agent stopped</p>
        <p className="crash-detail">{this.state.message}</p>
        <button type="button" className="crash-reload" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
