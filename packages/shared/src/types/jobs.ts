/**
 * digita-jobs contracts — the chunk protocol between the jobs orchestrator and
 * engine actions. The jobs service EXECUTES NOTHING itself: it repeatedly calls
 * an entity action through the engine's existing action API and reads this
 * shape from the response `data` until `done`. An action that returns anything
 * else (or nothing) is treated as a completed single-chunk job.
 */
export interface ActionChunkProgress {
  /**
   * Units processed so far (across all chunks — the action carries the tally).
   * Named `completed` (not `done`) on purpose: `ActionChunkResult.done` is the
   * boolean terminal flag, and an action author who returned a numeric `done`
   * here used to be silently treated as a finished single-shot run.
   */
  completed: number;
  /** Total units when known (drives a determinate progress bar). */
  total?: number;
  /** One-line human status ("342/812 records checked"). */
  message?: string;
}

export interface ActionChunkResult {
  /** False → the orchestrator calls again with `_cursor` = this result's cursor. */
  done: boolean;
  /** Opaque resume point (e.g. last processed _id). Required while `done` is false. */
  cursor?: string;
  progress?: ActionChunkProgress;
  /** Optional final payload, persisted on the run when `done` is true. */
  result?: unknown;
}

/** Params key under which the orchestrator passes the resume cursor. */
export const JOBS_CURSOR_PARAM = "_cursor";

/** Request headers of the engine's trusted-service path (see engine auth). */
export const ENGINE_SERVICE_HEADERS = {
  KEY: "x-engine-api-key",
  /**
   * Signed on-behalf delegation token (TOKEN_TYPE.DELEGATION). Presented
   * ALONGSIDE KEY, it lets the target service verify (via JWKS) that user X
   * genuinely delegated exactly the scoped operation. Service-agnostic — the
   * same header name is used against every target; the token's `scope.service`
   * names the target. This is the SOLE on-behalf proof: the legacy
   * self-asserted ON_BEHALF_* headers were deleted at the Phase-2 cutover.
   */
  DELEGATION: "x-delegation-token",
} as const;
