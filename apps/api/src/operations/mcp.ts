import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { RecordContext } from '../records/service.ts';
import { describeOperation } from './describe.ts';
import { toErrorBody } from './errors.ts';
import type { OperationRegistry } from './registry.ts';

const instructions = `AILaboratory: every capability is an operation.
Call describe_operations to see what exists (optionally filtered by namespace, e.g. "records"), then run_operation with its ID and input.
Volumes, concentrations and amounts come from the lab calculators (describe_operations with calculators: true), never from your own arithmetic.
Use preview: true to see what a change would do without making it.
Some changes by agents are proposed rather than applied: the result then has status "proposed" and a person approves or rejects it.
Errors come back as { code, message } with a message that says what to fix.`;

/** A stateless MCP server over the operation registry: two tools, the same path as REST. */
export function createMcpServer(registry: OperationRegistry, ctx: RecordContext): McpServer {
  const server = new McpServer({ name: 'ailaboratory', version: '0.1.0' }, { instructions });

  server.registerTool(
    'describe_operations',
    {
      title: 'Describe operations',
      description:
        'List the operations you can run, with their input and output JSON Schemas. Pass a namespace (e.g. "records") or IDs to narrow the list.',
      inputSchema: {
        namespace: z
          .string()
          .optional()
          .describe('Only operations whose ID starts with this, e.g. "records"'),
        ids: z.array(z.string()).optional().describe('Only these operation IDs, with full schemas'),
        calculators: z
          .boolean()
          .optional()
          .describe(
            'Only the lab calculators: volumes, concentrations and amounts to use instead of your own arithmetic',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ namespace, ids, calculators }) => {
      const contracts = registry
        .list()
        .filter((c) => !namespace || c.id.startsWith(`${namespace}.`))
        .filter((c) => !ids || ids.includes(c.id))
        .filter((c) => !calculators || c.calculator);
      const operations = contracts.map(describeOperation);
      return {
        content: [{ type: 'text', text: JSON.stringify({ operations }, null, 2) }],
        structuredContent: { operations },
      };
    },
  );

  server.registerTool(
    'run_operation',
    {
      title: 'Run an operation',
      description:
        'Run one operation by ID. Writes are all-or-nothing. With preview: true nothing is saved and you get what would have happened. Agents may get status "proposed": the change waits for a person.',
      inputSchema: {
        operation: z.string().describe('Operation ID, e.g. "records.create"'),
        input: z
          .record(z.string(), z.unknown())
          .default({})
          .describe("Input matching the operation's input schema"),
        preview: z
          .boolean()
          .optional()
          .describe('Dry run: roll back and return what would have happened'),
      },
    },
    async ({ operation, input, preview }) => {
      try {
        const result = await registry.execute(ctx, operation, input, { preview: preview ?? false });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        const body = toErrorBody(error);
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
        };
      }
    },
  );

  return server;
}

/** Handles one MCP request (Streamable HTTP; stateless because no session ID generator is set). */
export async function handleMcpRequest(
  registry: OperationRegistry,
  ctx: RecordContext,
  request: Request,
): Promise<Response> {
  const server = createMcpServer(registry, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
