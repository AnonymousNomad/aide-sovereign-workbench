export class Store<T> {
  private state: T;
  private readonly subs = new Set<(s: T) => void>();

  constructor(init: T) {
    this.state = init;
  }

  get(): T {
    return this.state;
  }

  set(updater: (prev: T) => T): void {
    this.state = updater(this.state);
    for (const fn of this.subs) fn(this.state);
  }

  subscribe(fn: (s: T) => void): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
}