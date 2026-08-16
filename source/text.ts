import { create } from '@cxl/ui';
import { Cache } from './cache.js';
import {
	type SourceTokenColors,
	type SourceTokenSpan,
} from './highlight.js';

export interface Character {
	x: number;
	y: number;
	height: number;
	width: number;
	line: number;
}

type SubLine = {
	text: string;
	y: number;
	height: number;
	baseline: number;
	chars: Character[];
	hasTabs: boolean;
	startIndex: number;
	endIndex: number;
	lineIndex: number;
};

export type SourceLine = {
	lines: Cache<number, SubLine>;
	tokens: readonly SourceTokenSpan[];
	width: number;
	height: number;
	text: string;
	row: number;
	offsetTop: number;
};

export interface TextPosition {
	line: number;
	ch: number;
}

export interface TextRect {
	x: number;
	y: number;
	width: number;
	height: number;
	line: number;
}

export type TextCanvas = ReturnType<typeof textCanvas>;

export function getContext() {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');

	if (!context) throw new Error('Could not acquire context');
	return { canvas, context };
}

export function textCanvas(host: HTMLElement) {
	function createLine(
		range: Range,
		y: number,
		height: number,
		chars: Character[],
		hasTabs: boolean,
		lineIndex: number,
	): SubLine {
		const text = range.toString();
		const metrics = ctx.measureText('Mg');
		const extraSpace =
			height -
			(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent);
		const baseline = extraSpace / 2 + metrics.fontBoundingBoxAscent;

		return {
			text,
			baseline,
			y,
			height,
			chars,
			hasTabs,
			endIndex: range.endOffset - 1,
			startIndex: range.startOffset,
			lineIndex,
		};
	}

	function getCharIndexAtPoint(x: number, y: number) {
		const len = textN.length;
		if (len === 0) return;

		const range = document.createRange();
		range.setStart(textN, 0);
		range.setEnd(textN, len);
		const lineRects = range.getClientRects();
		let lineNumber = 0;
		const firstRect = lineRects.item(0);
		if (!firstRect) return;

		y += firstRect.y;

		for (const rect of lineRects) {
			if (y >= rect.top && y <= rect.bottom) break;
			lineNumber++;
		}

		let low = 0;
		let high = len - 1;
		let charIndex = 0;
		const lineRect = lineRects.item(lineNumber);

		if (!lineRect) return;

		while (low <= high) {
			const mid = (low + high) >> 1;
			range.setStart(textN, mid);
			range.setEnd(textN, mid + 1);
			const r = range.getBoundingClientRect();

			if (r.bottom < lineRect.top) {
				low = mid + 1;
			} else if (r.top > lineRect.bottom) {
				high = mid - 1;
			}
			// same line, check x
			else if (x < r.left) {
				high = mid - 1;
			} else if (x > r.right) {
				low = mid + 1;
			} else {
				charIndex = mid;
				break;
			}
		}

		// if we exited without an exact hit, low is the insertion point
		if (low <= len - 1) charIndex = low;

		return [charIndex, lineNumber];
	}

	function findLineStart(sourceLine: SourceLine, offsetY: number) {
		for (const cachedLine of sourceLine.lines) {
			if (
				cachedLine.y <= offsetY &&
				cachedLine.y + cachedLine.height > offsetY
			) {
				return [cachedLine.startIndex, cachedLine.lineIndex];
			}
		}

		return getCharIndexAtPoint(0, offsetY);
	}

	function getCharRect(i: number) {
		charRange.setStart(textN, i);
		charRange.setEnd(textN, i + 1);
		return charRange.getBoundingClientRect();
	}

	function readLine(
		start: number,
		end: number,
		row: number,
		lineIndex: number,
	) {
		let lineY = -1;
		let lineHeight = 0;
		let hasTabs = false;
		let rect;
		let i = start;
		const chars: Character[] = [];

		lineRange.setStart(textN, start);

		do {
			rect = getCharRect(i);

			if (rect.height > lineHeight) lineHeight = rect.height;

			const x = rect.x - hostRect.x;

			if (lineY === -1) {
				lineY = rect.y - measureRect.y;
			} else if (x === 0) break;

			if (charRange.toString() === '\t') hasTabs = true;

			chars.push({
				y: lineY,
				x,
				width: rect.width,
				height: rect.height,
				line: row,
			});
		} while (++i < end);

		lineRange.setEnd(textN, i);
		return createLine(
			lineRange,
			lineY,
			lineHeight,
			chars,
			hasTabs,
			lineIndex,
		);
	}

	function getVisibleSubLines(sourceLine: SourceLine, offsetY: number) {
		const { text, lines } = sourceLine;

		textN.textContent = text || ' ';

		const maxY = host.offsetHeight + offsetY;
		const startLine = offsetY ? findLineStart(sourceLine, offsetY) : [0, 0];
		if (!startLine) return;

		const start = startLine[0];
		let line = startLine[1];

		const end = text.length;
		const result = [];

		let i = start;
		while (i < end) {
			const cachedLine = lines.get(line);
			if (cachedLine) {
				if (cachedLine.y + cachedLine.height > offsetY)
					result.push(cachedLine);
				if (cachedLine.y > maxY) break;
				i = cachedLine.endIndex + 1;
				line++;
				continue;
			}
			const subline = readLine(i, end, sourceLine.row, line);
			result.push(lines.set(line, subline));

			if (subline.y > maxY) break;
			i = subline.endIndex + 1;
		}

		return result;
	}

	function measure(text: string, row: number): SourceLine {
		const cache = lineCache.get(row);
		if (cache) return cache;

		const lines = new Cache<number, SubLine>();
		textN.textContent = text || ' ';

		return lineCache.set(row, {
			lines,
			tokens: [],
			height: measureElement.offsetHeight,
			width: measureElement.offsetWidth,
			text,
			row,
			offsetTop: 0,
		});
	}

	function renderLine(
		row: number,
		text: string,
		tokens: readonly SourceTokenSpan[] = [],
	) {
		const line = measure(text, row);
		line.tokens = tokens;
		const offsetTop = y;
		line.offsetTop = offsetTop;
		toRender.push(line);
		y += line.height;

		return {
			offsetLeft: 0,
			offsetWidth: line.width,
			offsetHeight: line.height,
			offsetTop,
		};
	}

	function begin(row: number) {
		y = 0;
		firstVisibleLine = row;
		toRender.length = 0;
	}

	function resizeCanvas() {
		const dpr = window.devicePixelRatio || 1;
		const w = host.clientWidth * dpr;
		const h = host.clientHeight * dpr;
		if (w !== ctx.canvas.width || h !== ctx.canvas.height) {
			ctx.canvas.width = w;
			ctx.canvas.height = h;
			ctx.scale(dpr, dpr);
			updateStyles();
		} else ctx.clearRect(0, 0, canvas.width, canvas.height);
		hostRect = host.getBoundingClientRect();
		measureRect = measureElement.getBoundingClientRect();
		hasResized = false;
	}

	function paint(text: string, x: number, y: number, kind?: string) {
		ctx.fillStyle =
			!forcedColors && kind ? (tokenColors[kind] ?? color) : color;
		ctx.fillText(text, x, y);
	}

	function commitLine(sourceLine: SourceLine, line: SubLine, y: number) {
		const baseline = y + line.y + line.baseline;
		if (line.hasTabs) {
			let token = 0;
			for (const [i, c] of line.chars.entries()) {
				const index = line.startIndex + i;
				let span = sourceLine.tokens.at(token);
				while (span && index >= span.end)
					span = sourceLine.tokens.at(++token);
				paint(
					line.text.charAt(i),
					c.x,
					y + c.y + line.baseline,
					span && index >= span.start ? span.kind : undefined,
				);
			}
			return;
		}

		let start = line.startIndex;
		const end = line.endIndex + 1;
		for (const token of sourceLine.tokens) {
			if (token.end <= start) continue;
			if (token.start >= end) break;
			const tokenStart = Math.max(start, token.start);
			if (tokenStart > start)
				paint(
					sourceLine.text.slice(start, tokenStart),
					getCharacterX(line, start),
					baseline,
				);
			const tokenEnd = Math.min(end, token.end);
			paint(
				sourceLine.text.slice(tokenStart, tokenEnd),
				getCharacterX(line, tokenStart),
				baseline,
				token.kind,
			);
			start = tokenEnd;
		}
		if (start < end)
			paint(
				sourceLine.text.slice(start, end),
				getCharacterX(line, start),
				baseline,
			);
	}

	function commit(offset: number) {
		let y = (offsetY = offset);
		if (hasResized) resizeCanvas();
		else ctx.clearRect(0, 0, canvas.width, canvas.height);

		const maxHeight = ctx.canvas.height;

		for (const row of toRender) {
			const lines = getVisibleSubLines(row, -offset);
			offset = 0;
			if (lines) for (const line of lines) commitLine(row, line, y);
			y += row.height;
			if (y > maxHeight) break;
		}
	}

	function getCharacterX(line: SubLine, index: number) {
		const local = index - line.startIndex;
		if (local <= 0) return line.chars[0]?.x ?? 0;
		if (local >= line.chars.length) {
			const char = line.chars[line.chars.length - 1];
			return char.x + char.width;
		}
		return line.chars[local].x;
	}

	function getCaret({ line, ch }: TextPosition): TextRect | undefined {
		const sourceLine = lineCache.get(line);
		if (!sourceLine) return;
		const parts = [...sourceLine.lines];
		const part =
			parts.find(
				item =>
					ch >= item.startIndex && ch <= item.endIndex + 1,
			) ?? parts.at(-1);
		if (!part)
			return {
				x: 0,
				y: sourceLine.offsetTop,
				width: 1,
				height: sourceLine.height,
				line,
			};
		return {
			x: getCharacterX(part, ch),
			y: sourceLine.offsetTop + part.y,
			width: 1,
			height: part.height,
			line,
		};
	}

	function getSelectionRects(
		start: TextPosition,
		end: TextPosition,
	): TextRect[] {
		const result: TextRect[] = [];
		for (const sourceLine of lineCache) {
			if (sourceLine.row < start.line || sourceLine.row > end.line)
				continue;
			const rangeStart =
				sourceLine.row === start.line ? start.ch : 0;
			const rangeEnd =
				sourceLine.row === end.line ? end.ch : sourceLine.text.length;
			if (rangeStart === rangeEnd && start.line === end.line) continue;

			const parts = [...sourceLine.lines];
			if (!parts.length) {
				result.push({
					x: 0,
					y: sourceLine.offsetTop,
					width: 2,
					height: sourceLine.height,
					line: sourceLine.row,
				});
				continue;
			}

			for (const part of parts) {
				const partStart = Math.max(rangeStart, part.startIndex);
				const partEnd = Math.min(rangeEnd, part.endIndex + 1);
				if (partEnd <= partStart) continue;
				const x = getCharacterX(part, partStart);
				result.push({
					x,
					y: sourceLine.offsetTop + part.y,
					width: Math.max(2, getCharacterX(part, partEnd) - x),
					height: part.height,
					line: sourceLine.row,
				});
			}
		}
		return result;
	}

	function invalidate(start: number, end: number, lineDelta: number) {
		lineCache.deleteWhere((_, line) =>
			lineDelta ? line >= start : line >= start && line <= end,
		);
	}

	function resize() {
		hasResized = true;
		lineCache.clear();
	}

	function setTokenColors(colors: SourceTokenColors) {
		tokenColors = colors;
	}

	function updateStyles() {
		const style = getComputedStyle(host);
		ctx.font = style.font;
		color = style.color;
		forcedColors = matchMedia('(forced-colors: active)').matches;
		ctx.fillStyle = color;
		ctx.textBaseline = 'alphabetic';
	}

	const { canvas, context: ctx } = getContext();
	const textN = new Text();
	const measureElement = create('div', { id: 'measure' }, textN);
	const charRange = document.createRange();
	const lineRange = document.createRange();
	const lineCache = new Cache<number, SourceLine>();
	const toRender: SourceLine[] = [];

	let y = 0;
	let firstVisibleLine = 0;
	let hasResized = true;
	let offsetY = 0;
	let color = '';
	let forcedColors = false;
	let tokenColors: SourceTokenColors = {};
	let hostRect: DOMRect;
	let measureRect: DOMRect;

	return {
		begin,
		canvas: ctx.canvas,
		commit,
		getCaret,
		getSelectionRects,
		invalidate,
		measureElement,
		resize,
		setTokenColors,
		updateStyles,
		renderLine,
		lineCache,

		get firstVisibleLine() {
			return firstVisibleLine;
		},

		get offsetY() {
			return offsetY;
		},
	};
}
