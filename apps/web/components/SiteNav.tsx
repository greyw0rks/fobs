import Link from "next/link";
import type { Route } from "next";

/**
 * The chrome for the pages outside the app: the landing, sign-in, the legal
 * page and onboarding.
 *
 * Restyled to the warm-editorial fobs look — lowercase "fobs" wordmark, warm
 * `#e3e2dc` borders on the `#f4f3ef` canvas, a black action button (data-blue is
 * reserved for data). Props, links, and structure are unchanged so moving
 * between the marketing page and the product does not feel like crossing between
 * two different sites.
 */
export function SiteNav({
  action = { href: "/feed", label: "Enter the feed" }
}: {
  /**
   * Narrowed to the two destinations these pages actually offer, because Next
   * types `<Link href>` against the generated route union — a bare `string`
   * does not satisfy it.
   */
  action?: { href: "/feed" | "/stocks"; label: string };
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#e3e2dc] bg-[#f4f3ef]/85 backdrop-blur">
      <nav
        className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4 lg:px-10"
        aria-label="Main"
      >
        <div className="hidden items-center gap-7 text-xs text-[#666761] md:flex">
          <Link href={"/stocks" as Route} className="hover:text-[#111312]">
            Markets
          </Link>
          <Link href={"/terms" as Route} className="hover:text-[#111312]">
            Terms
          </Link>
          <Link href={"/feed" as Route} className="hover:text-[#111312]">
            Feed
          </Link>
        </div>

        {/*
          An explicit accessible name because the lockup is mark-only on the
          smallest viewports; without it the link's name would shift with the
          layout.
        */}
        <Link
          href={"/" as Route}
          aria-label="fobs"
          className="text-[20px] font-bold tracking-[-0.06em] text-[#111312] md:absolute md:left-1/2 md:-translate-x-1/2"
        >
          fobs
        </Link>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full bg-[#edf5ef] px-3 py-1 text-[10px] font-medium text-[#23845b] sm:inline-flex">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#23845b]" />
            Mainnet
          </span>
          <Link className="fobs-button-primary" href={action.href as Route}>
            {action.label}
          </Link>
        </div>
      </nav>
    </header>
  );
}
