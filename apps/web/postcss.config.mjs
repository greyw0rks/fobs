/**
 * PostCSS is new to this app — the live UI is hand-authored CSS in
 * `app/globals.css` and needs none of this. Tailwind is added only for the
 * isolated `/design` gallery (the spec's `components/fobs/*` system).
 *
 * Tailwind's PostCSS plugin only rewrites files that actually contain
 * `@tailwind`/`@apply` directives, so `globals.css` passes through untouched;
 * autoprefixer over it is harmless (Next already ran it). Preflight — the part
 * that would reset the live app's elements — is disabled in tailwind.config.ts,
 * and Tailwind's generated utilities only match classes we apply under
 * `/design`, so nothing here reaches the real pages.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
