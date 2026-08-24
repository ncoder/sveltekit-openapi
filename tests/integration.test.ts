import { describe, it, expect } from 'vitest';
import { generate } from '../src/index.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('generate (integration)', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');

  it('generates valid OpenAPI 3.1 document from fixtures', async () => {
    const outputPath = path.join(os.tmpdir(), `openapi-test-${Date.now()}.json`);

    const result = await generate({
      routesDir: fixturesDir,
      output: outputPath,
      info: { title: 'Test API', version: '0.1.0' },
    });

    expect(result.document.openapi).toBe('3.1.0');
    expect(result.document.info.title).toBe('Test API');
    expect(result.routeCount).toBeGreaterThanOrEqual(5);
    expect(result.endpointCount).toBeGreaterThanOrEqual(6);

    // Verify file was written
    const content = await fs.readFile(outputPath, 'utf-8');
    const doc = JSON.parse(content);
    expect(doc.openapi).toBe('3.1.0');

    // Cleanup
    await fs.unlink(outputPath);
  });

  it('detects all HTTP methods', async () => {
    const outputPath = path.join(os.tmpdir(), `openapi-test-${Date.now()}.json`);

    const result = await generate({
      routesDir: fixturesDir,
      output: outputPath,
    });

    const multiPath = result.document.paths['/multi-method'];
    expect(multiPath).toBeDefined();
    expect(multiPath!.get).toBeDefined();
    expect(multiPath!.post).toBeDefined();

    await fs.unlink(outputPath);
  });

  it('includes security on authenticated routes', async () => {
    const outputPath = path.join(os.tmpdir(), `openapi-test-${Date.now()}.json`);

    const result = await generate({
      routesDir: fixturesDir,
      output: outputPath,
    });

    const authPost = result.document.paths['/auth-post']?.post;
    expect(authPost?.security).toEqual([{ bearerAuth: [] }]);

    const basicGet = result.document.paths['/basic-get']?.get;
    expect(basicGet?.security).toBeUndefined();

    expect(result.document.components?.securitySchemes?.bearerAuth).toBeDefined();

    await fs.unlink(outputPath);
  });

  it('generates YAML output', async () => {
    const outputPath = path.join(os.tmpdir(), `openapi-test-${Date.now()}.yaml`);

    const result = await generate({
      routesDir: fixturesDir,
      output: outputPath,
      format: 'yaml',
    });

    const content = await fs.readFile(outputPath, 'utf-8');
    expect(content).toContain('openapi: 3.1.0');
    expect(content).toContain('paths:');

    await fs.unlink(outputPath);
  });

  it('extracts Zod schemas when schemaFiles configured', async () => {
    const outputPath = path.join(os.tmpdir(), `openapi-test-${Date.now()}.json`);
    const schemaFile = path.join(fixturesDir, 'zod-schema/schemas.ts');

    const result = await generate({
      routesDir: fixturesDir,
      output: outputPath,
      schemaFiles: [schemaFile],
    });

    expect(result.document.components?.schemas?.CreateItemRequest).toBeDefined();

    const schema = result.document.components!.schemas!.CreateItemRequest as any;
    expect(schema.properties.name.type).toBe('string');
    expect(schema.properties.quantity.type).toBe('integer');

    await fs.unlink(outputPath);
  });

  it('links request and response schema refs from Zod parse calls', async () => {
    const outputPath = path.join(os.tmpdir(), `openapi-test-${Date.now()}.json`);
    const schemaFile = path.join(fixturesDir, 'zod-schema/response-schemas.ts');

    const result = await generate({
      routesDir: fixturesDir,
      output: outputPath,
      schemaFiles: [schemaFile],
    });

    const post = result.document.paths['/zod-parse']?.post;
    expect(post?.requestBody?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/CreateUserBodySchema',
    });
    expect(post?.responses?.['201']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/UserResponseSchema',
    });

    await fs.unlink(outputPath);
  });
});
