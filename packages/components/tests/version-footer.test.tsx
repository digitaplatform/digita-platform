import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { VersionFooter } from '../src/composites/VersionFooter.js';

function image(
  name: string,
  primary: string,
  version: string,
  release: string,
) {
  return {
    name,
    version,
    subpackages: [{ name: `@digitaplatform/${primary}`, version: release }],
  };
}

const auth = image('digita-auth', 'auth', '1.2.003-stable-20261003220000-a000001', '1.2.3');
const jobs = image('digita-jobs', 'jobs', '2.3.004-stable-20261003220000-a000002', '2.3.4');
const engine = image('digita-platform', 'engine', '3.4.005-stable-20261003220000-a000003', '3.4.5');
const report = image('digita-report', 'report', '4.5.006-stable-20261003220000-a000004', '4.5.6');
const frontend = {
  ...image('digita-platform', 'app', '9.8.007-stable-20261003220000-a000005', '9.8.7'),
  subpackages: [
    { name: '@digitaplatform/app', version: '9.8.7' },
    { name: '@digitaplatform/components', version: '8.1.0' },
  ],
};

const invalidPrimary: Array<[string, unknown]> = [
  ['missing BUILD_VERSION', {
    name: engine.name,
    subpackages: engine.subpackages,
  }],
  ['null reply', null],
  ['malformed version type', { ...engine, version: 345 }],
  ['trailing version newline', { ...engine, version: `${engine.version}\n` }],
  ['nonnumeric release', { ...engine, version: 'not-a-version' }],
  ['malformed subpackages', { ...engine, subpackages: 'engine' }],
  ['missing primary package', { ...engine, subpackages: [] }],
  ['extra image data', { ...engine, privateToken: 'PRIVATE_SENTINEL' }],
  ['extra package data', {
    ...engine,
    subpackages: [{
      ...engine.subpackages[0],
      privateToken: 'PRIVATE_SENTINEL',
    }],
  }],
];

type Reply = () => Promise<Response>;

async function ok(body: unknown): Promise<Response> {
  return { ok: true, json: async () => body } as Response;
}

