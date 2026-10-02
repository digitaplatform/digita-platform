/**
 * The mode of the demo reset this engine runs, which every write to an app database waits out.
 * It lives apart from `reseedAppData`, so the document service reads it without importing the
 * seed loader, which imports the document service.
 */
let runningMode: string | undefined;

export function runningReseedMode(): string | undefined {
  return runningMode;
}

export function markReseedRunning(mode: string | undefined): void {
  runningMode = mode;
}

/** A write to a database the running reset wipes: it would survive the wipe, or take an id the seed then wants. */
export class ReseedWriteRefusedError extends Error {
  constructor(
    readonly doctype: string,
    readonly running: string,
  ) {
    super(`${doctype} cannot be saved while a reset in mode ${running} runs; save again once it has ended`);
    this.name = "ReseedWriteRefusedError";
  }
}
