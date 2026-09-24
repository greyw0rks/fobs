import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Screenshot every page at desktop and mobile, and report any page that scrolls
 * sideways. A design harness, not a test — `pnpm --dir apps/web e2e` is the one
 * that fails a build.
 *
 * Shots are viewport slices rather than whole pages. The feed is twenty
 * thousand pixels tall, and a full-page capture of it downsampled to fit a
 * screen is a grey smear that hides exactly the details worth looking at. Three
 * slices per page at native resolution is what a person can actually review.
 *
 *   BASE=http://localhost:3001 OUT=/tmp/fobs-shots \
 *     ./node_modules/.bin/tsx apps/web/scripts/shots.ts
 */

const ROUTES: [string, string][] = [
  ["/", "landing"],
  ["/stocks", "markets"],
  ["/feed", "feed"],
  ["/discover", "discover"],
  ["/friends", "friends"],
  ["/notifications", "activity"],
  ["/portfolio", "portfolio"],
  ["/asset/sNVDA", "asset"],
  ["/profile/alice", "profile"],
  ["/sign-in", "signin"],
  ["/terms", "terms"],
  ["/welcome", "welcome"]
];

/** Viewport height, and how far down the page the later slices start. */
const VIEW = { width: 1440, height: 900 };
const SLICES = 3;

async function shoot(page: Page, out: string, name: string, suffix: string) {
  for (let slice = 0; slice < SLICES; slice++) {
    const y = slice * VIEW.height;
    const reached = await page.evaluate((top) => {
      // `behavior: "instant"` overrides the `scroll-behavior: smooth` on
      // <html>, which otherwise leaves the capture part-way through the
      // animation and every slice after the first off by a few hundred pixels.
      window.scrollTo({ top, behavior: "instant" });
      return window.scrollY;
    }, y);
    await page.waitForTimeout(250);
    const file = `${out}/${name}-${suffix}${slice === 0 ? "" : `-${slice + 1}`}.png`;
    await page.screenshot({ path: file });
    console.log(`   ${file}`);
    // Past the bottom of the document, every further slice is the same frame.
    if (reached < y - 1) break;
  }
}

async function main() {
  const base = process.env.BASE ?? "http://localhost:3000";
  const out = process.env.OUT ?? "/tmp/fobs-shots";
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();

  for (const [width, suffix] of [
    [1440, "desktop"],
    [390, "mobile"]
  ] as const) {
    const page = await browser.newPage({
      viewport: { width, height: suffix === "mobile" ? 844 : VIEW.height },
      deviceScaleFactor: 2,
      /*
       * The hero rises in six staggered 750ms steps, with delays out to 0.56s.
       * Capturing at load-time caught whichever of them had not finished, which
       * put the buttons and the stats tens of pixels below where they live and
       * made every measurement taken off a screenshot a lie. Reduced motion
       * zeroes the durations, so a capture is the settled layout.
       */
      reducedMotion: "reduce"
    });

    for (const [route, name] of ROUTES) {
      const response = await page.goto(`${base}${route}`, {
        waitUntil: "networkidle"
      });
      const status = response?.status() ?? 0;
      await page.waitForTimeout(500);

      console.log(`${status} ${name}-${suffix}${status >= 400 ? "  !! ERROR" : ""}`);
      if (status >= 400) continue;

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      if (overflow > 1) {
        console.log(`   !! ${route} scrolls sideways by ${overflow}px`);
      }

      await shoot(page, out, name, suffix);
    }

    await page.close();
  }

  await browser.close();
}

main();
