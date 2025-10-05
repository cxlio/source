import { Character, getContext } from './text.js';

export interface CursorOptions {
	type: 'text' | 'block';
	interval: number;
}

export function sourceCursor(host: Element) {
	function setPosition(
		{ char, x, y }: { char: Character; x: number; y: number },
		offset: number,
	) {
		stopBlinking();
		cursor = {
			x: x | 0,
			y: (y | 0) + offset,
			width:
				(options.type === 'block' ? char.width : textCursorWidth) | 0,
			height: char.height | 0,
			line: char.line,
		};
		startBlinking();
	}

	function scroll(dY: number) {
		stopBlinking();
		cursor.y += dY;
		startBlinking();
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
	}

	function setOptions(op: Partial<CursorOptions>) {
		const oldInterval = options.interval;
		Object.assign(options, op);
		if (op.interval && op.interval !== oldInterval && blinkTimer)
			startBlinking();
	}

	function blink() {
		isVisible = !isVisible;
		ctx.clearRect(cursor.x, cursor.y, cursor.width, cursor.height);
		if (isVisible) {
			ctx.fillRect(cursor.x, cursor.y, cursor.width, cursor.height);
		}
	}

	function startBlinking() {
		stopBlinking();
		isVisible = true;
		ctx.fillRect(cursor.x, cursor.y, cursor.width, cursor.height);
		blinkTimer = window.setInterval(blink, options.interval);
	}

	function stopBlinking() {
		if (blinkTimer) clearInterval(blinkTimer);
		blinkTimer = undefined;
		ctx.clearRect(cursor.x, cursor.y, cursor.width, cursor.height);
	}

	const { canvas, context: ctx } = getContext();
	const options: CursorOptions = { type: 'text', interval: 500 };
	const textCursorWidth = window.devicePixelRatio >= 2 ? 2 : 1;

	let isVisible = false;
	let blinkTimer: number | undefined;
	let cursor = {
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		line: 0,
	};

	return {
		canvas,
		resize,
		setPosition,
		setOptions,
		scroll,
		clear: stopBlinking,
		get line() {
			return cursor.line;
		},
	};
}
