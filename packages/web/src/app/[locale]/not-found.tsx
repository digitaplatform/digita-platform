import Link from "next/link";

/** In-locale 404 — rendered inside the locale chrome (header/footer). */
export default function LocaleNotFound() {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-32 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg">Page not found</h1>
      <p className="mt-3 text-fg-muted">The page you’re looking for doesn’t exist or was moved.</p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-strong"
      >
        Go home
      </Link>
    </section>
  );
}
