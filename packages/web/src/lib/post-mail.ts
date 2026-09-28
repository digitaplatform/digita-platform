import "server-only";

/**
 * Sends one plain-text mail through digita-post's internal send route, the request shape of
 * digita-report's PostMailAdapter. digita-post delivers the content as given and queues retries;
 * 202 means queued. No credential is sent, so only a digita-post that runs without POST_API_KEY
 * (its development mode) accepts the call.
 */
export async function sendMail(
  postUrl: string,
  mail: { from: string; to: string; subject: string; text: string },
): Promise<void> {
  const res = await fetch(`${postUrl}/api/internal/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "email", ...mail, metadata: { source: "web", type: "contact_request" } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`digita-post send-email answered HTTP ${res.status}`);
}
