import "server-only";

/**
 * Sends one plain-text mail through digita-post's internal send route, the request shape of
 * digita-report's PostMailAdapter. digita-post delivers the content as given and queues retries;
 * 202 means queued. The route checks the platform's POST_API_KEY in X-Api-Key.
 */
export async function sendMail(
  post: { postUrl: string; postApiKey: string },
  mail: { from: string; to: string; subject: string; text: string },
): Promise<void> {
  const res = await fetch(`${post.postUrl}/api/internal/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": post.postApiKey },
    body: JSON.stringify({ channel: "email", ...mail, metadata: { source: "web", type: "contact_request" } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`digita-post send-email answered HTTP ${res.status}`);
}
