import { Subject, type Observable } from '@cxl/ui';
import { Buffer, type BufferChange } from './buffer.js';
import type { SourceToken } from './highlight.js';

export interface SourceFoldRange {
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly endLine: number;
	readonly closed: boolean;
}

export interface SourceFoldFeature {
	readonly ranges: readonly SourceFoldRange[];
	readonly onChange: Observable<void>;
	range(line: number): SourceFoldRange | undefined;
	toggle(line?: number): void;
	open(line?: number): void;
	close(line?: number): void;
	openAll(): void;
	closeAll(): void;
}

export interface SourceFoldSpan {
	start: number;
	end: number;
	folded?: boolean;
}

interface HiddenLines {
	start: number;
	end: number;
	row: number;
	removed: number;
	from: number;
	to: number;
}

function validCount(value: number, maximum: number) {
	return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

export class SourceFolding implements SourceFoldFeature {
	readonly onChange = new Subject<void>();
	#ranges: SourceFoldRange[] = [];
	#hidden: HiddenLines[] = [];

	constructor(
		private readonly buffer: Buffer,
		private readonly cursorLine: () => number,
		private readonly changed: () => void,
	) {}

	get ranges(): readonly SourceFoldRange[] {
		return this.#ranges.map(range => ({ ...range }));
	}

	get hasHiddenLines() {
		return this.#hidden.length > 0;
	}

	get visibleCount() {
		return this.buffer.getLineCount() - (this.#hidden.at(-1)?.removed ?? 0);
	}

	lineAt(row: number) {
		row = Math.max(0, Math.min(Math.trunc(row), this.visibleCount - 1));
		let low = 0;
		let high = this.#hidden.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if ((this.#hidden[middle]?.row ?? Infinity) < row) low = middle + 1;
			else high = middle;
		}
		return row + (this.#hidden[low - 1]?.removed ?? 0);
	}

	rowAt(line: number) {
		let low = 0;
		let high = this.#hidden.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if ((this.#hidden[middle]?.start ?? Infinity) <= line) low = middle + 1;
			else high = middle;
		}
		const hidden = this.#hidden[low - 1];
		return hidden && line <= hidden.end ? hidden.row : line - (hidden?.removed ?? 0);
	}

	hiddenAt(index: number) {
		const hidden = this.#hidden[this.#hiddenIndex(index) - 1];
		return hidden && index < hidden.to ? hidden : undefined;
	}

	spans(line: number): SourceFoldSpan[] | undefined {
		if (!this.#hidden.length) return;
		let start = this.buffer.indexAt({ line, ch: 0 });
		let end = start + this.buffer.getLine(line).length;
		let index = this.#hiddenIndex(start);
		if ((this.#hidden[index]?.from ?? Infinity) > end) return;
		const spans: SourceFoldSpan[] = [];
		for (let hidden = this.#hidden[index]; hidden && hidden.from <= end; hidden = this.#hidden[++index]) {
			if (hidden.from > start) spans.push({ start, end: hidden.from });
			spans.push({ start: hidden.from, end: hidden.to, folded: true });
			start = hidden.to;
			end = this.buffer.indexAt({ line: this.buffer.positionAt(start).line, ch: Infinity });
		}
		if (start < end) spans.push({ start, end });
		return spans;
	}

	indexAt(line: number, ch: number) {
		const spans = this.spans(line);
		if (!spans) return this.buffer.indexAt({ line, ch });
		ch = Math.max(0, ch);
		for (const span of spans) {
			const length = span.folded ? 1 : span.end - span.start;
			if (ch < length) return span.start + (span.folded ? 0 : ch);
			ch -= length;
		}
		return spans.at(-1)?.end ?? 0;
	}

	columnAt(index: number) {
		const position = this.buffer.positionAt(index);
		const spans = this.spans(this.lineAt(this.rowAt(position.line)));
		if (!spans) return position.ch;
		let column = 0;
		for (const span of spans) {
			if (index <= span.end) return column + (span.folded ? Number(index === span.end) : index - span.start);
			column += span.folded ? 1 : span.end - span.start;
		}
		return column;
	}

	reveal(index: number) {
		if (!this.hiddenAt(index)) return;
		this.#set(range => range.closed && index > range.start && index < range.end, false);
	}

	range(line: number): SourceFoldRange | undefined {
		const range = this.#at(line);
		return range && { ...range };
	}

	toggle(line = this.cursorLine()) {
		const range = this.#at(line);
		if (range) this.#set(item => item === range, !range.closed);
	}

	open(line = this.cursorLine()) {
		this.#set(range => range.closed && line >= range.line && line <= range.endLine, false);
	}

	close(line = this.cursorLine()) {
		const range = this.#at(line);
		if (range) this.#set(item => item === range, true);
	}

	openAll() {
		this.#set(() => true, false);
	}

	closeAll() {
		this.#set(() => true, true);
	}

	update(tokens: readonly SourceToken[]) {
		const stack: SourceToken[] = [];
		const previous = new Map(this.#ranges.map(range => [`${range.start}:${range.end}`, range.closed]));
		const seen = new Set<string>();
		const ranges: SourceFoldRange[] = [];
		for (const token of tokens) {
			if (!Number.isSafeInteger(token.start) || !Number.isSafeInteger(token.end) || token.start < 0 || token.end < token.start || token.end > this.buffer.length) continue;
			const starts = token.foldStart ?? 0;
			const ends = token.foldEnd ?? 0;
			if (!validCount(starts, tokens.length) || !validCount(ends, tokens.length)) continue;
			for (let i = 0; i < starts; i++) stack.push(token);
			for (let i = 0; i < ends; i++) {
				const start = stack.pop();
				if (!start) break;
				const line = this.buffer.positionAt(start.start).line;
				const endLine = this.buffer.positionAt(Math.max(token.start, token.end - 1)).line;
				if (endLine <= line) continue;
				const from = start === token ? start.start : start.end;
				const to = start === token ? token.end : token.start;
				if (to <= from) continue;
				const key = `${from}:${to}`;
				if (seen.has(key)) continue;
				seen.add(key);
				ranges.push({
					start: from,
					end: to,
					line,
					endLine,
					closed: previous.get(key) ?? false,
				});
			}
		}
		ranges.sort((a, b) => a.start - b.start || b.end - a.end);
		if (ranges.length === this.#ranges.length && ranges.every((range, index) => {
			const old = this.#ranges[index];
			return old?.start === range.start && old.end === range.end && old.line === range.line && old.endLine === range.endLine && old.closed === range.closed;
		})) return;
		this.#ranges = ranges;
		this.#refresh();
	}

	replaced(change: BufferChange) {
		const delta = change.text.length - (change.end - change.start);
		this.#ranges = this.#ranges.flatMap(range => {
			if (change.start < range.end && change.end >= range.start) return [];
			if (change.end < range.start) return [{
				...range,
				start: range.start + delta,
				end: range.end + delta,
				line: range.line + change.lineDelta,
				endLine: range.endLine + change.lineDelta,
			}];
			return [range];
		});
		this.#refresh();
	}

	reset() {
		this.#ranges = [];
		this.#refresh();
	}

	#hiddenIndex(index: number) {
		let low = 0;
		let high = this.#hidden.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if ((this.#hidden[middle]?.from ?? Infinity) < index) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	#at(line: number) {
		if (!Number.isSafeInteger(line)) return;
		let low = 0;
		let high = this.#ranges.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if ((this.#ranges[middle]?.line ?? Infinity) < line) low = middle + 1;
			else high = middle;
		}
		const range = this.#ranges[low];
		return range?.line === line ? range : undefined;
	}

	#set(matches: (range: SourceFoldRange) => boolean, closed: boolean) {
		const next = this.#ranges.map(range => {
			if (!matches(range) || range.closed === closed) return range;
			return { ...range, closed };
		});
		if (next.some((range, index) => range !== this.#ranges[index])) {
			this.#ranges = next;
			this.#refresh();
		}
	}

	#refresh() {
		this.#hidden = [];
		let removed = 0;
		for (const range of this.#ranges) {
			if (!range.closed) continue;
			const previous = this.#hidden.at(-1);
			const endLine = this.buffer.positionAt(range.end).line;
			if (previous && range.start < previous.to) {
				previous.to = Math.max(previous.to, range.end);
				if (endLine > previous.end) {
					removed += endLine - previous.end;
					previous.end = endLine;
					previous.removed = removed;
				}
				continue;
			}
			const row = range.line - removed;
			removed += endLine - range.line;
			this.#hidden.push({ start: range.line + 1, end: endLine, row, removed, from: range.start, to: range.end });
		}
		this.changed();
		this.onChange.next();
	}
}
