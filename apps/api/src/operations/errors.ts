import type { OperationErrorBody, OperationErrorCode } from '@ailab/schema';
import { RecordError } from '../records/errors.ts';

/** A refused operation call. The message is written for a person or an agent to act on. */
export class OperationError extends Error {
  constructor(
    readonly code: OperationErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'OperationError';
  }
}

export function toErrorBody(error: unknown): OperationErrorBody {
  if (error instanceof OperationError || error instanceof RecordError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return { code: 'internal', message: 'Something went wrong on the server' };
}

const statusByCode: Record<OperationErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  unknown_operation: 404,
  not_found: 404,
  invalid_input: 400,
  unknown_kind: 400,
  invalid_attributes: 400,
  invalid_link: 400,
  invalid_state: 409,
  version_conflict: 409,
  linked: 409,
  not_ready: 409,
  unavailable: 503,
  internal: 500,
};

export function httpStatus(code: OperationErrorCode): 400 | 401 | 403 | 404 | 409 | 500 | 503 {
  return statusByCode[code] as 400 | 401 | 403 | 404 | 409 | 500 | 503;
}
