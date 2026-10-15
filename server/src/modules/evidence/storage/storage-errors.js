export class StorageNotFoundError extends Error {
  constructor(key) {
    super("Stored object not found");
    this.name = "StorageNotFoundError";
    this.key = key;
  }
}

export class StorageKeyExistsError extends Error {
  constructor() {
    super("Stored object already exists");
    this.name = "StorageKeyExistsError";
  }
}
