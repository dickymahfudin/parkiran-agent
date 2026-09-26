/**
 * Frame time shared by every animated object in the scene. In manual mode (dev screenshots) time only
 * advances by explicit `step()` calls, so a gesture can be captured at an exact moment.
 */
export const timeControl = {
  manual: false,
  pending: 0,
  /** Seconds to advance this frame; written once per frame by the scene clock. */
  frameDt: 0,
};

export function beginFrame(realDt: number): void {
  if (timeControl.manual) {
    timeControl.frameDt = timeControl.pending;
    timeControl.pending = 0;
  } else {
    timeControl.frameDt = realDt;
  }
}
