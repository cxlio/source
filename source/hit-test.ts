import type { SourceLine, TextCanvas } from './text.js';

export class HitTest {
	constructor(protected textCanvas: TextCanvas) {}

	getCharacterAtPosition(x: number, y: number) {
		const hit = this.#getLineAtPosition(y - this.textCanvas.offsetY);
		if (!hit?.part) return;
		const char = hit.part.chars.find(item => x < item.x + item.width);
		return char && { char, lineData: hit.sourceLine, y: hit.top + char.y };
	}

	getCaretAtPosition(x: number, y: number) {
		const hit = this.#getLineAtPosition(y - this.textCanvas.offsetY);
		if (!hit) return;
		const { part, sourceLine, top } = hit;
		if (!part)
			return {
				position: { line: sourceLine.row, ch: 0 },
				x: 0,
				y: top,
				height: sourceLine.height,
				line: sourceLine.row,
			};

		const index = part.chars.findIndex(
			char => x < char.x + char.width,
		);
		const charIndex = index === -1 ? part.chars.length - 1 : index;
		const char = part.chars[charIndex];
		const isBefore = x < char.x + char.width / 2;
		return {
			position: {
				line: sourceLine.row,
				ch: part.startIndex + charIndex + (isBefore ? 0 : 1),
			},
			x: isBefore ? char.x : char.x + char.width,
			y: top + part.y,
			height: char.height,
			line: sourceLine.row,
		};
	}

	#getLineAtPosition(y: number) {
		let previous: SourceLine | undefined;
		for (let row = this.textCanvas.firstVisibleLine; ; row++) {
			const sourceLine = this.textCanvas.lineCache.get(row);
			if (!sourceLine)
				return previous && this.#getBoundaryLine(previous, false);
			const top = sourceLine.offsetTop;
			if (y < top) return this.#getBoundaryLine(sourceLine, true);
			if (y >= top && y < top + sourceLine.height) {
				const localY = y - top;
				const part = [...sourceLine.lines].find(
					line =>
						localY >= line.y && localY <= line.y + line.height,
				);
				return { part, sourceLine, top };
			}
			previous = sourceLine;
			if (top > this.textCanvas.canvas.offsetHeight)
				return this.#getBoundaryLine(sourceLine, false);
		}
	}

	#getBoundaryLine(sourceLine: SourceLine, first: boolean) {
		const parts = [...sourceLine.lines];
		return {
			part: parts[first ? 0 : parts.length - 1],
			sourceLine,
			top: sourceLine.offsetTop,
		};
	}
}
