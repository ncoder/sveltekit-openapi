import { Node } from 'ts-morph';

/**
 * Extract a Zod schema variable name from `SchemaName.parse(...)` / `.safeParse(...)`.
 */
export function schemaRefFromParseCall(node: Node): string | undefined {
  if (!Node.isCallExpression(node)) return undefined;

  const exprText = node.getExpression().getText();
  if (!exprText.endsWith('.parse') && !exprText.endsWith('.safeParse')) return undefined;

  const schemaName = exprText.replace(/\.(safe)?[Pp]arse$/, '');
  const baseName = schemaName.includes('.') ? schemaName.split('.').pop()! : schemaName;

  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(baseName)) {
    return baseName;
  }

  return undefined;
}

/**
 * True when a `.parse()` / `.safeParse()` call validates `request.json()` input.
 */
export function isRequestJsonParseCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;

  const parseArg = node.getArguments()[0];
  return Boolean(parseArg && parseArg.getText().includes('request.json'));
}
