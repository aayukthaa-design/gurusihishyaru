import { useSyncExternalStore } from 'react';

/**
 * Lightweight in-memory reactive store.
 * Acts as the "database" for this frontend-only app.
 * Any component can subscribe and get notified on changes.
 */

type Listener<T> = (state: T) => void;

export interface StoreApi<T> {
  getState: () => T;
  setState: (updater: T | ((prev: T) => T)) => void;
  subscribe: (listener: Listener<T>) => () => void;
}

export function createStore<T>(initial: T): StoreApi<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  function getState(): T { return state; }

  function setState(updater: T | ((prev: T) => T)) {
    state = typeof updater === 'function'
      ? (updater as (prev: T) => T)(state)
      : updater;
    listeners.forEach((listener) => listener(state));
  }

  function subscribe(listener: Listener<T>): () => void {
    listeners.add(listener);
    listener(state); // emit current value immediately
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}

export function useStoreValue<T, U = T>(
  store: StoreApi<T>,
  selector: (state: T) => U = (state) => state as unknown as U,
): U {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
