import { test, expect, type Page } from "@playwright/test";

/**
 * Layout and rendering specs.
 *
 * These are the assertions `pnpm rehearse` structurally cannot make. It drives
 * the same HTTP surface the browser does and checks the data that comes back;
 * it never builds a box tree, so a page whose every class is undefined looks
 * identical to it.
 */

/** Every route a signed-out visitor can reach. */
const ROUTES = [
  "/",
  "/sign-in",
  "/terms",
  "/feed",
  "/stocks",
  "/friends",
  "/portfolio",
  "/notifications",
  "/welcome",
  "/discover",
  "/asset/sNVDA",
  "/profile/alice"
];

/** `rgb(8, 7, 12)` — the `--paper` token. There is one theme now. */
const PAPER = "rgb(8, 7, 12)";

async function bodyBackground(page: Page) {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test.describe("the dark surface", () => {
  for (const route of ROUTES) {
    test(`${route} renders on the dark surface`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should not error`).toBeLessThan(400);

      // A page rendering light-on-dark because a stray white background
      // survived a restyle is the failure this catches.
      expect(await bodyBackground(page), `${route} body`).toBe(PAPER);
    });

    /*
     * Per route rather than one sweep. Sweeping all twelve in a single test
     * took long enough on the phone project — where the same DOM paints three
     * times denser — to trip the 30s timeout, which reports as "the audit is
     * broken" rather than "this page is light".
     */
    test(`${route} paints no white surface`, async ({ page }) => {
      await page.goto(route);

      const whites = await page.evaluate(() => {
        const PAPER = [8, 7, 12];
        const parse = (c: string): number[] | null => {
          const m = c.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1].split(",").map(Number);
          return [p[0], p[1], p[2], p[3] ?? 1];
        };

        /*
         * Composite each element and its ancestors down onto `--paper` before
         * judging. Reading the raw channels instead is how this check used to
         * report `rgba(255, 255, 255, 0.03)` — the devnet pill's veil — as a
         * white surface: the numbers say 255, the pixels say near-black.
         *
         * Resolved once per element and cached against its parent, because the
         * obvious version — walk up from every element, calling
         * `getComputedStyle` at each step — is O(n · depth) forced style
         * recalcs.
         */
        const resolved = new WeakMap<Element, number[]>();
        const effective = (el: Element): number[] => {
          const cached = resolved.get(el);
          if (cached) return cached;

          const parent = el.parentElement;
          const below = parent ? effective(parent) : PAPER;
          const bg = parse(getComputedStyle(el).backgroundColor);
          const out =
            bg && bg[3] > 0
              ? [0, 1, 2].map((i) => bg[i] * bg[3] + below[i] * (1 - bg[3]))
              : below;

          resolved.set(el, out);
          return out;
        };

        const found: string[] = [];
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const out = effective(el);
          if (out.every((v) => v > 235)) {
            const cls = typeof el.className === "string" ? el.className : "";
            found.push(
              `${el.tagName.toLowerCase()}.${cls} → rgb(${out.map(Math.round).join(", ")})`
            );
          }
        }
        return found.slice(0, 5);
      });

      expect(whites, `light surfaces on ${route}`).toEqual([]);
    });
  }
});

test.describe("the chrome", () => {
  /*
   * The redesign replaced the 240px sidebar with a floating glass pill. The
   * failure mode worth guarding is the quiet one: a nav that renders but has
   * lost its blur, or a mobile pill that stays visible on desktop and eats the
   * bottom of every page.
   */

  test("the app nav is a floating pill, not a sidebar", async ({ page }) => {
    await page.goto("/feed");

    expect(await page.locator(".sidebar").count()).toBe(0);

    const nav = page.locator(".topnav").first();
    await expect(nav).toBeVisible();

    const style = await nav.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        position: getComputedStyle(el.parentElement!).position,
        radius: parseFloat(s.borderTopLeftRadius),
        blur:
          s.backdropFilter || s.getPropertyValue("-webkit-backdrop-filter")
      };
    });

    // Pinned, fully rounded, and actually blurred — the three things that make
    // it read as glass rather than as a bar.
    expect(style.position).toBe("sticky");
    expect(style.radius).toBeGreaterThan(100);
    expect(style.blur).toContain("blur");
  });

  test("the brand lockup is the middle column of the bar", async ({ page }) => {
    /*
     * The lockup — the mark plus the wordmark — is what is centred, so that is
     * what this measures. Measuring the wordmark alone reports a 20px error
     * that is not one: it is the mark and its gap, which sit to the wordmark's
     * left inside a correctly centred lockup.
     *
     * Two routes with different amounts of side content, because the thing
     * worth guarding is that the centre does not drift when one side grows.
     */
    for (const route of ["/feed", "/"]) {
      await page.goto(route);

      /*
       * One read for all three boxes, not three `boundingBox()` calls. Each
       * call is its own layout flush, and React hydration lands somewhere
       * between them under load — the bar measured before hydration widens the
       * controls and the brand after, so the arithmetic below ends up
       * comparing three different layouts. That is how this test failed once
       * in four full runs and never once in isolation. Read in a single
       * `evaluate`, they are one snapshot.
       *
       * `document.fonts.ready` first, for the same reason: Geist swaps in after
       * `load`, and the bar is a different width either side of the swap. The
       * body is a string because the esbuild `keepNames` transform breaks a
       * named function inside an `evaluate` callback.
       */
      await page.evaluate(() => document.fonts.ready);

      const boxes = await page.evaluate(`(() => {
        const box = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, width: r.width, right: r.right };
        };
        const links = document.querySelector(".topnav-links");
        return {
          bar: box(".topnav"),
          brand: box(".topnav .topnav-brand"),
          right: box(".topnav .topnav-right"),
          linksVisible: Boolean(links && links.getClientRects().length > 0)
        };
      })()`);

      const { bar, brand, right, linksVisible } = boxes as {
        bar: { x: number; width: number; right: number } | null;
        brand: { x: number; width: number; right: number } | null;
        right: { x: number; width: number; right: number } | null;
        linksVisible: boolean;
      };
      if (!bar || !brand || !right) {
        throw new Error(`nav, brand or controls not laid out on ${route}`);
      }

      expect(brand.x).toBeGreaterThanOrEqual(bar.x);

      if (linksVisible) {
        // Links left, brand centre, controls right — the design, and the
        // reason the bar is a three-column grid rather than a flex row.
        const barCentre = bar.x + bar.width / 2;
        const brandCentre = brand.x + brand.width / 2;
        expect(
          Math.abs(barCentre - brandCentre),
          `${route} brand centre ${brandCentre} vs bar centre ${barCentre}`
        ).toBeLessThan(4);
      } else {
        /*
         * Narrow bar. A centred lockup needs a column of empty space on each
         * side, and at 390px the devnet pill and the account control already
         * fill one of them — so the lockup takes the left edge instead of
         * being pushed off centre or overlapping. Asserted as a fraction of
         * the bar rather than in pixels, because the first few pixels of that
         * offset are the bar's own left padding.
         */
        expect(
          brand.x - bar.x,
          `${route} brand should sit in the left quarter of the bar`
        ).toBeLessThan(bar.width * 0.25);
      }

      // Either way it must clear the controls rather than collide with them.
      expect(
        brand.x + brand.width,
        `${route} brand overlaps the account controls`
      ).toBeLessThanOrEqual(right.x);
    }
  });

  test("the mobile pill is hidden on desktop and shown on mobile", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/feed");
    await expect(page.locator(".bottom-nav")).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".bottom-nav")).toBeVisible();
    // ...and it must not sit on top of the last card.
    await expect(page.locator(".topnav-links")).toBeHidden();
  });

  test("the current page is marked in the nav", async ({ page }) => {
    await page.goto("/friends");
    const active = page.locator(".topnav-links a.active");
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute("href", "/friends");
  });
});

test.describe("the classes that were referenced but never defined", () => {
  /*
   * `.landing`, `.hero`, `.hero-body` and `.steps` were used by five pages and
   * defined in no stylesheet, so those pages rendered as browser defaults.
   * The redesign renamed the set; these assertions are the regression guard. If
   * any of them stops resolving, the page silently reverts to a wall of
   * unstyled text and nothing else in the repo notices.
   */

  test("the landing hero is actually styled", async ({ page }) => {
    await page.goto("/");

    const word = page.locator(".hero-word");
    await expect(word).toBeVisible();

    /*
     * Display type, not body copy. The floor is 84px — five times the 16px
     * body — and it has to hold at both viewports the suite runs. The old
     * `> 100` encoded the desktop clamp and failed the phone for being a
     * phone, which made it a test of the viewport rather than of the styling.
     */
    const size = await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(84);

    /*
     * ...and it dominates the hero, which is the actual design claim. Measured
     * on the glyph run: `.hero-word` is an `<h1>`, so its own box is the full
     * column width whatever the text does, and comparing that would pass for
     * any font size at all.
     */
    const { glyphs, hero } = await word.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        glyphs: range.getBoundingClientRect().width,
        hero: el.parentElement!.getBoundingClientRect().width
      };
    });
    expect(glyphs / hero).toBeGreaterThan(0.3);

    expect(
      await page
        .locator(".hero-tagline")
        .evaluate((el) => getComputedStyle(el).textTransform)
    ).toBe("uppercase");

    // The orbital backdrop is the whole point of the scene.
    const scene = await page
      .locator(".scene")
      .evaluate((el) => getComputedStyle(el, "::before").borderRadius);
    expect(scene).toContain("50%");
  });

  test("the how-it-works list has real counters", async ({ page }) => {
    await page.goto("/");

    const steps = page.locator(".steps li");
    expect(await steps.count()).toBeGreaterThanOrEqual(4);

    /*
     * Assert the counter, not the digits. Chromium reports a computed
     * `content` for `::before` verbatim — `counter(step, decimal-leading-zero)`
     * — rather than resolving it, so `toBe('"01"')` here was asserting
     * something no browser will ever return. What can be checked is that the
     * counter is actually wired: reset on the list, incremented per item, and
     * referenced by the marker. Lose any one of those and the list renders
     * bare, which is the regression this guards.
     */
    expect(await page.locator(".steps").evaluate((el) => getComputedStyle(el).counterReset))
      .toContain("step");
    expect(await steps.first().evaluate((el) => getComputedStyle(el).counterIncrement))
      .toContain("step");

    const marker = await steps
      .first()
      .evaluate((el) => getComputedStyle(el, "::before").content);
    expect(marker).toContain("counter(step");
    expect(marker).toContain("decimal-leading-zero");
  });

  test("prose links are distinguishable from prose", async ({ page }) => {
    // The global `a { text-decoration: none }` is right for nav and cards and
    // wrong inline: on /terms it made every link read as plain text.
    await page.goto("/terms");
    const decoration = await page
      .locator(".prose-section p a")
      .first()
      .evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(decoration).toContain("underline");
  });
});

test.describe("the Buy/Sell toggle", () => {
  test("marks whichever side is selected", async ({ page }) => {
    /*
     * This one is a bug fix, not a regression guard. The stylesheet has always
     * said `.segmented button.active.buy`, and the markup only ever emitted
     * `active` — so neither rule ever matched and the control gave no
     * indication of which side was selected. The assertion is on the painted
     * background rather than on the class name, because the class name was
     * exactly what was wrong.
     */
    await page.goto("/asset/sNVDA");

    const buy = page.locator(".segmented button.buy");
    const sell = page.locator(".segmented button.sell");
    await expect(buy).toBeVisible();
    await expect(buy).toHaveClass(/active/);
    await expect(sell).not.toHaveClass(/active/);

    const paint = (locator: typeof buy) =>
      locator.evaluate((el) => getComputedStyle(el).backgroundColor);

    /*
     * Every read here must be of a *resting* control. The panel's default side
     * settles once React hydrates, so Sell can still be releasing `--down` when
     * the assertion above passed — the class is gone the instant it changes,
     * the 160ms fade is not. Under a full suite's load that window is wide
     * enough for a bare read to catch a mid-fade green and call it "idle", and
     * then the post-click assertion at the bottom compares against a value the
     * control never rests at. This failed exactly once in four full runs, and
     * only ever on the mobile project. So: wait for the paint to stop moving
     * before believing it.
     */
    const settledPaint = async (locator: typeof buy) => {
      let previous = await paint(locator);
      for (let attempt = 0; attempt < 20; attempt++) {
        await page.waitForTimeout(50);
        const next = await paint(locator);
        if (next === previous) return next;
        previous = next;
      }
      throw new Error(`background never settled; last read ${previous}`);
    };

    /*
     * The unselected background is read from *Sell*. Buy is active on load, so
     * reading it first and calling the result "idle" compared the selected
     * state against itself and made the first assertion below unfalsifiable.
     */
    const idle = await settledPaint(sell);
    const buyOn = await settledPaint(buy);
    expect(buyOn).not.toBe(idle);

    await sell.click();
    await expect(sell).toHaveClass(/active/);
    await expect(buy).not.toHaveClass(/active/);

    /*
     * `toHaveCSS` retries where a bare read does not. The control fades its
     * background, so reading straight after the click caught the released side
     * at 2.7% opacity — a green that is on its way to transparent, not the
     * unselected paint. Waiting for one side to land is enough: both fades
     * start on the same click and run for the same time.
     */
    await expect(buy).toHaveCSS("background-color", idle);

    const sellOn = await paint(sell);
    expect(sellOn).not.toBe(idle);
    expect(sellOn).not.toBe(buyOn);
  });
});

test.describe("keyboard", () => {
  test("focus is visible", async ({ page }) => {
    // The app shipped no focus style at all: tab moved focus and nothing said
    // where it went.
    await page.goto("/feed");
    await page.keyboard.press("Tab");

    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, width: s.outlineWidth, style: s.outlineStyle };
    });

    expect(ring, "tab should land on something focusable").not.toBeNull();
    expect(ring!.style).not.toBe("none");
    expect(parseFloat(ring!.width)).toBeGreaterThanOrEqual(2);
  });

  test("every nav destination is reachable by tab", async ({ page }) => {
    await page.goto("/feed");

    const expected = [
      "/feed",
      "/discover",
      "/friends",
      "/stocks",
      "/notifications",
      /*
       * Portfolio is in the top bar only. The mobile pill leaves it out —
       * five destinations is what fits, and it carries a "You" link to the
       * profile in the same row — so on a phone it is genuinely not a tab
       * stop, and asserting it there would be asserting a bug.
       */
      ...((await page.locator(".topnav-links").isVisible()) ? ["/portfolio"] : [])
    ];

    /*
     * Tab until every destination has been seen, with a ceiling so a focus trap
     * fails the test rather than hanging it. The old loop stopped at five
     * distinct hrefs — one fewer than the bar has links — so it always broke
     * before reaching Activity and then failed on it.
     */
    const seen = new Set<string>();
    for (let i = 0; i < 40 && !expected.every((href) => seen.has(href)); i++) {
      await page.keyboard.press("Tab");
      const href = await page.evaluate(
        () =>
          (document.activeElement as HTMLAnchorElement | null)?.getAttribute?.("href") ??
          null
      );
      if (href) seen.add(href);
    }

    for (const href of expected) {
      expect([...seen], `tab should reach ${href}`).toContain(href);
    }
  });
});

test.describe("figures", () => {
  test("prices use tabular mono figures", async ({ page }) => {
    // The point of the type system: a column of prices should be a column.
    await page.goto("/stocks");
    const style = await page
      .locator(".data-row .num")
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, variant: s.fontVariantNumeric };
      });

    expect(style.family.toLowerCase()).toContain("mono");
    expect(style.variant).toContain("tabular-nums");
  });

  test("the market table is a table on desktop and a stack on mobile", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/stocks");
    await expect(page.locator(".data-head")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    // The header row is hidden when the body rows restack into pairs.
    await expect(page.locator(".data-head")).toBeHidden();
  });
});

test.describe("overflow", () => {
  /*
   * Runs at 1280px in the `desktop` project and at 390px in `mobile`. A page
   * that scrolls sideways is the single most common way a redesigned layout
   * breaks on a phone, and it is invisible in a screenshot of the top of the
   * page. `rehearse` cannot see it at all.
   *
   * The landing is the riskiest one: its planet is 190vw wide, and anything
   * that fails to clip it turns the whole document into a horizontal scroller.
   */

  for (const route of ROUTES) {
    test(`${route} does not scroll sideways`, async ({ page }) => {
      await page.goto(route);
      // Fonts and any late layout must settle before measuring.
      await page.waitForLoadState("networkidle");

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const scrolls = doc.scrollWidth - doc.clientWidth;
        if (scrolls <= 1) return { scrolls, culprits: [] as string[] };

        // Name the widest offenders rather than just reporting a number.
        const culprits = Array.from(document.querySelectorAll("*"))
          .map((el) => ({ el, rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.right > doc.clientWidth + 1 && rect.width > 0)
          .sort((a, b) => b.rect.right - a.rect.right)
          .slice(0, 5)
          .map(({ el, rect }) => {
            const cls = typeof el.className === "string" ? el.className : "";
            return `${el.tagName.toLowerCase()}.${cls} right=${Math.round(rect.right)}`;
          });

        return { scrolls, culprits };
      });

      expect(overflow.scrolls, `culprits: ${overflow.culprits.join(" | ")}`).toBeLessThanOrEqual(1);
    });
  }
});
