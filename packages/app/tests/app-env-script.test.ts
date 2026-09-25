// The image's start script (docker/app-env.sh), run against a temporary web root and a copy of the
// real nginx.conf: the CSP allows exactly the origins of the page's IdP, jobs and report URLs, in
// the host layout (hosts of their own) and in the path layout (the page's own host), and a value
// that is not a plain URL stops the start before it reaches a response header.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../docker/app-env.sh', import.meta.url));
const realConf = fileURLToPath(new URL('../../../docker/nginx-app.conf', import.meta.url));
const slash = (p: string) => p.replace(/\\/g, '/');

function stage() {
  const dir = mkdtempSync(join(tmpdir(), 'ui-env-'));
  writeFileSync(join(dir, 'index.html'), '<html><head><base href="/" /></head></html>');
  writeFileSync(join(dir, 'env.js'), '');
  copyFileSync(realConf, join(dir, 'nginx.conf'));
  return dir;
}

function run(dir: string, env: Record<string, string>) {
  return spawnSync('sh', [slash(script)], {
    env: { ...process.env, APP_ENV_HTML: slash(dir), APP_ENV_NGINX_CONF: slash(join(dir, 'nginx.conf')), AUTH_COOKIE_SUFFIX: 'g1', ...env },
    encoding: 'utf8',
  });
}

const cspHeader = (dir: string) =>
  readFileSync(join(dir, 'nginx.conf'), 'utf8').split('\n').find((l) => l.includes('add_header Content-Security-Policy')) ?? '';
const csp = (dir: string, directive: string) => cspHeader(dir).match(new RegExp(`${directive} ([^;]*);`))?.[1];

// Each case starts a shell; on Windows under a parallel test run that alone can pass vitest's
// default 5 s.
describe('docker/app-env.sh', { timeout: 30_000 }, () => {
  it('allows the IdP, jobs and report hosts of the host layout, and keeps the page at the root', () => {
    const dir = stage();
    const r = run(dir, {
      APP_BASE_PATH: '/',
      AUTH_URL: 'https://auth.acme.example',
      JOBS_URL: 'https://jobs.acme.example',
      REPORT_URL: 'https://report.acme.example',
    });
    expect(r.status, r.stderr).toBe(0);
    const origins = "'self' https://auth.acme.example https://jobs.acme.example https://report.acme.example";
    expect(csp(dir, 'connect-src')).toBe(origins);
    expect(csp(dir, 'frame-src')).toBe(origins);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('<base href="/" />');
  });

  it('names the one host of the path layout once, and puts the page under its path', () => {
    const dir = stage();
    const r = run(dir, {
      APP_BASE_PATH: '/erp',
      AUTH_URL: 'https://acme.example/auth',
      JOBS_URL: 'https://acme.example/jobs',
      REPORT_URL: 'https://acme.example/report',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(csp(dir, 'connect-src')).toBe("'self' https://acme.example");
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('<base href="/erp/" />');
    expect(readFileSync(join(dir, 'env.js'), 'utf8')).toContain('window.__AUTH_URL__="https://acme.example/auth";');
  });

  it('keeps a port in the origin, and starts again in the same container', () => {
    const dir = stage();
    const env = { APP_BASE_PATH: '/erp', AUTH_URL: 'http://localhost:8080/auth', JOBS_URL: 'http://localhost:8080/jobs', REPORT_URL: 'http://localhost:8080/report' };
    expect(run(dir, env).status).toBe(0);
    const second = run(dir, env);
    expect(second.status, second.stderr).toBe(0);
    expect(csp(dir, 'connect-src')).toBe("'self' http://localhost:8080");
  });

  it('refuses a value that would write more than an origin into the CSP header', () => {
    const dir = stage();
    const r = run(dir, {
      APP_BASE_PATH: '/erp',
      AUTH_URL: "https://acme.example/auth; script-src 'unsafe-inline'",
      JOBS_URL: 'https://acme.example/jobs',
      REPORT_URL: 'https://acme.example/report',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('AUTH_URL must be a plain http(s) URL');
    expect(csp(dir, 'connect-src')).toBe("'self' __SERVICE_ORIGINS__");
  });
});
