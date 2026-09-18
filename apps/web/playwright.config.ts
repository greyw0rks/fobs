import { defineConfig, devices } from "@playwright/test";

/**
 * The app has a `/dev` harness, `pnpm rehearse` and a dozen scripts that prove
 * the *data* is right — that a trade landed, that the indexer read the receipt,
 * that the right person was notified.
 *
 * None of them can see a pixel. Every bug this config exists to catch is one
 * that `rehearse` walks straight past: a class that is referenced in JSX and
 * defined nowhere (there were five), a control whose selected state never
 * applies because the CSS wants two classes and the markup emits one, a
 * breakpoint that clips at 375px, a focus ring that does not exist so tab moves
 * invisibly.
 *
 * So this suite asserts things about the *rendered page* only. It never
 * completes a trade — that is `rehearse`'s job — and it is not a substitute for
 * it. Chromium only, because the target is layout rather than engine behaviour
 * and three engines would triple the slowest part of the run for no extra
 * signal.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure"
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The narrow viewport is not a second test run so much as the one that
    // catches overflow, so it only runs the layout specs.
    { name: "mobile", use: { ...devices["iPhone 13"] }, testMatch: /layout\.spec\.ts/ }
  ],

  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe"
  }
});
