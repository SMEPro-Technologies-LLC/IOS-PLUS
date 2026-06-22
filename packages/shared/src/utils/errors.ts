export class ComplianceError extends Error {
  readonly code: string;
  readonly dimension?: string;

  constructor(message: string, code: string, dimension?: string) {
    super(message);
    this.name = 'ComplianceError';
    this.code = code;
    this.dimension = dimension;
    Object.setPrototypeOf(this, ComplianceError.prototype);
  }
}

export class EvidenceError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'EvidenceError';
    this.code = code;
    Object.setPrototypeOf(this, EvidenceError.prototype);
  }
}

export class AuditError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AuditError';
    this.code = code;
    Object.setPrototypeOf(this, AuditError.prototype);
  }
}

export class UnauthorizedError extends Error {
  readonly code: string;

  constructor(message: string = 'Unauthorized', code: string = 'UNAUTHORIZED') {
    super(message);
    this.name = 'UnauthorizedError';
    this.code = code;
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ValidationError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
