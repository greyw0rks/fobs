import { test, expect, type Page } from "@playwright/test";

/**
 * Contrast.
 *
 * A dark theme is the easiest way to ship an inaccessible interface by
 * accident: every colour you pick looks fine on a near-black surface in a
 * screenshot, and the ones that fail are the quiet greys — the timestamp, the
 * unit label, the "price not read" fallback — which are exactly the text this
 * app cannot afford to have unreadable, because so much of it is disclosure.
 *
 * So this measures rather than eyeballs: it walks the real elements, resolves
 * each one's effective background by climbing the tree, and computes the WCAG
 * ratio. The palette was designed against these numbers by hand; this is what
 * stops a later tweak from quietly undoing them.
 *
 * The threshold is AA for normal text (4.5:1). Large text (>= 24px, or >= 18.66px
 * bold) is allowed 3:1, which is the WCAG rule rather than a concession.
 */

const ROUTES = ["/", "/sign-in", "/terms", "/feed", "/stocks", "/friends", "/asset/sNVDA"];

type Finding = {
  selector: string;
  text: string;
  ratio: number;
  required: number;
  color: string;
  background: string;
};

/** Injected into the page: compute every visible text element's contrast. */
function audit(): Finding[] {
  const parse = (c: string): [number, number, number, number] | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((v) => parseFloat(v));
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  };

  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const luminance = ([r, g, b]: [number, number, number, number]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  const ratio = (a: [number, number, number, number], b: [number, number, number, number]) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  /** The first opaque background at or above this element, composited down. */
  const effectiveBackground = (el: Element): [number, number, number, number] => {
    const stack: [number, number, number, number][] = [];
    let node: Element | null = el;
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg[3] > 0) {
        stack.push(bg);
        if (bg[3] === 1) break;
      }
      node = node.parentElement;
    }
    // Start from the page default and composite each layer over it.
    let out: [number, number, number, number] = [11, 13, 14, 1];
    for (const layer of stack.reverse()) {
      const a = layer[3];
      out = [
        layer[0] * a + out[0] * (1 - a),
        layer[1] * a + out[1] * (1 - a),
        layer[2] * a + out[2] * (1 - a),
        1
      ];
    }
    return out;
  };

  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    // Only elements that render their own text.
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() ?? "")
      .join(" ")
      .trim();
    if (!own) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.opacity === "0") continue;

    const color = parse(s.color);
    if (!color) continue;

    const fontSize = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const isLarge =
      fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const required = isLarge ? 3 : 4.5;

    const background = effectiveBackground(el);
    const r = ratio(color, background);

    const selector = `${el.tagName.toLowerCase()}.${
      typeof el.className === "string" ? el.className.split(" ").filter(Boolean).join(".") : ""
    }`;
    const key = `${selector}|${own.slice(0, 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fmt = (c: [number, number, number, number]) =>
      `rgb(${c.slice(0, 3).map((v) => Math.round(v)).join(", ")})`;

    if (r < required) {
      findings.push({
        selector: selector.replace(/\.$/, ""),
        text: own.slice(0, 60),
        ratio: Math.round(r * 100) / 100,
        required,
        color: fmt(color),
        background: fmt(background)
      });
    }
  }

  return findings;
}

test.describe("contrast", () => {
  for (const route of ROUTES) {
    test(`${route} meets WCAG AA`, async ({ page }: { page: Page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const findings = await page.evaluate(audit);

      const report = findings
        .map(
          (f) =>
            `  ${f.ratio}:1 (needs ${f.required}:1)  ${f.selector}\n` +
            `      "${f.text}"\n` +
            `      ${f.color} on ${f.background}`
        )
        .join("\n");

      expect(
        findings,
        findings.length === 0 ? "" : `\n${findings.length} below AA on ${route}:\n${report}\n`
      ).toEqual([]);
    });
  }
});
