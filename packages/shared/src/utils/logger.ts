export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
  service: string;
  traceId?: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
};

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  fatal(message: string, error?: Error, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(service: string): Logger {
  const write = (entry: LogEntry): void => {
    const output = JSON.stringify(entry);
    if (entry.level === 'error' || entry.level === 'fatal') {
      console.error(output);
    } else if (entry.level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  };

  const buildEntry = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): LogEntry => ({
    level,
    message,
    timestamp: new Date().toISOString(),
    service,
    context,
    ...(error && {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        // @ts-expect-error - code may exist on custom errors
        code: error.code,
      },
    }),
  });

  return {
    debug: (message, context) => write(buildEntry('debug', message, context)),
    info: (message, context) => write(buildEntry('info', message, context)),
    warn: (message, context) => write(buildEntry('warn', message, context)),
    error: (message, error, context) => write(buildEntry('error', message, context, error)),
    fatal: (message, error, context) => write(buildEntry('fatal', message, context, error)),
    child: (bindings) => createLogger(`${service}:${JSON.stringify(bindings)}`),
  };
}
