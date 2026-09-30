import type { OperationContract } from '@ailab/schema';
import { z } from 'zod';

export interface OperationDescription {
  id: string;
  summary: string;
  effect: OperationContract['effect'];
  calculator?: true;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

const jsonSchema = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;

/** An operation as agents and API clients see it: its contract with JSON Schemas. */
export function describeOperation(contract: OperationContract): OperationDescription {
  return {
    id: contract.id,
    summary: contract.summary,
    effect: contract.effect,
    ...(contract.calculator ? { calculator: true as const } : {}),
    input: jsonSchema(contract.input, 'input'),
    output: jsonSchema(contract.output, 'output'),
  };
}

/** OpenAPI 3.1 for the operation routes, generated from the same contracts. */
export function openApiDocument(contracts: OperationContract[]) {
  const paths: Record<string, unknown> = {};
  for (const contract of contracts) {
    const { input, output } = describeOperation(contract);
    paths[`/v1/ops/${contract.id}`] = {
      post: {
        operationId: contract.id,
        summary: contract.summary,
        tags: [contract.id.split('.')[0]],
        parameters: [
          {
            name: 'preview',
            in: 'query',
            required: false,
            description: 'Run the change and roll it back, returning what would have happened',
            schema: { type: 'boolean' },
          },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: input } } },
        responses: {
          '200': {
            description:
              '"done" with the output, "preview" with what would have happened, or "proposed" when an agent\'s change waits for a person',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    resultSchema('done', { output }),
                    resultSchema('preview', { output }),
                    resultSchema('proposed', {
                      proposal: { $ref: '#/components/schemas/Proposal' },
                    }),
                  ],
                },
              },
            },
          },
          default: {
            description: 'The call was refused',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OperationError' } },
            },
          },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'AILaboratory API', version: '0.1.0' },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Proposal: { type: 'object' },
        OperationError: {
          type: 'object',
          required: ['code', 'message'],
          properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
        },
      },
    },
    security: [{ bearer: [] }],
    paths,
  };
}

function resultSchema(status: string, properties: Record<string, unknown>) {
  return {
    type: 'object',
    required: ['status', ...Object.keys(properties)],
    properties: { status: { const: status }, ...properties },
  };
}
