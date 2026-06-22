export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

export function isValidISO8601(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
  return isoRegex.test(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

export function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidConfidence(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

export function assertDefined<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

export function assertNonEmptyString(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(`ValidationError: ${field} must be a non-empty string`);
  }
  return value;
}

export function assertInRange(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || value < min || value > max) {
    throw new Error(`ValidationError: ${field} must be between ${min} and ${max}`);
  }
  return value;
}
