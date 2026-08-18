import {
	onResize,
	onVisibility,
	EMPTY,
	merge,
	Component,
	component,
	create,
	get,
	css,
	property,
	onThemeChange,
	onFontsReady,
	virtualScroll,
	ReplaySubject,
} from '@cxl/ui';
import { Buffer } from './buffer.js';
import {
	SourceHighlight,
	type SourceTokenColors,
	type SourceTokenizer,
} from './highlight.js';
import { textCanvas } from './text.js';

/**
 * Displays syntax-highlighted source code using viewport rendering.
 *
 * @title Code
 * @icon code
 * @alpha
 */
export class Code extends Component {
	tokenizer?: SourceTokenizer;
	tokenColors: SourceTokenColors = {};
	protected readonly buffer = new Buffer();
	protected readonly host = create('div', { id: 'body' });
	protected readonly text = textCanvas(this.host);
	protected readonly refresh = new ReplaySubject<{ dataLength: number }>(1);
	protected readonly highlight = new SourceHighlight(() =>
		this.refresh.next({ dataLength: this.buffer.getLineCount() }),
	);
	protected offsetY = 0;

	static {
		component(Code, {
			tagName: 'c-code',
			init: [
				property('tokenizer'),
				property('tokenColors'),
			],
			augment: [
				css(`
:host {
	display: block;
	font-family: var(--cxl-font-monospace, monospace);
	overflow: auto;
	box-sizing: border-box;
	position: relative;
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
`),
				$ => {
					const { highlight, host, refresh, text } = $;
					const readBuffer = () => $.buffer.getText();

					host.append(text.canvas, text.measureElement);
					$.shadowRoot?.append(host);
					$.setAttribute('role', 'code');
					highlight.reset(readBuffer, $.tokenizer);
					refresh.next({ dataLength: $.buffer.getLineCount() });

					return merge(
						onFontsReady().switchMap(() =>
							onVisibility($).switchMap(visible =>
								visible
									? merge(
											onResize(host).raf(() => {
												if (
													host.clientHeight > 0 &&
													host.clientWidth > 0
												)
													text.resize();
											}),
											virtualScroll({
												host,
												scrollElement: $,
												scrollContainer: $.shadowRoot ?? undefined,
												refresh,
												render(index, order) {
													if (order === 0) text.begin(index);
													return text.renderLine(
														index,
														$.buffer.getLine(index),
														highlight.getLine(index),
													);
												},
												dataLength: $.buffer.getLineCount(),
												translate: false,
											}).tap(event => {
												$.offsetY = event.offset;
												text.commit(event.offset);
												$.rendered();
											}),
										)
									: EMPTY,
							),
						),
						get($, 'tokenizer').tap(tokenizer =>
							highlight.reset(readBuffer, tokenizer),
						),
						get($, 'tokenColors').tap(colors => {
							text.setTokenColors(colors);
							refresh.next({ dataLength: $.buffer.getLineCount() });
						}),
						onThemeChange.tap(() => {
							text.updateStyles();
							refresh.next({ dataLength: $.buffer.getLineCount() });
						}),
					);
				},
			],
		});
	}

	getText(start?: number, end?: number) {
		if (start === undefined) return this.buffer.getText();
		return end === undefined
			? this.buffer.getText(start)
			: this.buffer.getText(start, end);
	}

	setText(text: string) {
		this.buffer.reset(text);
		if (this.host.parentNode) {
			this.text.resize();
			this.highlight.reset(text, this.tokenizer);
			this.refresh.next({ dataLength: this.buffer.getLineCount() });
		}
		this.reset();
	}

	getTokenAt(index: number) {
		return this.highlight.getTokenAt(index);
	}

	protected rendered() {}

	protected reset() {}

	protected replace(start: number, end: number, value: string) {
		const change = this.buffer.replace(start, end, value);
		this.text.invalidate(
			change.lineStart,
			change.lineEnd,
			change.lineDelta,
		);
		this.highlight.reset(
			() => this.buffer.getText(),
			this.tokenizer,
			change.start,
			change.lineStart,
		);
		this.refresh.next({ dataLength: this.buffer.getLineCount() });
		return change;
	}
}
