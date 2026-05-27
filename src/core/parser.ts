import { Project, Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { HttpMethod, MethodInfo, RouteInfo, ScannedRoute, SvelteKitOpenAPIConfig } from '../types.js';
import { analyzeAuth } from '../analyzers/auth.js';
import { analyzeRouteParams } from '../analyzers/route-params.js';
import { analyzeQueryParams } from '../analyzers/query-params.js';
import { analyzeRequestBody } from '../analyzers/request-body.js';
import { analyzeResponses } from '../analyzers/response.js';
import type { SchemaExtractor } from './schema-extractor.js';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Parse a single +server.ts file and extract method info for each HTTP handler.
 */
export function parseRoute(
  sourceFile: SourceFile,
  scannedRoute: ScannedRoute,
  config: SvelteKitOpenAPIConfig,
  schemaExtractor?: SchemaExtractor,
): RouteInfo {
  const methods: MethodInfo[] = [];

  // Register inline Zod schemas from this route file so Tier 2 query param
  // detection can resolve schema variable names defined directly in +server.ts files.
  schemaExtractor?.extractFromSourceFile(sourceFile);

  for (const method of HTTP_METHODS) {
    const exportName = method.toUpperCase();

    // Find exported variable: export const GET: RequestHandler = async (event) => { ... }
    const handlerBody = findHandlerBody(sourceFile, exportName);
    if (!handlerBody) continue;

    const authPatterns = config.auth?.patterns;
    const security = analyzeAuth(handlerBody, authPatterns);
    const pathParams = analyzeRouteParams(handlerBody, scannedRoute.pathParams);
    const queryParams = analyzeQueryParams(handlerBody, schemaExtractor);
    const requestBody = analyzeRequestBody(handlerBody);
    const responses = analyzeResponses(handlerBody);

    // Determine tier
    let tier: 1 | 2 | 3 = 1;
    if (requestBody?.schemaRef) {
      tier = 2;
    } else if (requestBody && requestBody.fields.length === 0 && !requestBody.schemaRef) {
      tier = 3;
    }

    const params = [...pathParams, ...queryParams];

    methods.push({
      method,
      params,
      requestBody,
      responses,
      security,
      tier,
    });
  }

  return {
    routePath: scannedRoute.routePath,
    filePath: scannedRoute.filePath,
    methods,
  };
}

/**
 * Find the function body for a named export handler (GET, POST, etc.)
 */
function findHandlerBody(sourceFile: SourceFile, exportName: string): Node | undefined {
  // Check variable declarations: export const GET: RequestHandler = async (event) => { ... }
  for (const stmt of sourceFile.getStatements()) {
    if (!Node.isVariableStatement(stmt)) continue;
    if (!stmt.isExported()) continue;

    for (const decl of stmt.getDeclarations()) {
      if (decl.getName() !== exportName) continue;

      const init = decl.getInitializer();
      if (!init) continue;

      // Direct arrow function or function expression
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        return init.getBody();
      }

      // Wrapped in satisfies or type assertion
      if (Node.isAsExpression(init) || Node.isSatisfiesExpression(init)) {
        const inner = init.getExpression();
        if (Node.isArrowFunction(inner) || Node.isFunctionExpression(inner)) {
          return inner.getBody();
        }
      }

      return init;
    }
  }

  // Check function declarations: export function GET(event) { ... }
  for (const fn of sourceFile.getFunctions()) {
    if (fn.getName() === exportName && fn.isExported()) {
      return fn.getBody();
    }
  }

  return undefined;
}

/**
 * Parse all scanned routes using a shared ts-morph Project.
 */
export function parseAllRoutes(
  project: Project,
  routes: ScannedRoute[],
  config: SvelteKitOpenAPIConfig,
  schemaExtractor?: SchemaExtractor,
): RouteInfo[] {
  const results: RouteInfo[] = [];

  for (const route of routes) {
    const sourceFile = project.addSourceFileAtPath(route.filePath);
    const routeInfo = parseRoute(sourceFile, route, config, schemaExtractor);
    if (routeInfo.methods.length > 0) {
      results.push(routeInfo);
    }
  }

  return results;
}
