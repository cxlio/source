import { create } from '@cxl/ui';
import { Cache } from './cache.js';

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
	width: number;
	height: number;
	text: string;
};

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
		const m = ctx.measureText(text);
		const extraSpace =
			height - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
		const baseline = extraSpace / 2 + m.actualBoundingBoxAscent;

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

		y += lineRects[0]?.y ?? 0;

		for (const rect of lineRects) {
			if (y >= rect.top && y <= rect.bottom) break;
			lineNumber++;
		}

		let low = 0;
		let high = len - 1;
		let charIndex = 0;
		const lineRect = lineRects[lineNumber];

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

	function readLine(start: number, end: number, line: number) {
		let lineY = -1;
		let lineBottom = -1;
		let lineHeight = 0;
		let hasTabs = false;
		let rect;
		let i = start;
		const chars: Character[] = [];

		lineRange.setStart(textN, start);

		do {
			rect = getCharRect(i);

			if (rect.height > lineHeight) lineHeight = rect.height;

			if (lineY === -1) {
				lineY = rect.y - measureRect.y;
				lineBottom = rect.y + lineHeight;
			}

			if (rect.y > lineBottom) break;

			if (charRange.toString() === '\t') hasTabs = true;

			chars.push({
				y: lineY,
				x: rect.x - hostRect.x,
				width: rect.width,
				height: rect.height,
				line,
			});
		} while (i++ < end);

		lineRange.setEnd(textN, i);
		return createLine(lineRange, lineY, lineHeight, chars, hasTabs, line);
	}

	function getVisibleSubLines(sourceLine: SourceLine, offsetY: number) {
		const { text, lines } = sourceLine;

		textN.textContent = text || ' ';

		const maxY = host.offsetHeight + offsetY;
		const startLine = offsetY ? findLineStart(sourceLine, offsetY) : [0, 0];
		if (!startLine) return;

		const start = startLine[0];
		let line = startLine[1];

		const end = text.length - 1;
		const result = [];

		for (let i = start; i < end; i++) {
			const cachedLine = lines.get(line);
			if (cachedLine) {
				if (cachedLine.y + cachedLine.height > offsetY)
					result.push(cachedLine);
				i = cachedLine.endIndex;
				if (cachedLine.y > maxY) break;
				line++;
				continue;
			}
			const subline = readLine(i, end, line);
			result.push(lines.set(line, subline));

			if (subline.y > maxY) break;
			i = subline.endIndex;
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
			height: measureElement.offsetHeight,
			width: measureElement.offsetWidth,
			text,
		});
	}

	function renderLine(row: number, text: string) {
		const line = measure(text, row);
		const offsetTop = y;
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

	function commitLine(line: SubLine, y: number) {
		if (line.hasTabs) {
			for (const [i, c] of line.chars.entries()) {
				ctx.fillText(line.text.charAt(i), c.x, y + c.y + line.baseline);
			}
		} else ctx.fillText(line.text, 0, y + line.y + line.baseline);
	}

	function commit(offset: number) {
		let y = (offsetY = offset);
		if (hasResized) resizeCanvas();
		else ctx.clearRect(0, 0, canvas.width, canvas.height);

		const maxHeight = ctx.canvas.height;

		for (const row of toRender) {
			const lines = getVisibleSubLines(row, -offset);
			offset = 0;
			if (lines) for (const line of lines) commitLine(line, y);
			y += row.height;
			if (y > maxHeight) break;
		}
	}

	function resize() {
		hasResized = true;
		lineCache.clear();
	}

	function updateStyles() {
		const style = getComputedStyle(host);
		ctx.font = style.font;
		ctx.fillStyle = style.color;
		ctx.textBaseline = 'alphabetic';
	}

	function getSubLineAtPosition(y: number) {
		let accumulatedHeight = 0;
		let targetLineData: SourceLine | undefined;
		let lineTop = 0;
		const maxHeight = host.offsetHeight - offsetY;

		for (let i = firstVisibleLine; ; i++) {
			const lineData = lineCache.get(i);
			if (!lineData) break;

			const lineHeight = lineData.height;
			if (y >= accumulatedHeight && y < accumulatedHeight + lineHeight) {
				targetLineData = lineData;
				lineTop = accumulatedHeight;
				break;
			}

			accumulatedHeight += lineHeight;
			if (accumulatedHeight > maxHeight) break;
		}

		if (!targetLineData) return;

		const yInLine = (y - lineTop) | 0;
		const lineData = targetLineData.lines.find(
			l => yInLine >= l.y && yInLine <= l.y + l.height,
		);
		return { lineData, accumulatedHeight };
	}

	function getCharacterAtPosition(x: number, y: number) {
		const line = getSubLineAtPosition(y);
		if (!line?.lineData) return;
		const { lineData, accumulatedHeight } = line;

		const char = lineData.chars.find(c => x < c.x + c.width);
		return (
			char && {
				char,
				lineData,
				y: accumulatedHeight + char.y,
			}
		);
	}

	function getCaretAtPosition(x: number, y: number) {
		const localX = x; //- hostRect.left;
		const localY = y - offsetY;

		const line = getSubLineAtPosition(localY);
		if (!line?.lineData) return;
		const { lineData, accumulatedHeight } = line;

		const char =
			lineData.chars.find(c => localX < c.x + c.width) ??
			lineData.chars[lineData.chars.length - 1];
		if (!char) return;
		const isBefore = localX < char.x + char.width / 2;

		return {
			char,
			x: isBefore ? char.x : char.x + char.width,
			y: char.y + accumulatedHeight,
		};
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
	let hostRect: DOMRect;
	let measureRect: DOMRect;

	return {
		begin,
		canvas: ctx.canvas,
		commit,
		measureElement,
		resize,
		updateStyles,
		renderLine,
		lineCache,
		getCharacterAtPosition,
		getCaretAtPosition,
	};
}
