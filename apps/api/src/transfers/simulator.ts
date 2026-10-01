import {
  type FlexProtocolRequest,
  type FlexProtocolResult,
  FlexProtocolResult as ResultSchema,
} from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';

/**
 * Writes Opentrons Flex protocols and checks them in Opentrons' simulator (plan 016b-3). The
 * science service does both (`POST /opentrons/protocol`) from data only; tests use their own.
 */
export interface ProtocolWriter {
  flex(request: FlexProtocolRequest): Promise<FlexProtocolResult>;
}

/** Calls the science service at SCIENCE_URL (default http://localhost:8001). */
export class ScienceProtocolWriter implements ProtocolWriter {
  constructor(private readonly baseUrl: string) {}

  async flex(request: FlexProtocolRequest) {
    let response: Response;
    try {
      response = await fetch(new URL('/opentrons/protocol', this.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(330_000),
      });
    } catch {
      throw new OperationError(
        'unavailable',
        `The science service at ${this.baseUrl} is not reachable; start it (see AGENTS.md) and export again`,
      );
    }
    if (!response.ok) {
      throw new OperationError(
        'unavailable',
        `The science service could not write the Opentrons protocol (HTTP ${response.status})`,
      );
    }
    const parsed = ResultSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new OperationError('internal', 'The science service returned an unexpected shape');
    }
    return parsed.data;
  }
}

export const noProtocolWriter: ProtocolWriter = {
  flex: async () => {
    throw new OperationError(
      'unavailable',
      'No science service is set up to write and simulate Opentrons protocols',
    );
  },
};

export function protocolWriterFromEnv(env: NodeJS.ProcessEnv): ProtocolWriter {
  return new ScienceProtocolWriter(env.SCIENCE_URL || 'http://localhost:8001');
}
