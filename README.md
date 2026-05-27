# @sveltekit-openapi/core

Auto-generate OpenAPI 3.1 documentation from your SvelteKit API routes. No decorators, no wrappers, no new APIs to learn — just point it at your existing code.

```bash
npx @sveltekit-openapi/core generate
```

## Why?

SvelteKit [deliberately chose](https://github.com/sveltejs/kit/issues/12645) not to enforce typed API responses. That's fine — but it means there's no built-in way to generate API docs.

Existing community tools require JSDoc annotations or are deprecated. This tool takes a different approach: it reads your **existing code** with TypeScript AST analysis and produces an OpenAPI 3.1 spec. No annotations, no comments, no runtime dependencies.

- **Got Zod schemas?** Full docs with validation rules, examples, and enums.
- **Just TypeScript?** Route paths, methods, params, status codes, and auth — all auto-detected.
- **No types at all?** Endpoints still documented, just marked as `object`.

## Install

```bash
# npm
npm install -D @sveltekit-openapi/core

# Deno
deno add jsr:@sveltekit-openapi/core
```

## Quick Start

### CLI

```bash
# Generate from default location (src/routes)
npx sveltekit-openapi generate

# With options
npx sveltekit-openapi generate \
  --routes-dir src/routes \
  --schema-files "src/lib/schemas/*.ts" \
  --output openapi.json \
  --title "My API" \
  --api-version "1.0.0"

# Preview discovered routes without generating
npx sveltekit-openapi preview

# Serve with interactive API docs viewer
npx sveltekit-openapi serve --theme swagger --open
```

### Vite Plugin

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { sveltekitOpenApi } from '@sveltekit-openapi/core/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    sveltekitOpenApi({
      output: 'static/openapi.json',
      schemaFiles: ['src/lib/schemas/*.ts'],
      info: {
        title: 'My API',
        version: '1.0.0',
      },
    }),
  ],
});
```

The Vite plugin:
- Generates on dev server start
- Watches `+server.ts` and schema files for changes, regenerates with 300ms debounce
- Serves an interactive API docs viewer at `/_openapi` during development
- Serves the raw spec at `/_openapi/spec.json`

### Programmatic

```ts
// Node / npm
import { generate } from '@sveltekit-openapi/core';

// Deno / JSR
import { generate } from 'jsr:@sveltekit-openapi/core';

const result = await generate({
  routesDir: 'src/routes',
  schemaFiles: ['src/lib/schemas/*.ts'],
  output: 'openapi.json',
});

console.log(`Generated ${result.endpointCount} endpoints from ${result.routeCount} routes`);
// result.document contains the full OpenAPI 3.1 object
```

## How It Works

The tool uses a **tiered inference model** — it documents what it *can* infer and clearly marks what it can't.

### Tier 1 — Automatic (zero effort)

Everything below is detected automatically from your `+server.ts` files via [ts-morph](https://ts-morph.com/) AST analysis:

| What | How it's detected |
|------|-------------------|
| Route paths | Filesystem conventions (`src/routes/api/v1/users/+server.ts` &rarr; `/api/v1/users`) |
| HTTP methods | Named exports (`export const GET`, `export const POST`, etc.) |
| Path params | Directory names (`[id]` &rarr; `{id}`, `[[optional]]`, `[...rest]`) |
| Query params | `event.url.searchParams.get('name')` calls (all typed as `string`, all optional) — or [Zod-typed](#zod-typed-query-parameters) |
| Request body fields | `const { a, b } = await event.request.json()` destructuring |
| Status codes | `json(data, { status: 201 })` calls |
| Auth requirements | `requireAuth(event)` / `requireRole(event, 'admin')` patterns |
| Tags | Auto-generated from route path segments |
| Operation IDs | Auto-generated from method + route (e.g. `getCoursesModules`) |
| Route groups | `(groupName)` directories stripped from output paths |

### Tier 2 — Full Docs (you provide Zod schemas)

When you have Zod schemas, the tool extracts full type information by statically walking the Zod method chain (no runtime execution):

```ts
// src/lib/schemas/auth.ts
export const registerSchema = z.object({
  email: z.string().email().openapi({ example: 'jane@example.com' }),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(255),
}).openapi('RegisterRequest');
```

This produces a fully documented JSON Schema component:

```json
{
  "RegisterRequest": {
    "type": "object",
    "properties": {
      "email": { "type": "string", "format": "email", "example": "jane@example.com" },
      "password": { "type": "string", "minLength": 8, "maxLength": 128 },
      "firstName": { "type": "string", "minLength": 1, "maxLength": 255 }
    },
    "required": ["email", "password", "firstName"]
  }
}
```

**Supported Zod features:**

| Category | Methods |
|----------|---------|
| Base types | `string`, `number`, `boolean`, `object`, `array`, `enum`, `literal`, `date` |
| String formats | `.email()`, `.url()`, `.uuid()`, `.datetime()`, `.ip()` |
| Number modifiers | `.int()`, `.min()`, `.max()` |
| String constraints | `.min()`, `.max()`, `.length()` |
| Optionality | `.optional()`, `.nullable()`, `.default()` |
| Metadata | `.describe()`, `.openapi({ example, description })`, `.openapi('Name')` |
| Composition | Nested `z.object()`, `z.array()` |
| Validation | `.parse()` and `.safeParse()` detection in route handlers |

Schemas are registered as named components via `.openapi('Name')` and referenced with `$ref` in the output.

#### Zod-typed Query Parameters

Query parameters are also typed when you use the `Schema.parse(Object.fromEntries(url.searchParams))` pattern inline in a route handler:

```ts
// src/routes/api/products/+server.ts
const querySchema = z.object({
  page: z.number().int().optional().describe('Page number (1-based)'),
  limit: z.number().int().optional().describe('Max results per page'),
  search: z.string().optional(),
  inStock: z.boolean(),
});

