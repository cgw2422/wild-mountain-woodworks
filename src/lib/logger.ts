/**
 * Minimal structured logger. Emits one JSON line per event in production
 * (Railway parses JSON logs and makes fields searchable) and readable lines
 * in development.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const isProd = process.env.NODE_ENV === "production";
const minLevel: Level = (process.env.LOG_LEVEL as Level) ?? (isProd ? "info" : "debug");
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return err;
}

function emit(level: Level, message: string, fields?: Fields) {
  if (order[level] < order[minLevel]) return;
  const data: Fields = { ...fields };
  if ("error" in data) data.error = serializeError(data.error);
  if (isProd) {
    const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...data });
    (level === "error" || level === "warn" ? console.error : console.log)(line);
  } else {
    const extra = Object.keys(data).length ? " " + JSON.stringify(data) : "";
    (level === "error" || level === "warn" ? console.error : console.log)(`[${level}] ${message}${extra}`);
  }
}

export const logger = {
  debug: (m: string, f?: Fields) => emit("debug", m, f),
  info: (m: string, f?: Fields) => emit("info", m, f),
  warn: (m: string, f?: Fields) => emit("warn", m, f),
  error: (m: string, f?: Fields) => emit("error", m, f),
};
