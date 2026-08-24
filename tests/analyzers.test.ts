import { describe, it, expect } from 'vitest';
import { Project, Node, SyntaxKind } from 'ts-morph';
import { analyzeAuth } from '../src/analyzers/auth.js';
import { analyzeRouteParams } from '../src/analyzers/route-params.js';
import { analyzeQueryParams } from '../src/analyzers/query-params.js';
import { analyzeRequestBody } from '../src/analyzers/request-body.js';
import { analyzeResponses } from '../src/analyzers/response.js';
import path from 'path';

function getHandlerBody(filePath: string, method: string = 'GET') {
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true, skipLibCheck: true } });
  const sourceFile = project.addSourceFileAtPath(filePath);

  for (const stmt of sourceFile.getStatements()) {
    if (!Node.isVariableStatement(stmt)) continue;
    if (!stmt.isExported()) continue;

    for (const decl of stmt.getDeclarations()) {
      if (decl.getName() !== method) continue;
      const init = decl.getInitializer();
      if (!init) continue;
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        return init.getBody();
      }
    }
  }
  return undefined;
}

const fixtures = path.resolve(__dirname, 'fixtures');

describe('analyzeAuth', () => {
  it('detects requireAuth', () => {
    const body = getHandlerBody(path.join(fixtures, 'auth-post/+server.ts'), 'POST');
    const result = analyzeAuth(body!);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('auth');
  });

  it('detects requireRole with roles', () => {
    const body = getHandlerBody(path.join(fixtures, 'params-[id]/+server.ts'), 'GET');
    const result = analyzeAuth(body!);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('role');
    expect(result[0].roles).toEqual(['admin', 'instructor']);
  });

  it('returns empty for unauthenticated routes', () => {
    const body = getHandlerBody(path.join(fixtures, 'basic-get/+server.ts'), 'GET');
    const result = analyzeAuth(body!);
    expect(result).toHaveLength(0);
  });
});

describe('analyzeRouteParams', () => {
  it('extracts destructured params', () => {
    const body = getHandlerBody(path.join(fixtures, 'params-[id]/+server.ts'), 'GET');
    const result = analyzeRouteParams(body!, ['id']);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'id', in: 'path', required: true, type: 'string' });
  });
});

describe('analyzeQueryParams', () => {
  it('extracts searchParams.get calls', () => {
    const body = getHandlerBody(path.join(fixtures, 'query-params/+server.ts'), 'GET');
    const result = analyzeQueryParams(body!);
    expect(result).toHaveLength(3);
    const names = result.map((p) => p.name);
    expect(names).toContain('search');
    expect(names).toContain('page');
    expect(names).toContain('limit');
    expect(result.every((p) => !p.required)).toBe(true);
  });
});

describe('analyzeRequestBody', () => {
  it('detects destructured request.json()', () => {
    const body = getHandlerBody(path.join(fixtures, 'auth-post/+server.ts'), 'POST');
    const result = analyzeRequestBody(body!);
    expect(result).toBeDefined();
    expect(result!.required).toBe(true);
    expect(result!.fields.map((f) => f.name)).toEqual(['title', 'description']);
  });

  it('returns undefined for GET handlers', () => {
    const body = getHandlerBody(path.join(fixtures, 'basic-get/+server.ts'), 'GET');
    const result = analyzeRequestBody(body!);
    expect(result).toBeUndefined();
  });

  it('returns generic body when not destructured (Tier 3)', () => {
    const body = getHandlerBody(path.join(fixtures, 'generic-body/+server.ts'), 'POST');
    const result = analyzeRequestBody(body!);
    expect(result).toBeDefined();
    expect(result!.required).toBe(true);
    expect(result!.fields).toHaveLength(0); // no destructured fields
    expect(result!.schemaRef).toBeUndefined();
  });

  it('links request body schema from Schema.parse(await request.json())', () => {
    const body = getHandlerBody(path.join(fixtures, 'zod-parse/+server.ts'), 'POST');
    const result = analyzeRequestBody(body!);
    expect(result?.schemaRef).toBe('CreateUserBodySchema');
  });

  it('ignores response Schema.parse when resolving request body schema', () => {
    const body = getHandlerBody(path.join(fixtures, 'zod-parse/+server.ts'), 'POST');
    const result = analyzeRequestBody(body!);
    expect(result?.schemaRef).not.toBe('UserResponseSchema');
  });
});

describe('analyzeResponses', () => {
  it('detects multiple status codes', () => {
    const body = getHandlerBody(path.join(fixtures, 'auth-post/+server.ts'), 'POST');
    const result = analyzeResponses(body!);
    const codes = result.map((r) => r.statusCode);
    expect(codes).toContain(201);
    expect(codes).toContain(400);
  });

  it('detects error response schema', () => {
    const body = getHandlerBody(path.join(fixtures, 'auth-post/+server.ts'), 'POST');
    const result = analyzeResponses(body!);
    const err400 = result.find((r) => r.statusCode === 400);
    expect(err400?.schema).toEqual({
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    });
  });

  it('provides default 200 for simple responses', () => {
    const body = getHandlerBody(path.join(fixtures, 'basic-get/+server.ts'), 'GET');
    const result = analyzeResponses(body!);
    expect(result).toHaveLength(1);
    expect(result[0].statusCode).toBe(200);
  });

  it('links response schema from return json(Schema.parse(...))', () => {
    const body = getHandlerBody(path.join(fixtures, 'zod-parse/+server.ts'), 'POST');
    const result = analyzeResponses(body!);
    const created = result.find((r) => r.statusCode === 201);
    expect(created?.schemaRef).toBe('UserResponseSchema');
    expect(created?.schema).toBeUndefined();
  });
});