export const GET: RequestHandler = async ({ url }) => {
  const query = querySchema.parse(Object.fromEntries(url.searchParams));
  // ...
};
```

This produces properly typed query parameters — with correct types, required/optional status, and descriptions — instead of all-`string`, all-optional params:

```json
"parameters": [
  { "name": "page",    "in": "query", "required": false, "schema": { "type": "integer" }, "description": "Page number (1-based)" },
  { "name": "limit",   "in": "query", "required": false, "schema": { "type": "integer" }, "description": "Max results per page" },
  { "name": "search",  "in": "query", "required": false, "schema": { "type": "string" } },
  { "name": "inStock", "in": "query", "required": true,  "schema": { "type": "boolean" } }
]
```

The schema variable can be defined inline in the route file or imported from a schema file already listed in `schemaFiles`. Both `.parse()` and `.safeParse()` are detected. This pattern takes precedence only when no `searchParams.get()` calls are present in the same handler.

### Tier 3 — Fallback

Endpoints without type information are still documented — request/response bodies are typed as `object`. You get the route, method, params, and status codes regardless.

## Interactive API Docs Viewer

The `serve` command starts a local server with an interactive API documentation viewer. Three themes available, all loaded from CDN with zero extra dependencies:

```bash
npx sveltekit-openapi serve --theme swagger   # Classic Swagger UI (default)
npx sveltekit-openapi serve --theme scalar    # Modern Scalar API Reference
npx sveltekit-openapi serve --theme redoc     # Clean Redoc documentation
```

Options:

```bash
npx sveltekit-openapi serve \
  --theme swagger \        # swagger | scalar | redoc (default: swagger)
  --port 4242 \            # port to serve on (default: 4242)
  --open                   # auto-open browser
```

The viewer is also available in the Vite plugin at `/_openapi` during development, configured via the `viewer` option in your config.

The viewer renders the generated spec — it does not run your SvelteKit app. To test endpoints with "Try it", run your app separately.

## Configuration

Create `sveltekit-openapi.config.ts` (or `.js`, `.mjs`) in your project root:

```ts
import type { SvelteKitOpenAPIConfig } from '@sveltekit-openapi/core';

export default {
  routesDir: 'src/routes',
  output: 'openapi.json',
  format: 'json', // or 'yaml'

  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'My SvelteKit API',
  },

  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'http://localhost:5173', description: 'Development' },
  ],

  // Glob patterns for Zod schema files
  schemaFiles: ['src/lib/schemas/**/*.ts'],

  // Auth detection
  auth: {
    // Function names that indicate authentication
    patterns: ['requireAuth', 'requireRole'],
    // Custom security scheme (default: Bearer JWT)
    securityScheme: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    },
  },

  // Tag generation
  tags: {
    segmentIndex: 0, // Which path segment after /api/vN/ to use for tags
  },

  // Viewer theme for serve command and Vite plugin
  viewer: 'swagger', // 'swagger' | 'scalar' | 'redoc'

  // Glob patterns to exclude
  exclude: ['**/internal/**'],
} satisfies SvelteKitOpenAPIConfig;
```

CLI flags override config file values.

## Output Example

Running against a real SvelteKit project (23 routes, 29 endpoints, 20 Zod schemas):

```json
{
  "openapi": "3.1.0",
  "info": { "title": "My API", "version": "1.0.0" },
  "paths": {
    "/api/v1/auth/login": {
      "post": {
        "operationId": "postAuthLogin",
        "tags": ["auth"],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "email": { "type": "string" },
                  "password": { "type": "string" }
                }
              }
            }
          }
        },
        "responses": {
          "200": { "description": "Success" },
          "400": {
            "description": "Bad Request",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": { "message": { "type": "string" } },
                  "required": ["message"]
                }
              }
            }
          },
          "401": { "description": "Unauthorized" },
          "403": { "description": "Forbidden" },
          "500": { "description": "Internal Server Error" }
        }
      }
    },
    "/api/v1/admin/users": {
      "get": {
        "operationId": "getAdminUsers",
        "tags": ["admin"],
        "parameters": [
          { "name": "search", "in": "query", "required": false, "schema": { "type": "string" } },
          { "name": "role", "in": "query", "required": false, "schema": { "type": "string" } }
        ],
        "responses": { "200": { "description": "Success" } },
        "security": [{ "bearerAuth": [] }],
        "summary": "Requires role: admin"
      }
    }
  },
  "components": {
    "schemas": {
      "RegisterRequest": {
        "type": "object",
        "properties": {
          "email": { "type": "string", "format": "email", "example": "jane@example.com" },
          "password": { "type": "string", "minLength": 8, "maxLength": 128 },
          "firstName": { "type": "string", "minLength": 1, "maxLength": 255 }
        },
        "required": ["email", "password", "firstName"]
      }
    },
    "securitySchemes": {
      "bearerAuth": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" }
    }
  },
  "tags": [
    { "name": "admin" },
    { "name": "auth" },
    { "name": "courses" },
    { "name": "enrollments" }
  ]
}
```

## Architecture

```
src/
├── index.ts              # Library entry: generate(config?)
├── cli.ts                # CLI: generate, preview, serve commands
├── vite.ts               # Vite plugin: sveltekitOpenApi()
├── viewer.ts             # HTML viewer: Swagger UI / Scalar / Redoc
├── types.ts              # Config + internal types (uses openapi3-ts)
├── core/
│   ├── scanner.ts        # Discovers +server.ts files, converts paths
│   ├── parser.ts         # Orchestrates per-file AST analysis
│   ├── schema-extractor.ts  # Zod chain → JSON Schema conversion
│   └── generator.ts      # Assembles final OpenAPI 3.1 document
└── analyzers/
    ├── auth.ts           # requireAuth / requireRole detection
    ├── route-params.ts   # event.params destructuring
    ├── query-params.ts   # searchParams.get() calls
    ├── request-body.ts   # request.json() + schema detection
    └── response.ts       # json() calls, status codes
