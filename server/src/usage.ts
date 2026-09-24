import type { UsageSnapshot } from "../../shared/src/protocol.ts";

/** Plan-usage provider behind the parking meter. Must never touch credentials or the Keychain. */
export interface UsageSource {
  snapshot(): UsageSnapshot;
}

/**
 * The only documented source (status line `rate_limits`) is never invoked by Claude Desktop
 * (verified, docs/EXPERIMENTS.md #9), so the meter reports N/A.
 */
export class NoUsageSource implements UsageSource {
  snapshot(): UsageSnapshot {
    return { available: false, reason: "Claude Desktop exposes no plan usage to local tools" };
  }
}
