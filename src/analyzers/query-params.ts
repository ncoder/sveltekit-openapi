import { Node } from 'ts-morph';
import type { ParamInfo } from '../types.js';
import type { SchemaExtractor, JsonSchema } from '../core/schema-extractor.js';

/**
 * Extract query parameters from handler bodies.
 *
 * Two patterns are detected:
 *
 * Tier 1 — inline `url.searchParams.get('name')` calls.
 *   All params are optional strings.
 *
 * Tier 2 — `Schema.parse(Object.fromEntries(url.searchParams))` calls.
 *   When a `schemaExtractor` is provided, the schema variable is resolved and
 *   its properties are emitted as typed query parameters.
 */
export function analyzeQueryParams(body: Node, schemaExtractor?: SchemaExtractor): ParamInfo[] {
  const params: ParamInfo[] = [];
  const seen = new Set<string>();

  // Tier 1: event.url.searchParams.get('name') calls
  body.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    // Match event.url.searchParams.get('name') or url.searchParams.get('name')
    if (!text.includes('searchParams.get')) return;

    const args = node.getArguments();
    if (args.length === 0) return;

    const firstArg = args[0];
    if (!Node.isStringLiteral(firstArg)) return;

    const name = firstArg.getLiteralValue();
    if (seen.has(name)) return;
    seen.add(name);

    params.push({
      name,
      in: 'query',
      required: false,
      type: 'string',
    });
  });

  // Tier 2: Schema.parse(Object.fromEntries(url.searchParams))
  // Only runs if no Tier 1 params were found and a schema extractor is available.
  if (schemaExtractor && params.length === 0) {
    body.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const exprText = node.getExpression().getText();
    if (!exprText.endsWith('.parse') && !exprText.endsWith('.safeParse')) return;

    const args = node.getArguments();
    if (args.length === 0) return;

    // Argument must contain Object.fromEntries(...searchParams...)
    const argText = args[0].getText();
    if (!argText.includes('fromEntries') || !argText.includes('searchParams')) return;

    const schemaVarName = exprText.replace(/\.(safe)?[Pp]arse$/, '');
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(schemaVarName)) return;

    const schema = schemaExtractor.getSchemaForVariable(schemaVarName);
    if (!schema?.properties) return;

    const requiredFields = new Set(schema.required ?? []);

    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (seen.has(propName)) continue;
      seen.add(propName);

      params.push({
        name: propName,
        in: 'query',
        required: requiredFields.has(propName),
        type: jsonSchemaTypeToParamType(propSchema),
        description: propSchema.description,
      });
    }
    });
  }

  return params;
}

function jsonSchemaTypeToParamType(schema: JsonSchema): string {
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}
