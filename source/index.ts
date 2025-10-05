import {
	on,
	onResize,
	onVisibility,
	EMPTY,
	subject,
	merge,
	Component,
	attribute,
	component,
	create,
	get,
	css,
	onThemeChange,
	onFontsReady,
	virtualScroll,
} from '@cxl/ui';
import { textCanvas } from './text.js';
import { sourceCursor } from './cursor.js';

interface Piece {
	source: 'original' | 'add';
	start: number;
	length: number;
}

function newBuffer() {
	function rebuildLineCounts() {
		const counts: number[] = [];
		for (const p of table) {
			const text = p.source === 'original' ? source : addBuffer;
			let cnt = 0;
			// count '\n' in [p.start, p.start+p.length)
			let idx = text.indexOf('\n', p.start - 1);
			while (idx >= 0 && idx < p.start + p.length - 1) {
				cnt++;
				idx = text.indexOf('\n', idx + 1);
			}
			// if the piece isn’t empty, it has at least 1 line
			counts.push(p.length > 0 ? cnt + 1 : 0);
		}
		prefixSums = [0];
		for (const c of counts) {
			prefixSums.push(prefixSums[prefixSums.length - 1] + c);
		}
	}

	function getLineCount(): number {
		// always up‐to‐date after rebuildLineCounts()
		return prefixSums[prefixSums.length - 1];
	}

	/**
	 * Retrieves the content of a specific line from the composite text buffer,
	 * enabling random-access line reading for virtual scrolling.
	 * The function traverses the Piece table to stitch together original
	 * and added buffer segments as one continuous text source.
	 */
	function getLine(lineNumber: number): string {
		const totalLines = prefixSums[prefixSums.length - 1];
		if (lineNumber < 0 || lineNumber >= totalLines) return '';

		// binary search for piece i so that
		// prefixSums[i] <= lineNumber < prefixSums[i+1]
		let lo = 0,
			hi = table.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (prefixSums[mid + 1] > lineNumber) hi = mid;
			else lo = mid + 1;
		}
		const piece = table[lo];
		const text = piece.source === 'original' ? source : addBuffer;
		const end = piece.start + piece.length;

		// how many lines we skip inside this piece
		const skipLines = lineNumber - prefixSums[lo];

		// find byte‐offset in [start..end) where our line starts
		let pos = piece.start;
		for (let i = 0; i < skipLines; i++) {
			const nl = text.indexOf('\n', pos);
			// should always find one, because skipLines < lineCounts[pieceIndex]
			pos = nl + 1;
		}

		// now pos is the start of our line. find its end.
		const firstNL = text.indexOf('\n', pos);
		let line = '';
		if (firstNL >= 0 && firstNL < end) {
			// newline is inside this piece
			line = text.slice(pos, firstNL);
		} else {
			// no newline in this piece to end the line —
			// take rest of piece, then carry on into subsequent pieces
			line = text.slice(pos, end);
			let pi = lo + 1;
			while (pi < table.length) {
				const p2 = table[pi];
				const t2 = p2.source === 'original' ? source : addBuffer;
				const s2 = p2.start;
				const e2 = s2 + p2.length;
				const segment = t2.slice(s2, e2);
				const nl2 = segment.indexOf('\n');
				if (nl2 >= 0) {
					line += segment.slice(0, nl2);
					break;
				} else {
					line += segment;
					pi++;
				}
			}
		}

		return line;
	}

	function reset(newSource: string) {
		source = newSource;
		table = [{ source: 'original', start: 0, length: source.length }];
		addBuffer = '';
		rebuildLineCounts();
	}

	let table: Piece[];
	let addBuffer = '';
	let prefixSums: number[] = [];
	let source = '';
	//let lineCounts: number[] = [];

	return {
		getLine,
		getLineCount,
		reset,
	};
}

/**
 * Displays a large, immutable text buffer with efficient rendering for very
 * large documents. Offers performant line-by-line scrolling for scenarios like
 * file viewers, source code diffs, or read-only editors.
 *
 * The number of rendered lines automatically adapts to the height of the
 * container, with only visible lines appended to the DOM at one time, ensuring
 * high performance for extremely large files.
 *
 * @title Source Code Editor
 * @icon subject
 * @alpha
 */
export class Source extends Component {
	value = '';
}

component(Source, {
	tagName: 'c-source',
	init: [attribute('value')],
	augment: [
		css(`
:host {
	display: block;
	font-family: var(--cxl-font-monospace, monospace);
	cursor: text;
	outline: none;
	overflow:auto;
	box-sizing: border-box;
	position: relative;
	user-select: none;
	-webkit-user-select: none;
}
canvas {
	position: absolute; top: 0; left: 0;
	pointer-events: none;
	width:100%;
	height:100%;
}
#body { height:100%; }
#measure {
	visibility:hidden;
	position: absolute;
	top: 0; left: 0;
	white-space: pre-wrap;
	word-break: break-word;
}
#cursor {
	position: absolute;
	display: none;
	width: 2px;
	margin-left: -1px;
	background: currentColor;
	animation: blink 1.2s step-end infinite;
	pointer-events: none;
}
#test { white-space:pre-wrap; position:absolute; inset:0;overflow:auto;}
`),
		$ => {
			const host = create('div', { id: 'body' });
			const text = textCanvas(host);
			const cursor = sourceCursor(host);

			const refresh = subject<void | { dataLength: number }>();
			const buffer = newBuffer();

			let offsetY = 0;

			host.append(text.canvas, cursor.canvas, text.measureElement);

			$.shadowRoot?.append(host);

			return merge(
				onFontsReady().switchMap(() => {
					return onVisibility($).switchMap(v =>
						v
							? merge(
									merge(onResize(host)).raf(() => {
										if (
											host.clientHeight > 0 &&
											host.clientWidth > 0
										) {
											text.resize();
											cursor.resize();
										}
									}),
									virtualScroll({
										host,
										scrollElement: $,
										scrollContainer:
											$.shadowRoot ?? undefined,
										refresh: refresh,
										render(index, order) {
											if (order === 0) text.begin(index);
											return text.renderLine(
												index,
												buffer.getLine(index),
											);
										},
										dataLength: buffer.getLineCount(),
										translate: false,
									}).tap(ev => {
										if (
											cursor.line < ev.start ||
											cursor.line > ev.end
										)
											cursor.clear();
										offsetY = ev.offset;

										text.commit(ev.offset);
									}),
							  )
							: EMPTY,
					);
				}),
				get($, 'value').tap(source => {
					buffer.reset(source);
					refresh.next({
						dataLength: buffer.getLineCount(),
					});
				}),

				on(host, 'mousedown').tap(ev => {
					const caret = text.getCaretAtPosition(
						ev.offsetX,
						ev.offsetY,
					);
					if (caret) cursor.setPosition(caret, offsetY);
				}),

				onThemeChange.tap(() => {
					text.updateStyles();
					refresh.next();
				}),
			);
		},
	],
});
