import type { KeyValueStore } from "./types";

/** Process-local store. Tests use it to prove a second queue instance reloads the same blob. */
export class MemoryStorage implements KeyValueStore {
  private readonly items = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.items.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
  }

  async deleteItem(key: string): Promise<void> {
    this.items.delete(key);
  }
}
