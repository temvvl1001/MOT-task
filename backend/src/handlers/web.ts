import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

// Build хийсэн React апп-ыг (backend/web, frontend/dist-ээс scripts/deploy-frontend.sh хуулсан)
// JSON endpoint-уудтай нэг HTTP API-аас үйлчилнэ. Нэг HTTPS origin тул CORS хэрэггүй.
//
// Статик hosting-д S3 + CloudFront нь ердийн сонголт; шинэ AWS account CloudFront нөөц үүсгэхийн өмнө
// AWS Support-оор баталгаажсан байх ёстой тул энэ нь нөөц шийдэл.

const root = () => process.env.WEB_ROOT ?? join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), 'web');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = /^(text\/|application\/json|image\/svg)/;

// Хуудас юуг ачаалж, юуд холбогдож болохыг заана. Бусдыг browser хориглодог тул XSS алдааны хор уршгийг
// хязгаарлана (session token нь localStorage-д байдаг).
const contentSecurityPolicy = () => {
  const wsHost = process.env.WS_ENDPOINT ? new URL(process.env.WS_ENDPOINT).host : '';
  const connect = [
    "'self'",
    `https://cognito-idp.${process.env.AWS_REGION ?? ''}.amazonaws.com`,
    wsHost && `wss://${wsHost}`,
  ].filter(Boolean);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
};

const SECURITY_HEADERS = () => ({
  'content-security-policy': contentSecurityPolicy(),
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
});

// URL замыг web root доторх файл руу хөрвүүлнэ, root-оос гарах гэвэл null буцаана.
export const resolveInside = (webRoot: string, urlPath: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const full = join(webRoot, normalize(decoded));
  return full === webRoot || full.startsWith(webRoot + sep) ? full : null;
};

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const text = (statusCode: number, body: string): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS() },
  body,
});

// Lambda instance амьд байх хугацаанд файл өөрчлөгддөггүй тул нэг л удаа уншиж (мөн шахаж) хадгална.
const cache = new Map<string, { body: Buffer; gzip?: Buffer }>();
const load = (file: string, compressible: boolean) => {
  let entry = cache.get(file);
  if (!entry) {
    const body = readFileSync(file);
    entry = { body, gzip: compressible ? gzipSync(body) : undefined };
    cache.set(file, entry);
  }
  return entry;
};

const cacheControl = (urlPath: string, servedIndex: boolean) => {
  if (servedIndex) return 'no-cache'; // index.html-ийг үргэлж шинээр татна, учир нь одоогийн asset-уудын нэрийг агуулдаг
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable'; // агуулгаар hash хийгдсэн
  return 'public, max-age=3600';
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const webRoot = root();
  const urlPath = event.rawPath || '/';

  const requested = resolveInside(webRoot, urlPath);
  if (!requested) return text(400, 'Bad request');

  let file = requested;
  let servedIndex = false;
  if (!isFile(file)) {
    // Байхгүй asset (/assets/x.js) 404 хэвээр байх ёстой. Бусад зам нь single-page
    // аппын хуудас (/, /anything) тул index.html-ээр хариулагдана.
    if (extname(urlPath) !== '') return text(404, 'Not found');
    file = join(webRoot, 'index.html');
    servedIndex = true;
    if (!isFile(file)) {
      return text(404, 'The web app is not deployed yet. Run scripts/deploy-frontend.sh.');
    }
  }

  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const compressible = COMPRESSIBLE.test(type);
  const { body, gzip } = load(file, compressible);
  const wantsGzip = compressible && /\bgzip\b/.test(event.headers?.['accept-encoding'] ?? '');

  const payload = wantsGzip && gzip ? gzip : body;
  const asText = !wantsGzip && compressible;

  return {
    statusCode: 200,
    headers: {
      'content-type': type,
      'cache-control': cacheControl(urlPath, servedIndex),
      vary: 'Accept-Encoding',
      ...(wantsGzip ? { 'content-encoding': 'gzip' } : {}),
      ...SECURITY_HEADERS(),
    },
    body: asText ? payload.toString('utf8') : payload.toString('base64'),
    isBase64Encoded: !asText,
  };
};
