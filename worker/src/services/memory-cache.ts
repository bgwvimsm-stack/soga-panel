// src/services/memory-cache.ts - 内存缓存实现

export interface CachedItem<T = unknown> {
  value: T;
  expiry: number | null;
}

export class MemoryCache {
  private readonly cache: Map<string, CachedItem> = new Map();
  private readonly timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  get<T = unknown>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;

    if (item.expiry !== null && Date.now() > item.expiry) {
      this.delete(key);
      return null;
    }

    return item.value as T;
  }

  set<T = unknown>(key: string, value: T, ttl = 300): void {
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const expiry = ttl && ttl > 0 ? Date.now() + ttl * 1000 : null;
    this.cache.set(key, { value, expiry });

    if (ttl && ttl > 0) {
      const timer = setTimeout(() => {
        this.delete(key);
      }, ttl * 1000);
      this.timers.set(key, timer);
    } else {
      this.timers.delete(key);
    }
  }

  delete(key: string): void {
    this.cache.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  clear(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.cache.clear();
    this.timers.clear();
  }

  entries(): IterableIterator<[string, CachedItem]> {
    return this.cache.entries();
  }
}

export const memoryCache = new MemoryCache();
