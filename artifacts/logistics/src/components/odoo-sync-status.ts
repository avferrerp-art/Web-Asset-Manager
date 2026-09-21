export interface SyncStatusInput {
  result?: string | null;
  completedAt?: string | null;
  stale?: boolean | null;
}

export interface SyncStatusVisibility {
  running: boolean;
  neverSynced: boolean;
  stale: boolean;
}

/**
 * Keeps presentation decisions independent from the browser clock. The API
 * owns the stale threshold and can flag even a first run with no completion.
 */
export function deriveSyncStatusVisibility({
  result,
  completedAt,
  stale,
}: SyncStatusInput): SyncStatusVisibility {
  const running = result === "running";
  return {
    running,
    neverSynced: !running && !completedAt,
    stale: stale === true,
  };
}