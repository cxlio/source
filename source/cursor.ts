import { getContext, type TextRect } from './text.js';

export interface CursorOptions {
	type: 'text' | 'block';
	interval: number;
}

export function sourceCursor(host: Element, text: HTMLCanvasElement) {
	function render() {
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.fillStyle = selectionColor;
		for (const rect of selection)
			ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
		if (isVisible) {
			ctx.fillStyle = caretColor;
			for (const caret of carets) {
				ctx.fillRect(caret.x, caret.y, caret.width, caret.height);
				if (options.type !== 'block' || !caret.width || !caret.height) continue;
				const dpr = window.devicePixelRatio || 1;
				glyph.canvas.width = Math.ceil(caret.width * dpr);
				glyph.canvas.height = Math.ceil(caret.height * dpr);
				glyph.drawImage(text, caret.x * dpr, caret.y * dpr,
					glyph.canvas.width, glyph.canvas.height,
					0, 0, glyph.canvas.width, glyph.canvas.height);
				glyph.globalCompositeOperation = 'source-in';
				glyph.fillStyle = glyphColor;
				glyph.fillRect(0, 0, glyph.canvas.width, glyph.canvas.height);
				ctx.drawImage(glyph.canvas, caret.x, caret.y, caret.width, caret.height);
			}
		}
	}

	function setPositions(rects: readonly TextRect[], offset: number) {
		stopBlinking();
		carets = rects.map(rect => ({
			x: rect.x | 0,
			y: (rect.y + offset) | 0,
			width: (options.type === 'block' ? rect.width : textCursorWidth) | 0,
			height: rect.height | 0,
			line: rect.line,
		}));
		cursor = carets.at(-1) ?? cursor;
		if (!carets.length) return;
		startBlinking();
	}

	function setSelection(rects: readonly TextRect[], offset: number) {
		selection = rects.map(rect => ({ ...rect, y: rect.y + offset }));
		render();
	}

	function resize(width = host.clientWidth, height = host.clientHeight) {
		const dpr = window.devicePixelRatio || 1;
		const w = width * dpr;
		const h = height * dpr;
		if (w !== ctx.canvas.width || h !== ctx.canvas.height) {
			ctx.canvas.width = w;
			ctx.canvas.height = h;
			ctx.scale(dpr, dpr);
		}
		updateStyles();
		render();
	}

	function setOptions(op: Partial<CursorOptions>) {
		const oldInterval = options.interval;
		Object.assign(options, op);
		if (op.interval && op.interval !== oldInterval && blinkTimer)
			startBlinking();
	}

	function updateStyles() {
		const style = getComputedStyle(host);
		caretColor = style.caretColor === 'auto' ? style.color : style.caretColor;
		glyph.canvas.width = glyph.canvas.height = 1;
		glyph.fillStyle = caretColor;
		glyph.fillRect(0, 0, 1, 1);
		const [r = 0, g = 0, b = 0] = Array.from(glyph.getImageData(0, 0, 1, 1).data)
			.slice(0, 3).map(value => {
				const channel = value / 255;
				return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
			});
		glyphColor = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? 'black' : 'white';
		selectionColor =
			style.getPropertyValue('--cxl-source-selection') ||
			'rgba(0, 120, 215, 0.35)';
	}

	function blink() {
		isVisible = !isVisible;
		render();
	}

	function startBlinking() {
		stopBlinking();
		isVisible = true;
		render();
		blinkTimer = window.setInterval(blink, options.interval);
	}

	function stopBlinking() {
		if (blinkTimer) clearInterval(blinkTimer);
		blinkTimer = undefined;
		isVisible = false;
		render();
	}

	function clear() {
		selection = [];
		carets = [];
		stopBlinking();
	}

	const { canvas, context: ctx } = getContext();
	const { context: glyph } = getContext();
	canvas.setAttribute('part', 'cursor');
	const options: CursorOptions = { type: 'text', interval: 500 };
	const textCursorWidth = window.devicePixelRatio >= 2 ? 2 : 1;

	let caretColor = 'currentColor';
	let glyphColor = 'white';
	let selectionColor = 'rgba(0, 120, 215, 0.35)';
	let selection: TextRect[] = [];
	let carets: TextRect[] = [];
	let isVisible = false;
	let blinkTimer: number | undefined;
	let cursor = {
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		line: 0,
	};

	updateStyles();

	return {
		canvas,
		resize,
		setPositions,
		setSelection,
		setOptions,
		updateStyles,
		clear,
		hideCaret: stopBlinking,
		get bounds() {
			const hostRect = host.getBoundingClientRect();
			return new DOMRect(
				hostRect.left + cursor.x,
				hostRect.top + cursor.y,
				cursor.width,
				cursor.height,
			);
		},
		get line() {
			return cursor.line;
		},
	};
}
