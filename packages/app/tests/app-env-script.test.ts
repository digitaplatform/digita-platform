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
    env: { ...process.env, APP_ENV_HTML: slash(dir), APP_ENV_NGINX_CONF: slash(join(dir, 'nginx.conf')), AUTH_COOKIE_SUFFIX: 'g1', VERSION_ENDPOINTS: `${env.AUTH_URL}/health`, ...env },
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
    expect(csp(dir, 'connect-src')).toBe("'self' __SERVICE_ORIGINS__ __VERSION_ORIGINS__");
  });
});


describe('version endpoint runtime config', () => {
it('allows metadata-only origins for connections, preserves explicit frames and restart', () => {
  const dir = stage();
  const env = {
    APP_BASE_PATH: '/',
    AUTH_URL: 'https://auth.acme.example',
    JOBS_URL: 'https://jobs.acme.example',
    REPORT_URL: 'https://report.acme.example',
    VERSION_ENDPOINTS: 'https://web.acme.example/health,https://web.acme.example/health/frontend,https://auth.acme.example/health',
  };
  const services = "'self' https://auth.acme.example https://jobs.acme.example https://report.acme.example";
  for (let start = 0; start < 2; start++) {
    const r = run(dir, env);
    expect(r.status, r.stderr).toBe(0);
    expect(csp(dir, 'connect-src')).toBe(`${services} https://web.acme.example`);
    expect(csp(dir, 'frame-src')).toBe(services);
    expect(cspHeader(dir)).not.toMatch(/__(SERVICE|VERSION)_ORIGINS__/);
  }
});

  it('injects only the declared metadata targets and adds their origins to CSP', () => {
    const dir = stage();
    const endpoints = 'https://web.acme.example/health,https://auth.acme.example/health';
    const r = run(dir, { APP_BASE_PATH: '/', AUTH_URL: 'https://auth.acme.example', JOBS_URL: 'https://jobs.acme.example', REPORT_URL: 'https://report.acme.example', VERSION_ENDPOINTS: endpoints });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'env.js'), 'utf8')).toContain(`window.__VERSION_ENDPOINTS__="${endpoints}";`);
    expect(csp(dir, 'connect-src')).toBe("'self' https://auth.acme.example https://jobs.acme.example https://report.acme.example https://web.acme.example");
  });
  it.each(['', 'https://ok.example/health,', 'https://ok.example/health; script-src unsafe-inline', 'https://ok.example/health,https://bad.example/health\nX-Extra: bad'])('refuses invalid endpoint config %s before writing it', (endpoints) => {
    const dir = stage();
    const r = run(dir, { APP_BASE_PATH: '/', AUTH_URL: 'https://auth.acme.example', JOBS_URL: 'https://jobs.acme.example', REPORT_URL: 'https://report.acme.example', VERSION_ENDPOINTS: endpoints });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('VERSION_ENDPOINTS');
    expect(readFileSync(join(dir, 'env.js'), 'utf8')).toBe('');
  });
});
