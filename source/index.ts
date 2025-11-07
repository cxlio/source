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
import { HitTest } from './hit-test.js';
import { Buffer } from './buffer.js';

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
	width: 100%;
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
			const hitTest = new HitTest(text);

			const refresh = subject<void | { dataLength: number }>();
			const buffer = new Buffer();

			let offsetY = 0;

			host.append(text.canvas, cursor.canvas, text.measureElement);

			$.shadowRoot?.append(host);

			return merge(
				onFontsReady().switchMap(() => {
					return onVisibility($).switchMap(v =>
						v
							? merge(
									onResize(host).raf(() => {
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
					const caret = hitTest.getCaretAtPosition(
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
