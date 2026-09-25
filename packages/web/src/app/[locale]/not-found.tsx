import Link from "next/link";
import { buttonAttributes } from "@digitaplatform/components";

/** In-locale 404 — rendered inside the locale chrome (header/footer). */
export default function LocaleNotFound() {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-32 text-center">
      <p className="text-sm font-medium text-primary-600">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-textMain">Page not found</h1>
      <p className="mt-3 text-textMuted">The page you’re looking for doesn’t exist or was moved.</p>
      <Link
        href="/"
        {...buttonAttributes({ className: "mt-8" })}
      >
        Go home
      </Link>
    </section>
  );
}
