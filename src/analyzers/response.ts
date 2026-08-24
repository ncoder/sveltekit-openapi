import { Node, SyntaxKind } from 'ts-morph';
import type { ResponseInfo } from '../types.js';
import { schemaRefFromParseCall } from './schema-ref.js';

const STATUS_DESCRIPTIONS: Record<number, string> = {
  200: 'Success',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

/**
 * Extract response information from `return json(...)` calls.
 *
 * Detects:
 *   return json(data)                              → 200, generic object
 *   return json(data, { status: 201 })             → 201, generic object
 *   return json({ message: '...' }, { status: 404 }) → 404, error schema
 *   return json(ResponseSchema.parse(payload))     → $ref to Zod component (tier 2)
 */
export function analyzeResponses(body: Node): ResponseInfo[] {
  const responses: ResponseInfo[] = [];
  const seenCodes = new Set<number>();

  body.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    if (expr.getText() !== 'json') return;

    // Check this is in a return statement
    const parent = node.getParent();
    if (!parent || !Node.isReturnStatement(parent)) return;

    const args = node.getArguments();
    if (args.length === 0) return;

    // Extract status code from second argument
    let statusCode = 200;
    if (args.length >= 2) {
      const secondArg = args[1];
      if (Node.isObjectLiteralExpression(secondArg)) {
        const statusProp = secondArg.getProperty('status');
        if (statusProp && Node.isPropertyAssignment(statusProp)) {
          const init = statusProp.getInitializer();
          if (init && Node.isNumericLiteral(init)) {
            statusCode = parseInt(init.getText(), 10);
          }
        }
      }
    }

    if (seenCodes.has(statusCode)) return;
    seenCodes.add(statusCode);

    // Analyze first argument to determine response schema
    const firstArg = args[0];
    let schemaRef: string | undefined;
    let schema: Record<string, unknown> | undefined;

    if (Node.isCallExpression(firstArg)) {
      schemaRef = schemaRefFromParseCall(firstArg);
    }

    if (!schemaRef && Node.isObjectLiteralExpression(firstArg)) {
      const props = firstArg.getProperties();
      const propNames = props
        .filter((p): p is import('ts-morph').PropertyAssignment => Node.isPropertyAssignment(p))
        .map((p) => p.getName());

      if (propNames.includes('message') && propNames.length <= 2) {
        // Error response pattern: { message: 'string' }
        schema = {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        };
      } else if (propNames.length > 0) {
        // Object literal with known properties
        const properties: Record<string, unknown> = {};
        for (const name of propNames) {
          properties[name] = { type: 'string' };
        }
        schema = {
          type: 'object',
          properties,
        };
      }
    }

    if (!schemaRef && !schema) {
      schema = { type: 'object' };
    }

    responses.push({
      statusCode,
      description: STATUS_DESCRIPTIONS[statusCode] || `Status ${statusCode}`,
      schema,
      schemaRef,
    });
  });

  // Ensure at least a 200 response exists
  if (responses.length === 0) {
    responses.push({
      statusCode: 200,
      description: 'Success',
      schema: { type: 'object' },
    });
  }

  return responses;
}
