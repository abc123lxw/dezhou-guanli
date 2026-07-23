const store = new Map();

export function cacheGet(key) {
  const item = store.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) {
    store.delete(key);
    return null;
  }
  return item.value;
}

export function cacheSet(key, value, ttlMs = 60000) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

export function cacheDel(key) {
  store.delete(key);
}

export function cacheDelPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
