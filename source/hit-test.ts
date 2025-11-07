import type { TextCanvas, SourceLine } from './text.js';

export class HitTest {
	constructor(protected textCanvas: TextCanvas) {}

	getCharacterAtPosition(x: number, y: number) {
		const line = this.#getSubLineAtPosition(y);
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

	getCaretAtPosition(x: number, y: number) {
		const localX = x;
		const localY = y - this.textCanvas.offsetY; // - offsetY;

		const line = this.#getSubLineAtPosition(localY);
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

	#getSubLineAtPosition(y: number) {
		let accumulatedHeight = 0;
		let targetLineData: SourceLine | undefined;
		let lineTop = 0;
		const maxHeight =
			this.textCanvas.canvas.offsetHeight - this.textCanvas.offsetY; // - offsetY;

		for (let i = this.textCanvas.firstVisibleLine; ; i++) {
			const lineData = this.textCanvas.lineCache.get(i);
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
}
