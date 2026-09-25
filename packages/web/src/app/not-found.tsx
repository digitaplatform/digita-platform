import "./globals.css";
import Link from "next/link";
import { buttonAttributes } from "@digitaplatform/components";
import favicon from "@digitaplatform/theme/favicon.svg";

/** Global 404 for paths outside any locale. Renders its own html/body because
 *  the locale layout (which carries html/body) does not apply here. */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href={favicon.src} />
      </head>
      <body className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center font-sans text-textMain">
        <p className="text-sm font-medium text-primary-600">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-textMain">Page not found</h1>
        <Link
          href="/en"
          {...buttonAttributes({ className: "mt-8" })}
        >
          Go home
        </Link>
      </body>
    </html>
  );
}