function serve(routes: Record<string, Reply>) {
  const fetchMock = vi.fn(
    (input: RequestInfo | URL, _options?: RequestInit): Promise<Response> =>
      routes[String(input)]?.() ??
      Promise.resolve({ ok: false, status: 404 } as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function mount(
  endpoints: string[],
  initialImages: readonly unknown[] = [],
  engineSource = initialImages.length ? "server:0" : endpoints[0],
) {
  const view = render(
    <VersionFooter endpoints={endpoints} initialImages={initialImages} engineSource={engineSource} />,
  );
  await settle();
  return view;
}

function details() {
  const footer = screen.getByTestId('version-footer');
  expect(footer.tagName).toBe('DETAILS');
  return footer as HTMLDetailsElement;
}

function summary() {
  const element = details().querySelector('summary');
  if (!element) throw new Error('Missing native summary');
  return element;
}

function expectPlatformOmitted() {
  expect(summary().textContent).toBe('digita-auth 1.2.003');
  fireEvent.click(summary());

  const panel = screen.getByTestId('version-panel');
  expect(within(panel).queryByText('digita-platform')).toBeNull();
  expect(panel.textContent).not.toContain('app');
  expect(panel.textContent).not.toContain('PRIVATE_SENTINEL');
  expect(within(panel).getByText(`auth ${auth.version}`)).toBeTruthy();
}

describe('VersionFooter', () => {
it('uses the explicit own engine while retaining other engines in details', async () => {
  const other = image('digita-platform', 'engine', '7.8.009-stable-20261003220000-a000009', '7.8.9');
  serve({ '/other': () => ok(other), '/own': () => ok(engine) });
  render(<VersionFooter endpoints={['/other', '/own']} engineSource="/own" />);
  await settle();
  expect(summary().textContent).toBe('digita-platform 3.4.005');
  fireEvent.click(summary());
  const panel = within(screen.getByTestId('version-panel'));
  for (const value of [engine, other]) {
    expect(panel.getAllByText(`engine ${value.version}`)).toHaveLength(1);
  }
});

it.each([...invalidPrimary, ['unavailable', undefined], ['frontend reply', frontend]])(
  'does not substitute another engine when own source is %s',
  async (_label, value) => {
    serve({
      '/auth': () => ok(auth), '/other': () => ok(engine),
      '/frontend': () => ok(frontend),
      '/own': async () => value === undefined ? ({ ok: false } as Response) : ok(value),
    });
    render(<VersionFooter endpoints={['/own', '/other', '/auth', '/frontend']} />);
    await settle();
    expectPlatformOmitted();
  },
);

it.each([
  ['present', [engine], 'digita-auth 1.2.003 – digita-platform 3.4.005'],
  ['absent', [], 'digita-auth 1.2.003'],
  ['invalid slot', [null, engine], 'digita-auth 1.2.003'],
] as const)('uses only the own SSR slot when %s', async (_label, initialImages, expected) => {
  const other = image('digita-platform', 'engine', '7.8.009-stable-20261003220000-a000009', '7.8.9');
  serve({ '/auth': () => ok(auth), '/other': () => ok(other) });
  render(<VersionFooter endpoints={['/other', '/auth']} initialImages={initialImages} engineSource="server:0" />);
  await settle();
  expect(summary().textContent).toBe(expected);
  if (initialImages[0] == null) expectPlatformOmitted();
  else {
    fireEvent.click(summary());
    const panel = within(screen.getByTestId('version-panel'));
    for (const value of [engine, other]) {
      expect(panel.getAllByText(`engine ${value.version}`)).toHaveLength(1);
    }
  }
});

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows four numeric primary releases and each image’s actual details', async () => {
    const values = [auth, jobs, engine, report, frontend];
    const routes = Object.fromEntries(
      values.map((value, index) => [`/image/${index}`, () => ok(value)]),
    );
    serve(routes);
    await mount(Object.keys(routes), [], "/image/2");

    expect(summary().textContent).toBe(
      'digita-auth 1.2.003 – digita-jobs 2.3.004 – ' +
      'digita-platform 3.4.005 – digita-report 4.5.006',
    );
    expect(details().open).toBe(false);

    fireEvent.click(summary());
    expect(details().open).toBe(true);

    const panel = within(screen.getByTestId('version-panel'));
    for (const value of values) {
      const primary = value.subpackages[0].name.replace('@digitaplatform/', '');
      expect(panel.getByText(`${primary} ${value.version}`)).toBeTruthy();
    }

    const frontendHeading = panel.getByText(`app ${frontend.version}`);
    const frontendEntry = frontendHeading.closest('li');
    if (!frontendEntry) throw new Error('Missing frontend image entry');

    const frontendDetails = within(frontendEntry);
    expect(frontendDetails.getByText('app 9.8.7')).toBeTruthy();
    expect(frontendDetails.getByText('components 8.1.0')).toBeTruthy();
    expect(frontendDetails.queryByText('engine 9.8.7')).toBeNull();
    expect(frontendDetails.queryByText('components 9.8.7')).toBeNull();

    fireEvent.click(summary());
    expect(details().open).toBe(false);
  });

  it.each(invalidPrimary)(
    'omits a fetched primary with %s while retaining a good component',
    async (_label, value) => {
      serve({
        '/auth': () => ok(auth),
        '/engine': () => ok(value),
        '/frontend': () => ok(frontend),
      });
      await mount(['/auth', '/engine', '/frontend'], [], '/engine');
      expectPlatformOmitted();
    },
  );

  it.each(['missing endpoint', 'unreachable', 'HTTP error', 'malformed JSON'])(
    'does not substitute frontend for a primary with %s',
    async (failure) => {
      const routes: Record<string, Reply> = {
        '/auth': () => ok(auth),
        '/frontend': () => ok(frontend),
      };

      if (failure === 'unreachable') {
        routes['/engine'] = async () => {
          throw new TypeError('Network unavailable');
        };
      } else if (failure === 'HTTP error') {
        routes['/engine'] = async () =>
          ({ ok: false, status: 503 } as Response);
      } else if (failure === 'malformed JSON') {
        routes['/engine'] = async () => ({
          ok: true,
          json: async () => { throw new SyntaxError('Invalid JSON'); },
        } as Response);
      }

      serve(routes);
      await mount(failure === 'missing endpoint' ? ['/auth', '/frontend'] : ['/auth', '/engine', '/frontend'], [], '/engine');
      expectPlatformOmitted();
    },
  );

  it.each(invalidPrimary)(
    'validates a web server snapshot with %s before displaying it',
    async (_label, value) => {
      serve({});
      await mount([], [auth, value, frontend], 'server:1');
      expectPlatformOmitted();
    },
  );

  it('renders nothing when frontend is the only available image', async () => {
    serve({ '/frontend': () => ok(frontend) });
    const view = await mount(['/frontend'], [frontend]);
    expect(view.container.innerHTML).toBe('');
  });

  it('omits an unreadable live image after a successful client fetch', async () => {
    let reachable = true;
    serve({
      '/auth': () => ok(auth),
      '/engine': async () => {
        if (!reachable) throw new TypeError('Network unavailable');
        return ok(engine);
      },
    });
    await mount(['/auth', '/engine'], [], '/engine');
    expect(summary().textContent).toContain('digita-platform 3.4.005');
    reachable = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(summary().textContent).toBe('digita-auth 1.2.003');
    expectPlatformOmitted();
  });

  it('refreshes after 60 seconds without remounting', async () => {
      let current = engine;
      const fetchMock = serve({ '/engine': () => ok(current) });

      await mount(['/engine']);

      const originalFooter = details();
      fireEvent.click(summary());
      expect(originalFooter.open).toBe(true);
      expect(summary().textContent).toBe('digita-platform 3.4.005');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_999);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      current = image('digita-platform', 'engine', '3.4.006-stable-20261003220100-a000006', '3.4.6');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(details()).toBe(originalFooter);
      expect(originalFooter.open).toBe(true);
      expect(summary().textContent).toBe('digita-platform 3.4.006');

      const panel = within(screen.getByTestId('version-panel'));
      expect(panel.getAllByText(`engine ${current.version}`)).toHaveLength(1);
      expect(panel.queryByText(`engine ${engine.version}`)).toBeNull();
    }
  );

  it('keeps independent engines and refreshes public sources without remounting', async () => {
    const website = engine;
    const app = image('digita-platform', 'engine', '3.4.006-stable-20261003220100-a000006', '3.4.6');
    const other = image('digita-platform', 'engine', '3.4.007-stable-20261003220200-a000007', '3.4.7');
    let currentApp = app;
    let otherReachable = true;
    const fetchMock = serve({
      '/app/engine': () => ok(currentApp),
      '/other/engine': async () => {
        if (!otherReachable) throw new TypeError('Network unavailable');
        return ok(other);
      },
    });

    await mount(['/app/engine', '/other/engine'], [website]);
    const originalFooter = details();
    fireEvent.click(summary());
    const panel = within(screen.getByTestId('version-panel'));
    for (const value of [website, app, other]) {
      expect(panel.getAllByText(`engine ${value.version}`)).toHaveLength(1);
    }
    const websiteRow = panel.getByText(`engine ${website.version}`).closest('li');
    const appRow = panel.getByText(`engine ${app.version}`).closest('li');
    expect(summary().textContent).toBe('digita-platform 3.4.005');

    // The public engine adopts A's tag: both sources must still have a row.
    currentApp = website;
    otherReachable = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(details()).toBe(originalFooter);
    expect(originalFooter.open).toBe(true);
    expect(summary().textContent).toBe('digita-platform 3.4.005');
    const matchingRows = panel.getAllByText(`engine ${website.version}`)
      .map((heading) => heading.closest('li'));
    expect(matchingRows).toHaveLength(2);
    expect(matchingRows).toContain(websiteRow);
    expect(matchingRows).toContain(appRow);
    expect(panel.queryByText(`engine ${app.version}`)).toBeNull();
    expect(panel.queryByText(`engine ${other.version}`)).toBeNull();
  });

  it('aborts an in-flight request and removes polling on unmount', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _options?: RequestInit) =>
        new Promise<Response>(() => {}),
    );
    vi.stubGlobal('fetch', fetchMock);

    const view = render(<VersionFooter endpoints={['/engine']} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const options = fetchMock.mock.calls[0][1];
    const signal = options?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