```

**Data flow:**

```
Scanner (filesystem) → Parser (ts-morph AST) → Generator (OpenAPI 3.1)
                         ↑ uses 5 analyzers     ↑ uses schema registry
                         ↑                      ↑
                    Schema Extractor (Zod files) ─┘
```

## What This Tool Does NOT Do

- **It does not wrap your handlers.** Your code stays exactly the same.
- **It does not require Zod.** Zod makes the output better, but it's optional.
- **It does not execute your code.** Everything is static analysis via the TypeScript AST.
- **It does not generate client code.** Use the OpenAPI spec with [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) or any codegen tool.
- **It does not add runtime dependencies.** It's a dev tool — zero impact on your bundle.

## CLI Reference

```
Usage: sveltekit-openapi [command] [options]

Commands:
  generate [options]    Generate OpenAPI documentation (default)
  preview [options]     Preview discovered routes without generating
  serve [options]       Generate and serve API docs with interactive viewer

Generate options:
  -c, --config <path>          Path to config file
  -o, --output <path>          Output file path (default: "openapi.json")
  -f, --format <format>        Output format: json or yaml (default: "json")
  -r, --routes-dir <path>      Routes directory (default: "src/routes")
  -s, --schema-files <globs>   Glob patterns for schema files
  --title <title>              API title
  --api-version <version>      API version

Serve options:
  -c, --config <path>          Path to config file
  -p, --port <port>            Port to serve on (default: 4242)
  -t, --theme <theme>          Viewer: swagger, scalar, or redoc (default: "swagger")
  --open                       Open browser automatically
  (also accepts all generate options)
```

## Examples

The [`examples/`](./examples) directory contains four SvelteKit API projects you can run the tool against:

| Example | What it tests |
|---------|---------------|
| [**bare-minimum**](./examples/bare-minimum) | Tier 1/3: query params, destructured body, no Zod, no auth |
| [**zod-heavy**](./examples/zod-heavy) | Tier 2: nested objects, arrays, enums, nullable, `.openapi()` metadata |
| [**auth-patterns**](./examples/auth-patterns) | Public vs `requireAuth` vs `requireRole` (single and multi-role) |
| [**complex-routing**](./examples/complex-routing) | Route groups, 3-level nested params, rest params, optional params |

```bash
# Clone and try
git clone https://github.com/moo3/sveltekit-openapi.git
cd sveltekit-openapi
npm install && npm run build
node dist/cli.js serve -c examples/zod-heavy/sveltekit-openapi.config.ts --theme swagger --open
```

See [`examples/README.md`](./examples/README.md) for details on what each project demonstrates.

## Dependencies

| Package | Purpose |
|---------|---------|
| [ts-morph](https://ts-morph.com/) | TypeScript AST analysis |
| [openapi3-ts](https://github.com/metadevpro/openapi3-ts) | OpenAPI 3.1 types and builder |
| [fast-glob](https://github.com/mrmlnc/fast-glob) | File discovery |
| [commander](https://github.com/tj/commander.js) | CLI framework |
| [yaml](https://github.com/eemeli/yaml) | YAML output |

All viewer themes (Swagger UI, Scalar, Redoc) are loaded from CDN at runtime — no additional install.

## License

MIT
