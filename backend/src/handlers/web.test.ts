import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler, resolveInside } from './web';

let sandbox: string;
let webRoot: string;

const INDEX = '<!doctype html><title>app</title><script type="module" src="/assets/app-abc123.js"></script>';
const SCRIPT = 'console.log("hello");';
const SECRET = 'top secret';

const get = async (rawPath: string, headers: Record<string, string> = {}) =>
  (await handler(
    { rawPath, headers } as unknown as APIGatewayProxyEventV2,
    {} as never,
    () => undefined
  )) as APIGatewayProxyStructuredResultV2;

const header = (res: APIGatewayProxyStructuredResultV2, name: string) =>
  (res.headers as Record<string, string>)[name];

beforeAll(() => {
  // sandbox/
  //   secret.txt          <- web root-ийн гадна: хэзээ ч хүрч болохгүй
  //   web/index.html, web/favicon.svg, web/assets/app-abc123.js
  sandbox = mkdtempSync(join(tmpdir(), 'web-test-'));
  webRoot = join(sandbox, 'web');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  writeFileSync(join(sandbox, 'secret.txt'), SECRET);
  writeFileSync(join(webRoot, 'index.html'), INDEX);
  writeFileSync(join(webRoot, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(webRoot, 'assets', 'app-abc123.js'), SCRIPT);
  writeFileSync(join(webRoot, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
  process.env.WEB_ROOT = webRoot;
  process.env.WS_ENDPOINT = 'https://ws123.execute-api.ap-southeast-2.amazonaws.com/dev';
  process.env.AWS_REGION = 'ap-southeast-2';
});

afterAll(() => {
  delete process.env.WEB_ROOT;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('web: хуудсууд', () => {
  it('"/" нь index.html-г үргэлж шинэчлэхээр (no-cache) өгнө', async () => {
    const res = await get('/');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX);
    expect(header(res, 'content-type')).toBe('text/html; charset=utf-8');
    expect(header(res, 'cache-control')).toBe('no-cache');
  });

  it('single-page app-ын дурын зам (deep link) index.html-ээр хариулагдана', async () => {
    const res = await get('/some/page');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX);
  });

  it('хэшлэгдсэн asset-ийг хамгийн урт хугацаагаар cache хийлгэнэ', async () => {
    const res = await get('/assets/app-abc123.js');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(SCRIPT);
    expect(header(res, 'content-type')).toBe('text/javascript; charset=utf-8');
    expect(header(res, 'cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('байхгүй asset-ийг index.html-ээр бүрхэхгүй, 404 өгнө', async () => {
    const res = await get('/assets/missing.js');

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('<title>');
  });

  it('deploy хийгдээгүй бол ойлгомжтой 404 өгнө', async () => {
    const previous = process.env.WEB_ROOT;
    process.env.WEB_ROOT = join(sandbox, 'empty');

    const res = await get('/');
    process.env.WEB_ROOT = previous;

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('not deployed');
  });
});

describe('web: web root-оос гарах оролдлого (path traversal)', () => {
  it.each([
    '/../secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/assets/../../secret.txt',
    '/%00',
    '/%',
  ])('%s зам нь web root-ийн гаднах файлыг задруулахгүй', async (path) => {
    const res = await get(path);

    expect(res.body).not.toContain(SECRET);
    expect(res.statusCode).not.toBe(500);
  });

  it('resolveInside: ".." нь web root-оос хэзээ ч гарахгүй, хэрэггүй тэмдэгттэй зам татгалзагдана', () => {
    expect(resolveInside('/srv/web', '/a/b.js')).toBe('/srv/web/a/b.js');
    expect(resolveInside('/srv/web', '/')).toBe('/srv/web/');
    // ".." нь замыг залгахаас өмнө тэгшлэгддэг тул үр дүн үргэлж root дотор байна
    expect(resolveInside('/srv/web', '/../etc/passwd')).toBe('/srv/web/etc/passwd');
    expect(resolveInside('/srv/web', '/..%2f..%2fetc/passwd')).toBe('/srv/web/etc/passwd');
    // NUL байт эсвэл эвдэрсэн escape-ийг шууд татгалзана
    expect(resolveInside('/srv/web', '/a\0b')).toBeNull();
    expect(resolveInside('/srv/web', '/%')).toBeNull();
  });
});

describe('web: шахалт', () => {
  it('gzip дэмждэг browser-т текстийг шахаж өгнө', async () => {
    const res = await get('/assets/app-abc123.js', { 'accept-encoding': 'gzip, deflate, br' });

    expect(header(res, 'content-encoding')).toBe('gzip');
    expect(res.isBase64Encoded).toBe(true);
    expect(gunzipSync(Buffer.from(res.body as string, 'base64')).toString()).toBe(SCRIPT);
  });

  it('gzip хүсээгүй бол шахалтгүй, энгийн текстээр өгнө', async () => {
    const res = await get('/assets/app-abc123.js');

    expect(header(res, 'content-encoding')).toBeUndefined();
    expect(res.isBase64Encoded).toBe(false);
  });

  it('зураг мэт хоёртын файлыг шахахгүй, бүрэн бүтнээр нь буцаана', async () => {
    const res = await get('/logo.png', { 'accept-encoding': 'gzip' });

    expect(header(res, 'content-encoding')).toBeUndefined();
    expect(res.isBase64Encoded).toBe(true);
    expect([...Buffer.from(res.body as string, 'base64')]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  });
});

describe('web: аюулгүй байдлын header-ууд', () => {
  it('хуудас бүрт CSP, HSTS, nosniff, frame хамгаалалт орно', async () => {
    const res = await get('/');

    expect(header(res, 'strict-transport-security')).toContain('max-age=31536000');
    expect(header(res, 'x-content-type-options')).toBe('nosniff');
    expect(header(res, 'x-frame-options')).toBe('DENY');
    expect(header(res, 'referrer-policy')).toBe('no-referrer');
  });

  it('CSP нь зөвхөн өөрийн origin, Cognito, WebSocket API руу холбогдохыг зөвшөөрнө', async () => {
    const csp = header(await get('/'), 'content-security-policy');

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain(
      "connect-src 'self' https://cognito-idp.ap-southeast-2.amazonaws.com wss://ws123.execute-api.ap-southeast-2.amazonaws.com"
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('алдааны хариунд ч адил header-ууд орно', async () => {
    const res = await get('/assets/missing.js');

    expect(header(res, 'x-content-type-options')).toBe('nosniff');
  });
});
