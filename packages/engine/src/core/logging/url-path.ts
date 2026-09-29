/**
 * A request URL without its query string, for a log line: a query can carry a
 * credential, such as the realtime socket's ?token=.
 */
export function urlPath(url: string): string {
  return url.split("?", 1)[0]!;
}
