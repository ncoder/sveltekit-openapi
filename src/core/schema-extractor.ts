import { Project, Node, SyntaxKind, type SourceFile, type CallExpression } from 'ts-morph';
import fg from 'fast-glob';
import type { SchemaComponent } from '../types.js';

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
  example?: unknown;
  default?: unknown;
}

/**
 * Extract Zod schema definitions from schema files and convert to JSON Schema.
 *
 * Walks Zod method chains statically (no runtime execution).
 */
export class SchemaExtractor {
  private components = new Map<string, JsonSchema>();
  private variableSchemas = new Map<string, JsonSchema>();

  constructor(private project: Project) {}

  /**
   * Scan schema files and extract all Zod schemas.
   */
  async extractFromFiles(patterns: string[]): Promise<SchemaComponent[]> {
    const files = await fg(patterns, { absolute: true });

    for (const filePath of files) {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      this.extractFromSourceFile(sourceFile);
    }

    return Array.from(this.components.entries()).map(([name, schema]) => ({
      name,
      schema: schema as Record<string, unknown>,
    }));
  }

  /**
   * Get the JSON Schema for a variable name (e.g. 'registerSchema').
   */
  getSchemaForVariable(name: string): JsonSchema | undefined {
    return this.variableSchemas.get(name);
  }

  /**
   * Get a named component by its .openapi('Name') name.
   */
  getComponent(name: string): JsonSchema | undefined {
    return this.components.get(name);
  }

  /**
   * Get all named components.
   */
  getComponents(): Map<string, JsonSchema> {
    return this.components;
  }

