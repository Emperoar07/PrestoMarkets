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
