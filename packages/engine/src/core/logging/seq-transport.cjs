"use strict";

const { Writable } = require("stream");

// Best-effort Seq transport. Wraps pino-seq's createStream so a Seq outage
// (ECONNREFUSED, fetch failed, slow DNS, …) never blocks startup or floods
// stderr. Three guarantees:
//
//   1. Constructor never throws — falls back to a silent /dev/null stream.
//   2. Per-write fetch errors are de-duplicated: first failure logs once
//      to stderr with a hint, subsequent failures are dropped silently.
//   3. The fallback stream still drains so pino's worker thread never blocks.
//
// Operators see a single warning when Seq is down; they don't see a flood
// of "TypeError: fetch failed" lines for every log entry.
function nullStream() {
  return new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
}

module.exports = async function seqTransport(options) {
  let inner;
  try {
    const { createStream } = await import("pino-seq");
    inner = createStream({
      serverUrl: options.serverUrl,
      apiKey: options.apiKey,
    });
  } catch (err) {
    process.stderr.write(
      `[seq-transport] Seq unreachable at ${options.serverUrl} ` +
        `(${err && err.message ? err.message : err}). ` +
        "Continuing without remote logs.\n",
    );
    return nullStream();
  }

  let warned = false;
  inner.on("error", (err) => {
    if (warned) return;
    warned = true;
    process.stderr.write(
      `[seq-transport] Seq stream error at ${options.serverUrl} ` +
        `(${err && err.message ? err.message : err}). ` +
        "Suppressing further Seq errors for this process.\n",
    );
  });

  return inner;
};
