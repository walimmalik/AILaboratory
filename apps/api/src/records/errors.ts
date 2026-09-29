export type RecordErrorCode =
  | 'not_found'
  | 'unknown_kind'
  | 'invalid_attributes'
  | 'invalid_state'
  | 'version_conflict'
  | 'invalid_link'
  | 'linked';

/** A refused record operation, with a message fit to show a person or an agent. */
export class RecordError extends Error {
  constructor(
    readonly code: RecordErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RecordError';
  }
}
