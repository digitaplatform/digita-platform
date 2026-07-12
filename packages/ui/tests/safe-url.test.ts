// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { safeHttpUrl } from '@/lib/safe-url';

describe('safeHttpUrl', () => {
  it('allows http(s) and relative URLs', () => {
    expect(safeHttpUrl('https://example.com/f.pdf')).toBe('https://example.com/f.pdf');
    expect(safeHttpUrl('http://example.com/f.pdf')).toBe('http://example.com/f.pdf');
    expect(safeHttpUrl('/api/v1/file/abc')).toBe('/api/v1/file/abc');
    expect(safeHttpUrl('files/x.png')).toBe('files/x.png');
  });

  it('blocks executable / non-http schemes (stored-XSS sinks)', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('JavaScript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHttpUrl('vbscript:msgbox(1)')).toBeUndefined();
  });

  it('returns undefined for empty / non-string input', () => {
    expect(safeHttpUrl('')).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(42)).toBeUndefined();
  });
});
