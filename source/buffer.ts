export interface Piece {
	source: 'original' | 'add';
	start: number;
	length: number;
}

export interface BufferPosition {
	line: number;
	ch: number;
}

export interface BufferChange {
	start: number;
	end: number;
	text: string;
	removed: string;
	lineStart: number;
	lineEnd: number;
	lineDelta: number;
}

interface IndexedPiece extends Piece {
	lineBreaks: number;
}

function getItem<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined) throw new RangeError('Index out of bounds');
	return value;
}

function lowerBound(values: readonly number[], value: number) {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (getItem(values, middle) < value) low = middle + 1;
		else high = middle;
	}
	return low;
}

export class Buffer {
	#table: IndexedPiece[] = [];
	#addBuffer = '';
	#addLineBreaks: number[] = [];
	#lengths = [0];
	#lineBreaks = [0];
	#original = '';
	#originalLineBreaks: number[] = [];

	get length() {
		return this.#lengths.at(-1) ?? 0;
	}

	getLineCount() {
		return (this.#lineBreaks.at(-1) ?? 0) + 1;
	}

	getLine(line: number) {
		if (line < 0 || line >= this.getLineCount()) return '';
		const [start, end] = this.#lineBounds(line);
		return this.getText(start, end);
	}

	getText(start = 0, end = this.length) {
		start = this.#clampIndex(start);
		end = Math.max(start, this.#clampIndex(end));
		if (start === end) return '';

		const from = this.#boundary(start);
		const to = this.#boundary(end);
		const parts: string[] = [];
		const lastPiece = Math.min(to.piece, this.#table.length - 1);
		for (let index = from.piece; index <= lastPiece; index++) {
			const piece = getItem(this.#table, index);
			const pieceStart = index === from.piece ? from.offset : 0;
			const pieceEnd =
				index === to.piece ? to.offset : piece.length;
			if (pieceEnd <= pieceStart) continue;
			const source = this.#source(piece);
			parts.push(
				source.slice(
					piece.start + pieceStart,
					piece.start + pieceEnd,
				),
			);
		}
		return parts.join('');
	}

	charAt(index: number) {
		if (index < 0 || index >= this.length) return '';
		const { piece: pieceIndex, offset } = this.#boundary(index);
		const piece = getItem(this.#table, pieceIndex);
		return this.#source(piece).charAt(piece.start + offset);
	}

	positionAt(index: number): BufferPosition {
		index = this.#clampIndex(index);
		const line = this.#countLineBreaksBefore(index);
		const lineStart = line ? this.#findLineBreak(line - 1) + 1 : 0;
		return { line, ch: index - lineStart };
	}

	indexAt({ line, ch }: BufferPosition) {
		line = Math.max(0, Math.min(line | 0, this.getLineCount() - 1));
		const [start, end] = this.#lineBounds(line);
		return Math.max(start, Math.min(start + Math.max(0, ch), end));
	}

	insert(index: number, text: string) {
		return this.replace(index, index, text);
	}

	delete(start: number, end: number) {
		return this.replace(start, end, '');
	}

	replace(start: number, end: number, text: string): BufferChange {
		start = this.#clampIndex(start);
		end = Math.max(start, this.#clampIndex(end));
		const oldLineCount = this.getLineCount();
		const lineStart = this.positionAt(start).line;
		const oldLineEnd = this.positionAt(end).line;
		const removed = this.getText(start, end);
		const from = this.#boundary(start);
		const to = this.#boundary(end);
		const table: IndexedPiece[] = [];

		for (let index = 0; index < from.piece; index++)
			table.push(getItem(this.#table, index));
		if (from.offset) {
			const piece = getItem(this.#table, from.piece);
			table.push(this.#piece(piece.source, piece.start, from.offset));
		}

		if (text) {
			const addStart = this.#addBuffer.length;
			this.#addBuffer += text;
			this.#appendLineBreaks(this.#addLineBreaks, text, addStart);
			table.push(this.#piece('add', addStart, text.length));
		}

		if (to.piece < this.#table.length) {
			const endPiece = getItem(this.#table, to.piece);
			if (to.offset < endPiece.length)
				table.push(
					this.#piece(
						endPiece.source,
						endPiece.start + to.offset,
						endPiece.length - to.offset,
					),
				);
		}
		for (let index = to.piece + 1; index < this.#table.length; index++)
			table.push(getItem(this.#table, index));

		this.#table = this.#merge(table);
		this.#rebuildIndexes();
		const newLineEnd = this.positionAt(start + text.length).line;
		return {
			start,
			end,
			text,
			removed,
			lineStart,
			lineEnd: Math.max(oldLineEnd, newLineEnd),
			lineDelta: this.getLineCount() - oldLineCount,
		};
	}

	reset(source: string) {
		this.#original = source;
		this.#originalLineBreaks = [];
		this.#appendLineBreaks(this.#originalLineBreaks, source, 0);
		this.#addBuffer = '';
		this.#addLineBreaks = [];
		this.#table = source.length
			? [this.#piece('original', 0, source.length)]
			: [];
		this.#rebuildIndexes();
	}

	#appendLineBreaks(target: number[], text: string, offset: number) {
		let index = text.indexOf('\n');
		while (index !== -1) {
			target.push(offset + index);
			index = text.indexOf('\n', index + 1);
		}
	}

	#boundary(index: number) {
		const boundary = lowerBound(this.#lengths, index);
		if (getItem(this.#lengths, boundary) === index)
			return { piece: boundary, offset: 0 };
		const piece = boundary - 1;
		return { piece, offset: index - getItem(this.#lengths, piece) };
	}

	#clampIndex(index: number) {
		if (index === Infinity) return this.length;
		if (!Number.isFinite(index)) return 0;
		return Math.max(0, Math.min(Math.trunc(index), this.length));
	}

	#countLineBreaksBefore(index: number) {
		if (index <= 0) return 0;
		if (index >= this.length)
			return this.#lineBreaks.at(-1) ?? 0;
		const boundary = this.#boundary(index);
		const piece = getItem(this.#table, boundary.piece);
		const breaks = this.#sourceLineBreaks(piece);
		return (
			getItem(this.#lineBreaks, boundary.piece) +
			lowerBound(breaks, piece.start + boundary.offset) -
			lowerBound(breaks, piece.start)
		);
	}

	#findLineBreak(line: number) {
		let low = 0;
		let high = this.#table.length - 1;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (getItem(this.#lineBreaks, middle + 1) > line) high = middle;
			else low = middle + 1;
		}
		const piece = getItem(this.#table, low);
		const breaks = this.#sourceLineBreaks(piece);
		const first = lowerBound(breaks, piece.start);
		const localLine = line - getItem(this.#lineBreaks, low);
		return (
			getItem(this.#lengths, low) +
			getItem(breaks, first + localLine) -
			piece.start
		);
	}

	#lineBounds(line: number): [number, number] {
		const start = line ? this.#findLineBreak(line - 1) + 1 : 0;
		let end =
			line < this.getLineCount() - 1
				? this.#findLineBreak(line)
				: this.length;
		if (end > start && this.charAt(end - 1) === '\r') end--;
		return [start, end];
	}

	#merge(table: IndexedPiece[]) {
		const merged: IndexedPiece[] = [];
		for (const piece of table) {
			const previous = merged.at(-1);
			if (
				previous?.source === piece.source &&
				previous.start + previous.length === piece.start
			) {
				previous.length += piece.length;
				previous.lineBreaks += piece.lineBreaks;
			} else merged.push(piece);
		}
		return merged;
	}

	#piece(source: Piece['source'], start: number, length: number) {
		const breaks = this.#sourceLineBreaks({ source });
		const lineBreaks =
			lowerBound(breaks, start + length) - lowerBound(breaks, start);
		return { source, start, length, lineBreaks };
	}

	#rebuildIndexes() {
		this.#lengths = [0];
		this.#lineBreaks = [0];
		for (const piece of this.#table) {
			this.#lengths.push(
				(this.#lengths.at(-1) ?? 0) + piece.length,
			);
			this.#lineBreaks.push(
				(this.#lineBreaks.at(-1) ?? 0) +
					piece.lineBreaks,
			);
		}
	}

	#source(piece: Pick<Piece, 'source'>) {
		return piece.source === 'original' ? this.#original : this.#addBuffer;
	}

	#sourceLineBreaks(piece: Pick<Piece, 'source'>) {
		return piece.source === 'original'
			? this.#originalLineBreaks
			: this.#addLineBreaks;
	}
}
