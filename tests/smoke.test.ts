import { describe, expect, test } from "bun:test";

// Smoke test: the baseline extension factory loads and registers tools.
// (unit tests for providers land in tests/providers.test.ts once built)

describe("pi-websearch baseline", () => {
  test("manifest declares the extension entrypoint", async () => {
    const pkg = (await import("../package.json")) as {
      pi?: { extensions?: string[] };
    };
    expect(pkg.pi?.extensions).toContain("./src/index.ts");
  });

  test("stub exports a default factory function", async () => {
    const mod = (await import("../src/index.ts")) as {
      default: (pi: unknown) => void;
    };
    expect(typeof mod.default).toBe("function");
    // Factory is synchronous and registers on session_start; calling it
    // with a stub API must not throw synchronously.
    let registered = 0;
    const stubApi = {
      on: () => undefined,
      registerTool: () => {
        registered++;
      },
    };
    mod.default(stubApi as never);
    expect(registered).toBe(0); // tools registered in session_start, not factory
  });
});
