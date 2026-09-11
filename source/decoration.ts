import { getContext } from './text.js';

export interface SourceRange {
	readonly start: number;
	readonly end: number;
}

export type SourceDecorationLayer = 'behind-text' | 'above-text';

export interface SourceDecorationFragment {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly line: number;
	readonly start: number;
	readonly end: number;
}

export interface SourceDecorationPaintContext<T> {
	readonly context: CanvasRenderingContext2D;
	readonly fragments: readonly SourceDecorationFragment[];
	readonly value: T;
}

export interface SourceDecorationLayerOptions<T> {
	readonly layer: SourceDecorationLayer;
	readonly order?: number;
	readonly paint: (context: SourceDecorationPaintContext<T>) => void;
}

export interface SourceDecoration<T> {
	readonly range: SourceRange;
	readonly value: T;
}

export interface SourceDecorationHandle<T> {
	update(decoration: SourceDecoration<T>): void;
	invalidate(): void;
	remove(): void;
}

export interface SourceDecorationSet<T> {
	add(decoration: SourceDecoration<T>): SourceDecorationHandle<T>;
	replaceAll(decorations: readonly SourceDecoration<T>[]): void;
	clear(): void;
	dispose(): void;
}

export interface SourceDecorationsFeature {
	create<T>(options: SourceDecorationLayerOptions<T>): SourceDecorationSet<T>;
}

type SourceDecorationChange = {
	readonly start: number;
	readonly end: number;
	readonly text: string;
};

interface DecorationEntry<T> {
	decoration: SourceDecoration<T>;
	removed: boolean;
}

interface DecorationCollection {
	readonly layer: SourceDecorationLayer;
	readonly order: number;
	paint(context: CanvasRenderingContext2D): void;
	replaced(change: SourceDecorationChange): void;
	reset(): void;
}

type DecorationSurface = ReturnType<typeof createSurface>;

export interface SourceDecorationRenderer extends SourceDecorationsFeature {
	readonly aboveCanvas: HTMLCanvasElement;
	readonly behindCanvas: HTMLCanvasElement;
	render(): void;
	replaced(change: SourceDecorationChange): void;
	reset(): void;
}

export function sourceDecorations(
	host: HTMLElement,
	fragments: (range: SourceRange) => readonly SourceDecorationFragment[],
	viewport: () => SourceRange,
): SourceDecorationRenderer {
	const behind = createSurface('decorations-behind');
	const above = createSurface('decorations-above');
	const collections: DecorationCollection[] = [];

	function changed() {
		render();
	}

	function create<T>(options: SourceDecorationLayerOptions<T>) {
		const entries: DecorationEntry<T>[] = [];
		const maxEnds: number[] = [];
		let disposed = false;
		let indexed = false;

		function remove(entry: DecorationEntry<T>, repaint = true) {
			if (entry.removed) return;
			entry.removed = true;
			const index = entries.indexOf(entry);
			if (index !== -1) entries.splice(index, 1);
			indexed = false;
			if (repaint) changed();
		}

		function prepare() {
			if (indexed) return;
			entries.sort(
				(a, b) =>
					a.decoration.range.start - b.decoration.range.start,
			);
			maxEnds.length = entries.length;
			let end = 0;
			for (const [index, entry] of entries.entries()) {
				end = Math.max(end, entry.decoration.range.end);
				maxEnds[index] = end;
			}
			indexed = true;
		}

		function add(decoration: SourceDecoration<T>) {
			const entry = {
				decoration: normalize(decoration),
				removed: false,
			};
			entries.push(entry);
			indexed = false;
			changed();
			return {
				update(value: SourceDecoration<T>) {
					if (entry.removed) return;
					entry.decoration = normalize(value);
					indexed = false;
					changed();
				},
				invalidate: changed,
				remove: () => remove(entry),
			};
		}

		const collection: DecorationCollection = {
			layer: options.layer,
			order: options.order ?? 0,
			paint(context) {
				prepare();
				const visibleRange = viewport();
				let low = 0;
				let high = maxEnds.length;
				while (low < high) {
					const middle = (low + high) >> 1;
					if ((maxEnds[middle] ?? 0) <= visibleRange.start)
						low = middle + 1;
					else high = middle;
				}
				for (let index = low; index < entries.length; index++) {
					const entry = entries[index];
					if (!entry) break;
					if (entry.decoration.range.start >= visibleRange.end) break;
					const visible = fragments(entry.decoration.range).filter(
						fragment =>
							fragment.y + fragment.height > 0 &&
							fragment.y < host.clientHeight &&
							fragment.x + fragment.width > 0 &&
							fragment.x < host.clientWidth,
					);
					if (!visible.length) continue;
					context.save();
					context.beginPath();
					context.rect(0, 0, host.clientWidth, host.clientHeight);
					context.clip();
					try {
						options.paint({
							context,
							fragments: visible,
							value: entry.decoration.value,
						});
					} finally {
						context.restore();
					}
				}
			},
			replaced(change) {
				const delta = change.text.length - (change.end - change.start);
				for (const entry of [...entries]) {
					const { range, value } = entry.decoration;
					if (range.end <= change.start) continue;
					if (range.start >= change.end) {
						entry.decoration = {
							range: {
								start: range.start + delta,
								end: range.end + delta,
							},
							value,
						};
					} else remove(entry, false);
				}
				indexed = false;
			},
			reset() {
				for (const entry of entries) entry.removed = true;
				entries.length = 0;
				indexed = false;
			},
		};
		collections.push(collection);

		return {
			add,
			replaceAll(decorations: readonly SourceDecoration<T>[]) {
				collection.reset();
				for (const decoration of decorations)
					entries.push({
						decoration: normalize(decoration),
						removed: false,
					});
				changed();
			},
			clear() {
				collection.reset();
				changed();
			},
			dispose() {
				if (disposed) return;
				disposed = true;
				collection.reset();
				const index = collections.indexOf(collection);
				if (index !== -1) collections.splice(index, 1);
				changed();
			},
		};
	}

	function paint(surface: DecorationSurface, layer: SourceDecorationLayer) {
		const context = resize(surface);
		for (const collection of collections
			.filter(item => item.layer === layer)
			.sort((a, b) => a.order - b.order))
			collection.paint(context);
	}

	function render() {
		paint(behind, 'behind-text');
		paint(above, 'above-text');
	}

	function replaced(change: SourceDecorationChange) {
		for (const collection of collections) collection.replaced(change);
	}

	function reset() {
		for (const collection of collections) collection.reset();
		render();
	}

	return {
		aboveCanvas: above.canvas,
		behindCanvas: behind.canvas,
		create,
		render,
		replaced,
		reset,
	};
}

function normalize<T>(decoration: SourceDecoration<T>): SourceDecoration<T> {
	return {
		range: {
			start: Math.min(decoration.range.start, decoration.range.end),
			end: Math.max(decoration.range.start, decoration.range.end),
		},
		value: decoration.value,
	};
}

function createSurface(part: string) {
	const { canvas, context } = getContext();
	canvas.setAttribute('part', part);
	canvas.setAttribute('aria-hidden', 'true');
	return { canvas, context };
}

function resize({ canvas, context }: DecorationSurface) {
	const host = canvas.parentElement;
	const dpr = window.devicePixelRatio || 1;
	const width = (host?.clientWidth ?? 0) * dpr;
	const height = (host?.clientHeight ?? 0) * dpr;
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
		context.scale(dpr, dpr);
	} else context.clearRect(0, 0, canvas.width, canvas.height);
	return context;
}
