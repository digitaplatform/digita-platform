// Shared vitest setup. Runs for node AND jsdom suites, so everything here is
// environment-guarded.
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

if (typeof Element !== 'undefined') {
  // jsdom implements no layout/scrolling — stub the API the kit calls during
  // arrow-key navigation.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

  // Without `globals: true` RTL's automatic cleanup never registers — wire it
  // explicitly so component tests don't leak DOM into each other.
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}