  /**
   * Extract schemas from a single source file (e.g. a route file with inline Zod schemas).
   * Adds any found schemas to the variable registry so they can be looked up by name.
   * Does NOT register them as named components unless they have .openapi('Name').
   */
  extractFromSourceFile(sourceFile: SourceFile): void {
    // Find all variable declarations that are Zod schemas
    for (const stmt of sourceFile.getStatements()) {
      if (!Node.isVariableStatement(stmt)) continue;

      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (!init) continue;

        const text = init.getText();
        if (!text.startsWith('z.')) continue;

        const schema = this.parseZodExpression(init);
        if (!schema) continue;

        const varName = decl.getName();
        this.variableSchemas.set(varName, schema);

        // Check for .openapi('ComponentName') call
        const componentName = this.extractOpenApiName(init);
        if (componentName) {
          this.components.set(componentName, schema);
        }
      }
    }
  }

  /**
   * Recursively parse a Zod expression into JSON Schema.
   */
  private parseZodExpression(node: Node): JsonSchema | undefined {
    const text = node.getText();

    // Walk the call chain from the outermost call inward
    if (Node.isCallExpression(node)) {
      return this.parseZodCallChain(node);
    }

    // Direct property access like z.string or z.number (without parens — rare)
    if (Node.isPropertyAccessExpression(node)) {
      const name = node.getName();
      return this.zodTypeToSchema(name);
    }

    return undefined;
  }

  private parseZodCallChain(call: CallExpression): JsonSchema | undefined {
    const expr = call.getExpression();

    // Base case: z.string(), z.number(), z.boolean(), z.object({...}), z.enum([...])
    if (Node.isPropertyAccessExpression(expr)) {
      const obj = expr.getExpression();
      const method = expr.getName();

      // z.something() OR z.coerce.something()
      if (obj.getText() === 'z' || obj.getText() === 'z.coerce') {
        return this.handleZodBaseType(method, call);
      }

      // Chained call: inner.method()
      const innerSchema = this.parseZodExpression(obj);
      if (!innerSchema) return undefined;

      return this.applyZodModifier(innerSchema, method, call);
    }

    return undefined;
  }

  private handleZodBaseType(method: string, call: CallExpression): JsonSchema | undefined {
    switch (method) {
      case 'object': {
        const args = call.getArguments();
        if (args.length === 0) return { type: 'object' };

        const firstArg = args[0];
        if (!Node.isObjectLiteralExpression(firstArg)) return { type: 'object' };

        const properties: Record<string, JsonSchema> = {};
        const required: string[] = [];

        for (const prop of firstArg.getProperties()) {
          if (!Node.isPropertyAssignment(prop)) continue;

          const propName = prop.getName();
          const propInit = prop.getInitializer();
          if (!propInit) continue;

          const propSchema = this.parseZodExpression(propInit);
          if (propSchema) {
            properties[propName] = propSchema;
            // Track if required (not wrapped in .optional())
            if (!propInit.getText().includes('.optional()')) {
              required.push(propName);
            }
          }
        }

        const schema: JsonSchema = { type: 'object', properties };
        if (required.length > 0) schema.required = required;
        return schema;
      }

      case 'array': {
        const args = call.getArguments();
        const items = args.length > 0 ? this.parseZodExpression(args[0]) : undefined;
        return { type: 'array', ...(items ? { items } : {}) };
      }

      case 'enum': {
        const args = call.getArguments();
        if (args.length === 0) return { type: 'string' };

        const firstArg = args[0];
        if (Node.isArrayLiteralExpression(firstArg)) {
          const values = firstArg
            .getElements()
            .filter((e): e is import('ts-morph').StringLiteral => Node.isStringLiteral(e))
            .map((e) => e.getLiteralValue());
          return { type: 'string', enum: values };
        }
        return { type: 'string' };
      }

      case 'literal': {
        const args = call.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          return { type: 'string', enum: [args[0].getLiteralValue()] };
        }
        if (args.length > 0 && Node.isNumericLiteral(args[0])) {
          return { type: 'number', enum: [parseFloat(args[0].getText())] };
        }
        return {};
      }

      default:
        return this.zodTypeToSchema(method);
    }
  }

  private zodTypeToSchema(method: string): JsonSchema | undefined {
    switch (method) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'email':
        return { type: 'string', format: 'email' };
      case 'integer':
        return { type: 'integer' };
      case 'any':
        return {};
      case 'unknown':
        return {};
      case 'null':
        return { type: 'null' as string };
      case 'undefined':
        return {};
      case 'void':
        return {};
      case 'date':
        return { type: 'string', format: 'date-time' };
      default:
        return undefined;
    }
  }

  private applyZodModifier(schema: JsonSchema, method: string, call: CallExpression): JsonSchema {
    const args = call.getArguments();

    switch (method) {
      case 'email':
        return { ...schema, format: 'email' };
      case 'url':
        return { ...schema, format: 'uri' };
      case 'uuid':
        return { ...schema, format: 'uuid' };
      case 'datetime':
        return { ...schema, format: 'date-time' };
      case 'ip':
        return { ...schema, format: 'ipv4' };
      case 'int':
        return { ...schema, type: 'integer' };

      case 'min': {
        const val = this.extractNumericArg(args);
        if (val !== undefined) {
          if (schema.type === 'string') return { ...schema, minLength: val };
          return { ...schema, minimum: val };
        }
        return schema;
      }

      case 'max': {
        const val = this.extractNumericArg(args);
        if (val !== undefined) {
          if (schema.type === 'string') return { ...schema, maxLength: val };
          return { ...schema, maximum: val };
        }
        return schema;
      }

      case 'length': {
        const val = this.extractNumericArg(args);
        if (val !== undefined) {
          return { ...schema, minLength: val, maxLength: val };
        }
        return schema;
      }

      case 'optional':
        // Mark as optional — handled by parent object processing
        return schema;

      case 'nullable':
        return {
          ...schema,
          type: Array.isArray(schema.type) ? [...schema.type, 'null'] : schema.type ? [schema.type, 'null'] : ['null'],
        };

      case 'default': {
        if (args.length > 0) {
          const val = this.extractLiteralValue(args[0]);
          if (val !== undefined) return { ...schema, default: val };
        }
        return schema;
      }

      case 'describe': {
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          return { ...schema, description: args[0].getLiteralValue() };
        }
        return schema;
      }

      case 'openapi': {
        // .openapi({ example: '...', description: '...' }) or .openapi('Name')
        if (args.length > 0 && Node.isObjectLiteralExpression(args[0])) {
          const obj = args[0];
          const merged = { ...schema };

          for (const prop of obj.getProperties()) {
            if (!Node.isPropertyAssignment(prop)) continue;
            const name = prop.getName();
            const init = prop.getInitializer();
            if (!init) continue;

            if (name === 'example') {
              merged.example = this.extractLiteralValue(init);
            } else if (name === 'description' && Node.isStringLiteral(init)) {
              merged.description = init.getLiteralValue();
            }
          }
          return merged;
        }
        return schema;
      }

      // Passthrough modifiers that don't affect schema
      case 'refine':
      case 'superRefine':
      case 'transform':
      case 'pipe':
      case 'brand':
      case 'catch':
      case 'readonly':
      case 'strip':
      case 'passthrough':
      case 'strict':
        return schema;

      default:
        return schema;
    }
  }

  private extractOpenApiName(node: Node): string | undefined {
    if (!Node.isCallExpression(node)) return undefined;

    const expr = node.getExpression();
    if (Node.isPropertyAccessExpression(expr) && expr.getName() === 'openapi') {
      const args = node.getArguments();
      if (args.length > 0 && Node.isStringLiteral(args[0])) {
        return args[0].getLiteralValue();
      }
    }

    // Recurse into the chain
    if (Node.isPropertyAccessExpression(expr)) {
      return this.extractOpenApiName(expr.getExpression());
    }

    return undefined;
  }

  private extractNumericArg(args: Node[]): number | undefined {
    if (args.length === 0) return undefined;
    const first = args[0];
    if (Node.isNumericLiteral(first)) {
      return parseFloat(first.getText());
    }
    return undefined;
  }

  private extractLiteralValue(node: Node): unknown {
    if (Node.isStringLiteral(node)) return node.getLiteralValue();
    if (Node.isNumericLiteral(node)) return parseFloat(node.getText());
    if (node.getText() === 'true') return true;
    if (node.getText() === 'false') return false;
    if (node.getText() === 'null') return null;
    return undefined;
  }
}
