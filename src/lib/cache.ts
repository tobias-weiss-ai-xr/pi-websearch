import type { SearchArgs } from "../types";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Minimal TTL cache for provider calls. Not a LRU — hits do not refresh
 * expiry; entries simply expire after `ttlSeconds` (per-entry override via
 * `set(key, value, ttlSeconds)`).
 */
export class TTLCache<T = unknown> {
  private entries = new Map<string, Entry<T>>();

  constructor(private ttlSeconds = 300) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds?: number): void {
    const ttl = ttlSeconds ?? this.ttlSeconds;
    this.entries.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    // ponytail: hard cap instead of LRU — raise if hit rates suffer
    if (this.entries.size > 1000) this.prune();
  }

  /** Remove all expired entries; returns how many were removed. */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Stable cache key: identical args produce identical keys regardless of
   * property order; `signal` (AbortSignal, not serializable) is excluded.
   */
  static cacheKey(provider: string, args: SearchArgs): string {
    const { signal: _signal, ...rest } = args;
    return `${provider}:${stableStringify(rest)}`;
  }
}

/** JSON.stringify with recursively sorted object keys and undefined dropped. */
function stableStringify(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return String(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys
        .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
        .join(",")}}`;
    }
    default:
      return "null"; // undefined, function, symbol, bigint
  }
}
