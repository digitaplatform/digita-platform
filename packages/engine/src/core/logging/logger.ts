import pino, { type Logger as PinoLogger, type TransportTargetOptions } from "pino";
import { env } from "../config/env.js";

// Build redaction paths from environment config
const redactPaths = env.LOG_REDACT_FIELDS.flatMap((field) => [
  `*.${field}`,
  `req.headers.${field}`,
  `req.body.${field}`,
  `res.body.${field}`,
  `body.${field}`,
]);

// Build transport targets
function buildTransport(): pino.TransportMultiOptions | pino.TransportSingleOptions | undefined {
  const targets: TransportTargetOptions[] = [];

  if (env.LOG_PRETTY) {
    targets.push({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
      },
      level: env.LOG_LEVEL,
    });
  } else {
    targets.push({
      target: "pino/file",
      options: { destination: 1 }, // stdout
      level: env.LOG_LEVEL,
    });
  }

  if (env.LOG_TO_FILE) {
    targets.push({
      target: "pino/file",
      options: {
        destination: `${env.LOG_FILE_PATH}/app.log`,
        mkdir: true,
      },
      level: env.LOG_LEVEL,
    });
  }

  if (targets.length === 1) {
    return targets[0];
  }
  return { targets };
}

// Root logger — created once at startup
const rootLogger: PinoLogger = pino({
  level: env.LOG_LEVEL,
  transport: buildTransport(),
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  base: {
    service: env.SERVICE_NAME,
    version: env.APP_VERSION,
    env: env.NODE_ENV,
  },
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger for a specific module.
 * Each module gets its own logger with the module name attached.
 * Zero overhead — shares the parent's stream.
 */
export function createLogger(module: string): PinoLogger {
  return rootLogger.child({ module });
}

/**
 * Get the root logger (for startup/shutdown messages).
 */
export function getRootLogger(): PinoLogger {
  return rootLogger;
}

export type { PinoLogger as Logger };
