/**
 * Structured JSON logger for wallet and security operations.
 *
 * Each log entry includes:
 * - timestamp: ISO 8601 formatted timestamp
 * - level: one of 'debug' | 'info' | 'warn' | 'error'
 * - context: identifier for the source (e.g., 'circle-session', 'factory-validation')
 * - message: human-readable message
 * - data: optional object with additional context
 *
 * IMPORTANT: Do not log sensitive data (tokens, passwords, private keys, PII).
 * The logger does not sanitize input — it logs data as-is.
 *
 * @example
 * logger.warn('circle-session', 'Session refresh failed', {
 *   error: 'timeout',
 *   ageMs: 3100000,
 * });
 *
 * // Output: {"timestamp":"2026-05-27T...", "level":"warn", "context":"circle-session", ...}
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: Record<string, unknown>;
}

function log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
    ...(data && { data }),
  };

  const logStr = JSON.stringify(entry);
  const consoleMethod = level === 'error' ? console.error : console.log;
  consoleMethod(logStr);
}

export const logger = {
  debug: (context: string, message: string, data?: Record<string, unknown>) => log('debug', context, message, data),
  info: (context: string, message: string, data?: Record<string, unknown>) => log('info', context, message, data),
  warn: (context: string, message: string, data?: Record<string, unknown>) => log('warn', context, message, data),
  error: (context: string, message: string, data?: Record<string, unknown>) => log('error', context, message, data),
};
