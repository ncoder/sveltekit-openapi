import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { SchemaExtractor } from '../src/core/schema-extractor.js';
import path from 'path';

const fixtureFile = path.resolve(__dirname, 'fixtures/zod-schema/new-types-schemas.ts');

function getExtractor() {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const extractor = new SchemaExtractor(project);
  return extractor;
}

describe('SchemaExtractor — z.iso date/time types', () => {
  it('z.iso.date() produces type: string, format: date', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Event') as any;

    expect(schema.properties.event_date.type).toBe('string');
    expect(schema.properties.event_date.format).toBe('date');
    expect(schema.required).toContain('event_date');
  });

  it('z.iso.time() produces type: string, format: time', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Event') as any;

    expect(schema.properties.start_time.type).toBe('string');
    expect(schema.properties.start_time.format).toBe('time');
    expect(schema.required).toContain('start_time');
  });

  it('z.iso.datetime() produces type: string, format: date-time', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Event') as any;

    expect(schema.properties.created_at.type).toBe('string');
    expect(schema.properties.created_at.format).toBe('date-time');
    expect(schema.required).toContain('created_at');
  });

  it('z.iso.date().optional() is not required', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Event') as any;

    expect(schema.properties.optional_date.type).toBe('string');
    expect(schema.properties.optional_date.format).toBe('date');
    expect(schema.required).not.toContain('optional_date');
  });

  it('z.iso.date().nullable().optional() is nullable and not required', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Event') as any;

    expect(schema.properties.nullable_date.type).toEqual(['string', 'null']);
    expect(schema.properties.nullable_date.format).toBe('date');
    expect(schema.required).not.toContain('nullable_date');
  });
});

describe('SchemaExtractor — z.email() standalone', () => {
  it('z.email() produces type: string, format: email', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Contact') as any;

    expect(schema.properties.email.type).toBe('string');
    expect(schema.properties.email.format).toBe('email');
    expect(schema.required).toContain('email');
  });

  it('z.email().optional() is not required', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Contact') as any;

    expect(schema.properties.backup_email.format).toBe('email');
    expect(schema.required).not.toContain('backup_email');
  });
});

describe('SchemaExtractor — z.record()', () => {
  it('z.record(z.string(), z.string()) produces additionalProperties: string', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Dictionary') as any;

    expect(schema.properties.labels.type).toBe('object');
    expect(schema.properties.labels.additionalProperties.type).toBe('string');
  });

  it('z.record(z.string(), z.number()) produces additionalProperties: number', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Dictionary') as any;

    expect(schema.properties.scores.type).toBe('object');
    expect(schema.properties.scores.additionalProperties.type).toBe('number');
  });

  it('z.record(z.string(), z.boolean()) produces additionalProperties: boolean', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('Dictionary') as any;

    expect(schema.properties.flags.type).toBe('object');
    expect(schema.properties.flags.additionalProperties.type).toBe('boolean');
  });
});

describe('SchemaExtractor — z.string().regex()', () => {
  it('z.string().regex() produces pattern', async () => {
    const ext = getExtractor();
    await ext.extractFromFiles([fixtureFile]);
    const schema = ext.getComponent('TimeRange') as any;

    expect(schema.properties.start.type).toBe('string');
    expect(schema.properties.start.pattern).toBe('^\\d{2}:\\d{2}$');
    expect(schema.properties.end.pattern).toBe('^\\d{2}:\\d{2}$');
    expect(schema.required).toContain('start');
    expect(schema.required).toContain('end');
  });
});
