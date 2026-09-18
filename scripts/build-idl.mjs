/**
 * Generate target/idl/fomo.json without the Anchor CLI's IDL step.
 *
 * Why this exists
 * ---------------
 * `anchor build` compiles the program fine, then fails while generating the IDL:
 *
 *     cargo +nightly-2024-01-30 test __anchor_private_print_idl --features idl-build
 *
 * Anchor 0.30.2 pins that nightly (cargo 1.77) for IDL generation, and this
 * dependency tree now resolves `block-buffer 0.12.1`, which declares
 * `edition2024`. Cargo 1.77 cannot parse it, so the step dies with a misleading
 * "failed to download replaced source registry `crates-io`".
 *
 * The pin is historical, not a real constraint: the same cargo invocation runs
 * clean on stable. This script reproduces it on stable and assembles the IDL
 * from the sections the test prints, which is what the CLI does internally.
 *
 * Run: pnpm idl
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const programDir = join(root, "programs", "fomo");

const cargo = join(homedir(), ".cargo", "bin", "cargo");
if (!existsSync(cargo)) {
  console.error(`cargo not found at ${cargo}. Install Rust: https://rustup.rs`);
  process.exit(1);
}

// Mirrors `[features] resolution` in Anchor.toml: when on, the IDL carries PDA
// seeds and program addresses so clients can resolve accounts themselves.
const anchorToml = readFileSync(join(root, "Anchor.toml"), "utf8");
const resolve = /^\s*resolution\s*=\s*true\s*$/m.test(anchorToml);

// The test harness prints each piece of the IDL between markers. The program
// IDL itself has no `address`, `events` or `errors`; the CLI splices those in
// from their own sections, so we do the same.
function section(log, begin, end) {
  const re = new RegExp(
    `${begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)\\n${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  const match = log.match(re);
  return match ? JSON.parse(match[1]) : null;
}

console.log("running idl-build tests on the stable toolchain…");

// `ANCHOR_IDL_BUILD_RESOLUTION` is read with `option_env!` inside the anchor-syn
// proc-macro crate, so it is baked in when anchor-syn is *compiled* — setting it
// on this process alone does nothing once anchor-syn is already built, and cargo
// has no reason to rebuild it. Whenever we are about to ask for resolution, drop
// anchor-syn's artifacts first so it really is recompiled with the value below.
// Without this the IDL silently comes back with no `pda` or `address` fields,
// and every client has to hard-code PDA derivations the IDL should carry.
if (resolve) {
  execFileSync(cargo, ["clean", "-p", "anchor-syn"], {
    cwd: programDir,
    stdio: ["ignore", "ignore", "inherit"]
  });
}

let log;
try {
  log = execFileSync(
    cargo,
    [
      "test",
      "__anchor_private_print_idl",
      "--features",
      "idl-build",
      "--",
      "--show-output",
      "--quiet"
    ],
    {
      cwd: programDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        // anchor-syn reads these instead of taking them as arguments. Without
        // PROGRAM_PATH its safety-comment lint panics with "Failed to get
        // program path"; RESOLUTION mirrors `[features] resolution` in
        // Anchor.toml.
        ANCHOR_IDL_BUILD_PROGRAM_PATH: programDir,
        // Must be the literal string "TRUE": anchor-syn compares with
        // `val == "TRUE"`, so "true" or "1" silently disable resolution.
        ANCHOR_IDL_BUILD_RESOLUTION: "TRUE"
      }
    }
  );
} catch (error) {
  // On failure the diagnostics are on stderr; stdout may still hold warnings.
  process.stderr.write(error.stderr ?? "");
  process.stdout.write(error.stdout ?? "");
  console.error("\nidl-build tests failed. Fix the compile errors above.");
  process.exit(1);
}

const program = section(log, "--- IDL begin program ---", "--- IDL end program ---");
if (!program) {
  console.error(
    "Could not find the program IDL in the test output.\n" +
      "The `idl-build` feature may be missing from programs/fomo/Cargo.toml."
  );
  process.exit(1);
}

// Double-encoded: the section holds a JSON string whose content is itself a
// quoted string, so two decodes turn `"\"Fomo…\""` into `Fomo…`.
let address = section(log, "--- IDL begin address ---", "--- IDL end address ---");
for (let i = 0; i < 2 && typeof address === "string"; i++) {
  try {
    address = JSON.parse(address);
  } catch {
    break;
  }
}
if (address) program.address = address;

const errors = section(log, "--- IDL begin errors ---", "--- IDL end errors ---");
if (errors) program.errors = errors;

const event = section(log, "--- IDL begin event ---", "--- IDL end event ---");
if (event) {
  program.events = [...(program.events ?? []), event.event];
  const known = new Set((program.types ?? []).map((t) => t.name));
  program.types = [
    ...(program.types ?? []),
    ...(event.types ?? []).filter((t) => !known.has(t.name))
  ];
}

if (!program.address) {
  console.error(
    "IDL has no program address. Check declare_id! in programs/fomo/src/lib.rs."
  );
  process.exit(1);
}

// anchor-syn emits fully-qualified Rust paths (`fomo::state::asset::Asset`)
// because it uses `get_full_path()` to disambiguate types across crates. The
// published IDL spec uses bare names, and the Anchor CLI shortens them during
// its post-processing — which is the step this script stands in for. Client
// lookup depends on it: `program.account.asset` is keyed on the bare name, and
// the Borsh coder matches accounts to their type definition by that same name.
const shortName = (name) => name.split("::").pop();

for (const section of ["accounts", "types", "events"]) {
  for (const entry of program[section] ?? []) entry.name = shortName(entry.name);
}

// Every `{"defined": {"name": …}}` reference must be shortened identically, or
// lookups miss the definitions above.
(function shortenDefinedRefs(node) {
  if (Array.isArray(node)) {
    node.forEach(shortenDefinedRefs);
    return;
  }
  if (node && typeof node === "object") {
    if (node.defined && typeof node.defined.name === "string") {
      node.defined.name = shortName(node.defined.name);
    }
    Object.values(node).forEach(shortenDefinedRefs);
  }
})(program);

const idlDir = join(root, "target", "idl");
const typeDir = join(root, "target", "types");
mkdirSync(idlDir, { recursive: true });
mkdirSync(typeDir, { recursive: true });

const idlPath = join(idlDir, "fomo.json");
writeFileSync(idlPath, `${JSON.stringify(program, null, 2)}\n`);

console.log(`wrote ${idlPath.replace(root, ".")}`);
console.log(`  address      ${program.address}`);
console.log(`  instructions ${program.instructions.map((i) => i.name).join(", ")}`);
console.log(`  accounts     ${program.accounts.length}`);
console.log(`  events       ${(program.events ?? []).map((e) => e.name.split("::").pop()).join(", ") || "none"}`);
console.log(`  errors       ${(program.errors ?? []).length}`);
console.log("\nGenerate the TypeScript types with:\n  pnpm idl:types");
