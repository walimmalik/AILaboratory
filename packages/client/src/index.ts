import {
  type OperationContract,
  OperationErrorBody,
  type OperationResult,
  operationResult,
} from '@ailab/schema';
import type { z } from 'zod';

/** A refused call, with the server's code and a message written to act on. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: OperationErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }

  get code() {
    return this.body.code;
  }
}

export interface ClientOptions {
  /** Where the API is mounted, e.g. "/api" in the web app or "http://localhost:3001". */
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch;
}

export interface CallOptions {
  /** Run the change and roll it back, returning what would have happened. */
  preview?: boolean;
  signal?: AbortSignal;
}

/**
 * The typed client for the operation registry. The web app changes data only through `call`,
 * so the UI can do nothing that agents can't (AGENTS.md, product rule 2).
 */
export function createClient(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = (): Record<string, string> =>
    options.token ? { authorization: `Bearer ${options.token}` } : {};

  async function call<I extends z.ZodType, O extends z.ZodType>(
    contract: OperationContract<I, O>,
    input: z.input<I>,
    callOptions: CallOptions = {},
  ): Promise<OperationResult<z.output<O>>> {
    const query = callOptions.preview ? '?preview=true' : '';
    const response = await request(`${baseUrl}/v1/ops/${contract.id}${query}`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify(input),
      ...(callOptions.signal ? { signal: callOptions.signal } : {}),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw toApiError(response.status, body);
    return operationResult(contract.output).parse(body) as OperationResult<z.output<O>>;
  }

  /** Like `call`, but for reads and for callers that are never proposed (people): returns the output. */
  async function run<I extends z.ZodType, O extends z.ZodType>(
    contract: OperationContract<I, O>,
    input: z.input<I>,
    callOptions: CallOptions = {},
  ): Promise<z.output<O>> {
    const result = await call(contract, input, callOptions);
    if (result.status === 'proposed') {
      throw new Error(`${contract.id} was proposed for review instead of run`);
    }
    return result.output;
  }

  async function health(): Promise<boolean> {
    try {
      return (await request(`${baseUrl}/health`)).ok;
    } catch {
      return false;
    }
  }

  return { call, run, health };
}

export type Client = ReturnType<typeof createClient>;

function toApiError(status: number, body: unknown): ApiError {
  const parsed = OperationErrorBody.safeParse(body);
  return new ApiError(
    status,
    parsed.success ? parsed.data : { code: 'internal', message: `The API answered ${status}` },
  );
}
