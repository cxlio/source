import { create, Subject, type Observable } from '@cxl/ui';
import type { BufferChange } from './buffer.js';

export interface SourceGutterLine {
	readonly row: number;
	readonly offsetTop: number;
	readonly height: number;
}

export interface SourceGutterRenderContext {
	readonly lines: readonly SourceGutterLine[];
	readonly lineCount: number;
	readonly offset: number;
}

export interface SourceGutter {
	readonly element: HTMLElement;
	readonly changes?: Observable<unknown>;
	render(context: SourceGutterRenderContext): void;
	replaced?(change: BufferChange): void;
	reset?(): void;
}

export interface SourceLineInfo {
	readonly line: number;
	readonly gutterMarkers?: Readonly<Record<string, HTMLElement>>;
}

export interface SourceGutterMarkers extends SourceGutter {
	lineInfo(line: number): SourceLineInfo;
	setGutterMarker(
		line: number,
		gutter: string,
		marker: HTMLElement | null,
	): void;
}

class LineNumbers implements SourceGutter {
	readonly element = create('div', {
		part: 'gutter line-numbers',
	});

	constructor() {
		this.element.ariaHidden = 'true';
	}

	render({ lines, lineCount, offset }: SourceGutterRenderContext) {
		this.element.style.width = `${String(lineCount).length + 1}ch`;
		this.element.replaceChildren(
			...lines.map(line => {
				const element = create('div', {
					part: 'gutter-element line-number',
					textContent: String(line.row + 1),
				});
				place(element, line, offset);
				return element;
			}),
		);
	}
}

class GutterMarkers implements SourceGutterMarkers {
	readonly element = create('div', { part: 'gutter-group markers' });
	readonly changes: Observable<unknown>;
	readonly #cells = new WeakMap<HTMLElement, HTMLElement>();
	readonly #columns = new Map<string, HTMLElement>();
	readonly #counts = new Map<string, number>();
	readonly #markers = new Map<number, Map<string, HTMLElement>>();
	readonly #subject = new Subject<void>();

	constructor() {
		this.changes = this.#subject;
	}

	lineInfo(line: number): SourceLineInfo {
		line = normalizeLine(line);
		const markers = this.#markers.get(line);
		return {
			line,
			gutterMarkers: markers ? Object.fromEntries(markers) : undefined,
		};
	}

	setGutterMarker(
		line: number,
		gutter: string,
		marker: HTMLElement | null,
	) {
		line = normalizeLine(line);
		const markers = this.#markers.get(line);
		const previous = markers?.get(gutter);
		if (marker ? previous === marker : !previous) return;
		if (previous) this.#cells.get(previous)?.remove();
		if (marker) {
			const next = markers ?? new Map<string, HTMLElement>();
			if (!previous)
				this.#counts.set(gutter, (this.#counts.get(gutter) ?? 0) + 1);
			next.set(gutter, marker);
			this.#markers.set(line, next);
		} else if (markers) {
			markers.delete(gutter);
			this.#remove(gutter);
			if (!markers.size) this.#markers.delete(line);
		}
		this.#subject.next();
	}

	render({ lines, offset }: SourceGutterRenderContext) {
		this.element.replaceChildren();
		for (const name of this.#counts.keys()) {
			const column = this.#column(name);
			for (const line of lines) {
				const marker = this.#markers.get(line.row)?.get(name);
				if (!marker) continue;
				let cell = this.#cells.get(marker);
				if (!cell) {
					cell = create('div', { part: 'gutter-element' }, marker);
					this.#cells.set(marker, cell);
				}
				place(cell, line, offset);
				column.append(cell);
			}
			this.element.append(column);
		}
	}

	replaced(change: BufferChange) {
		const oldEnd = change.lineStart + lineBreaks(change.removed);
		const next = new Map<number, Map<string, HTMLElement>>();
		for (const [line, markers] of this.#markers) {
			if (line > change.lineStart && line <= oldEnd) {
				for (const name of markers.keys()) this.#remove(name);
				continue;
			}
			next.set(line > oldEnd ? line + change.lineDelta : line, markers);
		}
		this.#markers.clear();
		for (const [line, markers] of next) this.#markers.set(line, markers);
	}

	reset() {
		this.#columns.clear();
		this.#counts.clear();
		this.#markers.clear();
		this.element.replaceChildren();
	}

	#column(name: string) {
		let column = this.#columns.get(name);
		if (!column) {
			column = create('div', {
				part: `gutter ${name}`,
			});
			column.dataset.gutter = name;
			this.#columns.set(name, column);
		}
		column.replaceChildren();
		return column;
	}

	#remove(name: string) {
		const count = this.#counts.get(name);
		if (!count || count === 1) {
			this.#counts.delete(name);
			this.#columns.get(name)?.remove();
			this.#columns.delete(name);
		} else this.#counts.set(name, count - 1);
	}
}

function lineBreaks(value: string) {
	let count = 0;
	for (const character of value) if (character === '\n') count++;
	return count;
}

function normalizeLine(line: number) {
	return Number.isFinite(line) ? Math.max(0, Math.trunc(line)) : 0;
}

function place(
	element: HTMLElement,
	line: SourceGutterLine,
	offset: number,
) {
	element.style.top = `${line.offsetTop + offset}px`;
	element.style.height = `${line.height}px`;
}

export function lineNumbers(): SourceGutter {
	return new LineNumbers();
}

export function gutterMarkers(): SourceGutterMarkers {
	return new GutterMarkers();
}
