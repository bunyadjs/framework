export type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 100,
  info: 200,
  notice: 250,
  warning: 300,
  error: 400,
  critical: 500,
  alert: 550,
  emergency: 600,
};

export function levelWeight(level: LogLevel): number {
  return LEVEL_WEIGHT[level];
}

export function parseLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  if (!value) return fallback;
  const key = value.toLowerCase() as LogLevel;
  return key in LEVEL_WEIGHT ? key : fallback;
}

export function shouldLog(messageLevel: LogLevel, channelLevel: LogLevel): boolean {
  return levelWeight(messageLevel) >= levelWeight(channelLevel);
}
