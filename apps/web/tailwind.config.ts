import type { Config } from "tailwindcss";

/**
 * The Fobs frame system (`components/fobs/*`) is now the product's UI, so
 * Tailwind utilities are generated across the whole app.
 *
 * One deliberate constraint remains:
 *
 *   · `preflight` is off. Preflight is Tailwind's global element reset — it would
 *     wipe the app's heading margins, list styles and form defaults that
 *     `globals.css` still supplies. We don't need it: `globals.css` already sets
 *     `box-sizing: border-box` on `*` and normalises `a`/`button`/`input`, which
 *     is everything the frame components rely on. Utilities (specificity 0,1,0)
 *     still win over any bare element rule in `globals.css` (0,0,1).
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      fontFamily: {
        // Falls back through the app's self-hosted Geist (--font-sans) so the
        // gallery matches the product; Inter is named for spec fidelity.
        sans: [
          "var(--font-sans)",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};

export default config;
