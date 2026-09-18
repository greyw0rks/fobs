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
  "/asset/sNVDA",
  "/profile/alice"
];

/** `rgb(11, 13, 14)` — the `--paper` token. */
const PAPER = "rgb(11, 13, 14)";

async function bodyBackground(page: Page) {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test.describe("dark theme", () => {
  for (const route of ROUTES) {
    test(`${route} renders on the dark surface`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should not error`).toBeLessThan(400);

      // No page should be rendering light-on-dark because `color-scheme` was
      // left unset, or because a stray white background survived the restyle.
      expect(await bodyBackground(page), `${route} body`).toBe(PAPER);
    });
  }

  test("no page paints a white surface", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      const whites = await page.evaluate(() => {
        const found: string[] = [];
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const bg = getComputedStyle(el).backgroundColor;
          // Skip the fully transparent, which is most of the tree.
          if (bg === "rgba(0, 0, 0, 0)") continue;
          const [r, g, b] = bg.match(/\d+/g)!.map(Number);
          if (r > 235 && g > 235 && b > 235) {
            found.push(`${el.tagName.toLowerCase()}.${el.className || "(none)"} → ${bg}`);
          }
        }
        return found.slice(0, 5);
      });
      expect(whites, `light surfaces on ${route}`).toEqual([]);
    }
  });
});

test.describe("the classes that were referenced but never defined", () => {
  /*
   * `.landing`, `.hero`, `.hero-body`, `.landing-section` and `.steps` were
   * used by five pages and defined in no stylesheet, so those pages rendered as
   * browser defaults. These assertions are the regression guard: if any of them
   * stops resolving, the page silently reverts to a wall of unstyled text and
   * nothing else in the repo notices.
   */

  test("the landing page is actually styled", async ({ page }) => {
    await page.goto("/");

    expect(
      await page.locator(".landing").evaluate((el) => getComputedStyle(el).maxWidth)
    ).toBe("760px");

    expect(
      await page.locator(".hero").first().evaluate((el) => getComputedStyle(el).borderBottomWidth)
    ).toBe("1px");

    expect(
      await page.locator(".hero-body h2").evaluate((el) => getComputedStyle(el).fontSize)
    ).toBe("40px");

    expect(
      await page
        .locator(".landing-section h3")
        .first()
        .evaluate((el) => getComputedStyle(el).textTransform)
    ).toBe("uppercase");
  });

  test("the how-it-works list has real counters", async ({ page }) => {
    await page.goto("/");

    const steps = page.locator(".steps li");
    expect(await steps.count()).toBeGreaterThanOrEqual(4);

    // The counter is the whole reason .steps is a class and not a bare <ol>.
    const first = await steps.first().evaluate(
      (el) => getComputedStyle(el, "::before").content
    );
    expect(first).toBe('"01"');

    const second = await steps.nth(1).evaluate(
      (el) => getComputedStyle(el, "::before").content
    );
    expect(second).toBe('"02"');
  });

  test("prose links are distinguishable from prose", async ({ page }) => {
    // The global `a { text-decoration: none }` is right for nav and cards and
    // wrong inline: on /terms it made every link read as plain text.
    await page.goto("/terms");
    const decoration = await page
      .locator(".landing-section p a")
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

    const idle = await buy.evaluate((el) => getComputedStyle(el).backgroundColor);

    await expect(buy).toHaveClass(/active/);
    const buyOn = await buy.evaluate((el) => getComputedStyle(el).backgroundColor);

    await sell.click();
    await expect(sell).toHaveClass(/active/);
    await expect(buy).not.toHaveClass(/active/);

    const sellOn = await sell.evaluate((el) => getComputedStyle(el).backgroundColor);
    const buyOff = await buy.evaluate((el) => getComputedStyle(el).backgroundColor);

    // Selected and unselected must actually look different, and the two
    // selected states must differ from each other.
    expect(buyOn).not.toBe(idle);
    expect(buyOff).not.toBe(buyOn);
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

    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const href = await page.evaluate(
        () => (document.activeElement as HTMLAnchorElement | null)?.getAttribute?.("href") ?? null
      );
      if (href) seen.add(href);
      if (seen.size >= 5) break;
    }

    for (const expected of ["/feed", "/friends", "/stocks", "/portfolio", "/notifications"]) {
      expect([...seen], `tab should reach ${expected}`).toContain(expected);
    }
  });
});

test.describe("figures", () => {
  test("prices use tabular mono figures", async ({ page }) => {
    // The point of the type system: a column of prices should be a column.
    await page.goto("/stocks");
    const style = await page
      .locator(".asset-row .num")
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, variant: s.fontVariantNumeric };
      });

    expect(style.family.toLowerCase()).toContain("mono");
    expect(style.variant).toContain("tabular-nums");
  });
});

test.describe("overflow", () => {
  /*
   * Runs at 1280px in the `desktop` project and at 390px in `mobile`. A page
   * that scrolls sideways is the single most common way a redesigned layout
   * breaks on a phone, and it is invisible in a screenshot of the top of the
   * page. `rehearse` cannot see it at all.
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
