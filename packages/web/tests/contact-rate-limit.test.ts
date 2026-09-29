// The privacy page says the server keeps a sender's address in memory for up to one hour. The
// limit holds inside the window, and the address leaves memory when the window ends, with no
// further request to trigger it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { ContactRateLimit } from "../src/lib/contact-rate-limit";

const HOUR = 60 * 60 * 1000;

afterEach(() => vi.useRealTimers());

describe("ContactRateLimit", () => {
  it("PLANTED INNOCENT: five sends in the window pass, the sixth is over the limit, another address is not counted", () => {
    const limit = new ContactRateLimit(5, HOUR);
    for (let i = 0; i < 5; i++) {
      limit.recordSend("198.51.100.7");
      expect(limit.isOverLimit("198.51.100.7")).toBe(false);
    }
    limit.recordSend("198.51.100.7");
    expect(limit.isOverLimit("198.51.100.7")).toBe(true);
    expect(limit.isOverLimit("198.51.100.8")).toBe(false);
  });

  it("PLANTED DEFECT: forgets an address when its window ends, without another send", () => {
    vi.useFakeTimers();
    const limit = new ContactRateLimit(5, HOUR);
    limit.recordSend("198.51.100.7");
    vi.advanceTimersByTime(HOUR - 1);
    expect(limit.remembers("198.51.100.7")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(limit.remembers("198.51.100.7")).toBe(false);
  });

  it("counts only the sends whose window has not ended", () => {
    vi.useFakeTimers();
    const limit = new ContactRateLimit(5, HOUR);
    for (let i = 0; i < 5; i++) limit.recordSend("198.51.100.7");
    vi.advanceTimersByTime(HOUR / 2);
    limit.recordSend("198.51.100.7");
    expect(limit.isOverLimit("198.51.100.7")).toBe(true);
    vi.advanceTimersByTime(HOUR / 2);
    // The five sends of the first instant are gone; the one from half an hour ago still counts.
    expect(limit.remembers("198.51.100.7")).toBe(true);
    limit.recordSend("198.51.100.7");
    expect(limit.isOverLimit("198.51.100.7")).toBe(false);
  });
});
