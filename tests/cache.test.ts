import { describe, expect, test } from "bun:test";
import { TTLCache } from "../src/lib/cache";
import type { SearchArgs } from "../src/types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TTLCache", () => {
  test("set/get roundtrip and overwrite", () => {
    const cache = new TTLCache<string>();
    expect(cache.get("k")).toBeUndefined();
    cache.set("k", "v1");
    expect(cache.get("k")).toBe("v1");
    cache.set("k", "v2");
    expect(cache.get("k")).toBe("v2");
  });

  test("entries expire after ttl and get() drops them", async () => {
    const cache = new TTLCache<number>(0.05); // 50 ms
    cache.set("k", 42);
    expect(cache.get("k")).toBe(42);
    await sleep(80);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0); // expired entry was deleted on access
  });

  test("per-entry ttl override", async () => {
    const cache = new TTLCache<number>(60);
    cache.set("short", 1, 0.05);
    await sleep(80);
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("missing")).toBeUndefined();
  });

  test("prune removes only expired entries", async () => {
    const cache = new TTLCache<string>(0.05);
    cache.set("expired", "x");
    await sleep(80);
    cache.set("live", "y", 60); // per-entry override keeps it fresh
    expect(cache.prune()).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get("live")).toBe("y");
    expect(cache.get("expired")).toBeUndefined();
  });

  test("default ttl is 300s (config default)", () => {
    const cache = new TTLCache<string>();
    cache.set("k", "v");
    // Not expired moments later — just proves the entry was stored with a
    // fresh expiry, no way to wait 300s in a test.
    expect(cache.get("k")).toBe("v");
  });
});

describe("TTLCache.cacheKey", () => {
  const base: SearchArgs = {
    query: "test",
    numResults: 8,
    type: "auto",
    dateRange: "past_week",
    contextMaxCharacters: 10_000,
  };

  test("identical args → identical key", () => {
    expect(TTLCache.cacheKey("exa", base)).toBe(TTLCache.cacheKey("exa", { ...base }));
  });

  test("property order does not matter", () => {
    const reordered: SearchArgs = {
      contextMaxCharacters: base.contextMaxCharacters,
      dateRange: base.dateRange,
      type: base.type,
      numResults: base.numResults,
      query: base.query,
    };
    expect(TTLCache.cacheKey("exa", base)).toBe(TTLCache.cacheKey("exa", reordered));
  });

  test("signal is excluded from the key", () => {
    const withSignal: SearchArgs = { ...base, signal: new AbortController().signal };
    expect(TTLCache.cacheKey("exa", base)).toBe(TTLCache.cacheKey("exa", withSignal));
  });

  test("different args or providers → different keys", () => {
    expect(TTLCache.cacheKey("exa", base)).not.toBe(
      TTLCache.cacheKey("exa", { ...base, query: "other" }),
    );
    expect(TTLCache.cacheKey("exa", base)).not.toBe(TTLCache.cacheKey("brave", base));
  });

  test("explicit undefined field equals omitted field", () => {
    const withUndefined: SearchArgs = { ...base, dateRange: undefined };
    const withoutKey: SearchArgs = {
      query: base.query,
      numResults: base.numResults,
      type: base.type,
      contextMaxCharacters: base.contextMaxCharacters,
    };
    expect(TTLCache.cacheKey("exa", withUndefined)).toBe(
      TTLCache.cacheKey("exa", withoutKey),
    );
  });
});
