import { type Converted, Converted as ConvertedSchema } from '@ailab/schema';
import { OperationError } from '../operations/errors.ts';

/**
 * Turns a file into sections and passages (plan 011b). The science service does the work
 * (`POST /convert`); tests use a converter of their own.
 */
export interface Converter {
  convert(file: { name: string; mediaType: string; bytes: Uint8Array }): Promise<Converted>;
}

/** Calls the science service at SCIENCE_URL (default http://localhost:8001). */
export class ScienceConverter implements Converter {
  constructor(private readonly baseUrl: string) {}

  async convert(file: { name: string; mediaType: string; bytes: Uint8Array }) {
    let response: Response;
    try {
      response = await fetch(new URL('/convert', this.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          mediaType: file.mediaType,
          base64: Buffer.from(file.bytes).toString('base64'),
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new OperationError(
        'unavailable',
        `The science service at ${this.baseUrl} is not reachable; start it (see AGENTS.md) and parse again`,
      );
    }
    const body = (await response.json().catch(() => undefined)) as { detail?: unknown } | undefined;
    if (response.status === 415) {
      throw new OperationError(
        'invalid_input',
        String(body?.detail ?? 'No reader for this file type'),
      );
    }
    if (!response.ok) {
      throw new OperationError(
        'unavailable',
        `The science service could not convert ${file.name} (HTTP ${response.status})`,
      );
    }
    const parsed = ConvertedSchema.safeParse(body);
    if (!parsed.success) {
      throw new OperationError('internal', 'The science service returned an unexpected shape');
    }
    return parsed.data;
  }
}

export function converterFromEnv(env: NodeJS.ProcessEnv): Converter {
  return new ScienceConverter(env.SCIENCE_URL || 'http://localhost:8001');
}
