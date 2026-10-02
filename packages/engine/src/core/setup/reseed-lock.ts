import { EngineError } from "../errors/engine-error.js";

/**
 * The demo reset of this engine and the writes around it. A reset is marked before it starts, so a
 * later write to a database it wipes is refused, and it wipes only once the writes that began
 * earlier have ended, so none of them lands after the wipe. It lives apart from
 * `reseedAppData`, so the document service reads it without importing the seed loader, which
 * imports the document service.
 */
let runningMode: string | undefined;
let writesUnderWay = 0;
let onWritesEnded: Array<() => void> = [];

export function runningReseedMode(): string | undefined {
  return runningMode;
}

export function markReseedRunning(mode: string | undefined): void {
  runningMode = mode;
}

/** Counts a write that begins while no reset runs; the answer ends it, once. */
export function beginWrite(): () => void {
  writesUnderWay++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    writesUnderWay--;
    if (writesUnderWay > 0) return;
    const waiting = onWritesEnded;
    onWritesEnded = [];
    for (const resume of waiting) resume();
  };
}

/** Resolves once no write counted by `beginWrite` is under way. */
export function writesEnded(): Promise<void> {
  return writesUnderWay === 0 ? Promise.resolve() : new Promise((resolve) => onWritesEnded.push(resolve));
}

/** A write to a database the running reset wipes: it would survive the wipe, or take an id the seed then wants. */
export class ReseedWriteRefusedError extends EngineError {
  constructor(
    readonly doctype: string,
    readonly running: string,
  ) {
    super("reseed_write_refused", { doctype, running }, 409, "RESEED_RUNNING");
  }
}
