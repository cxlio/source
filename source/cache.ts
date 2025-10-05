export class Cache<K, V> {
	protected map = new Map<K, V>();

	constructor(public readonly capacity = 1000) {}

	get(key: K) {
		return this.map.get(key);
	}

	set(key: K, value: V) {
		const map = this.map;
		if (!map.has(key) && map.size >= this.capacity) {
			// Evict least recently used (first inserted)
			const oldestKey = map.keys().next().value;
			if (oldestKey !== undefined) map.delete(oldestKey);
		}
		map.set(key, value);
		return value;
	}

	[Symbol.iterator](): IterableIterator<V> {
		return this.map.values();
	}

	find(pred: (v: V) => boolean) {
		for (const x of this.map.values()) if (pred(x)) return x;
	}

	clear() {
		this.map.clear();
	}
}
