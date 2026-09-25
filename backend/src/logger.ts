export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
  time: string;
  level: LogLevel;
  module: string;
  message: string;
  stack?: string;
}

const RING_SIZE = 500;
const ring: LogEntry[] = [];
let minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) in LEVELS ? (process.env.LOG_LEVEL as LogLevel) : 'info';

export function setLogLevel(level: LogLevel): void {
  if (level in LEVELS) minLevel = level;
}

/** Recent log entries (newest last), kept in memory for the admin diagnostics page. */
export function recentLogs(): LogEntry[] {
  return ring.slice();
}

function write(level: LogLevel, module: string, message: string, err?: unknown): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const entry: LogEntry = { time: new Date().toISOString(), level, module, message };
  if (err instanceof Error) {
    entry.message = `${message}: ${err.message}`;
    if (level === 'error' && err.stack) entry.stack = err.stack;
  } else if (err !== undefined) {
    entry.message = `${message}: ${String(err)}`;
  }
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  const line = `${entry.time} [${level.toUpperCase()}] [${module}] ${entry.message}`;
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n' + (entry.stack ? entry.stack + '\n' : ''));
  } else {
    process.stdout.write(line + '\n');
  }
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string, err?: unknown): void;
  error(message: string, err?: unknown): void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (m) => write('debug', module, m),
    info: (m) => write('info', module, m),
    warn: (m, e) => write('warn', module, m, e),
    error: (m, e) => write('error', module, m, e),
  };
}
