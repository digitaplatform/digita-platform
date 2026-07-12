import "./globals.css";
import Link from "next/link";

/** Global 404 for paths outside any locale. Renders its own html/body because
 *  the locale layout (which carries html/body) does not apply here. */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg">Page not found</h1>
        <Link
          href="/en"
          className="mt-8 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-strong"
        >
          Go home
        </Link>
      </body>
    </html>
  );
}
