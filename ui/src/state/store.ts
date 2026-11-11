/**
 * 极简可观察 store（M0）：
 * - 一次变更 → 每个订阅者各收恰好 1 次通知（任务 2 判据）；
 * - 提供 patch / get / subscribe，不引入框架依赖。
 */

export type Listener<T> = (state: T) => void;

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (prev: T) => T): void;
  subscribe(fn: Listener<T>): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get: () => state,
    set(next: T) {
      state = next;
      // 快照遍历，避免通知过程中增删订阅者导致漏发/重发
      for (const fn of Array.from(listeners)) fn(state);
    },
    update(fn: (prev: T) => T) {
      this.set(fn(state));
    },
    subscribe(fn: Listener<T>) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}