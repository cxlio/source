import {
	EMPTY,
	merge,
	Component,
	component,
	create,
	get,
	css,
	property,
	type Observable,
} from '@cxl/ui';
import { Buffer, type BufferChange } from './buffer.js';
import {
	SourceHighlight,
	type SourceToken,
	type SourceTokenColors,
	type SourceTokenizer,
} from './highlight.js';

/**
 * Displays syntax-highlighted source code as selectable HTML.
 *
 * @title Code
 * @icon code
 * @alpha
 */
export class Code extends Component {
	tokenizer?: SourceTokenizer;
	tokenColors: SourceTokenColors = {};
	protected readonly buffer = new Buffer();
	protected readonly highlight = new SourceHighlight((done, tokens) =>
		this.highlighted(done, tokens),
	);
	declare protected content: HTMLElement;
	protected initialized = false;
	declare protected pre: HTMLPreElement;
	protected tokens: readonly SourceToken[] = [];

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
}
pre {
	box-sizing: border-box;
	font: inherit;
	margin: 0;
	min-height: 100%;
	white-space: pre-wrap;
	word-break: break-word;
}
code { font: inherit; }
@media (forced-colors: active) {
	span { color: CanvasText !important; }
}
`),
				$ => {
					const renderer = $.initializeRenderer();
					$.initialized = true;
					$.resetRenderer();
					$.highlight.reset(() => $.buffer.getText(), $.tokenizer);
					$.setAttribute('role', 'code');

					return merge(
						renderer ?? EMPTY,
						get($, 'tokenizer').tap(tokenizer => {
							$.resetRenderer();
							$.highlight.reset(() => $.buffer.getText(), tokenizer);
						}),
						get($, 'tokenColors').tap(() => $.colorsChanged()),
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
		if (this.initialized) {
			this.resetRenderer();
			this.highlight.reset(text, this.tokenizer);
		}
		this.reset();
	}

	getTokenAt(index: number) {
		return this.highlight.getTokenAt(index);
	}

	protected initializeRenderer(): Observable<unknown> | undefined {
		this.content = create('code');
		this.pre = create('pre', {}, this.content);
		this.shadowRoot?.append(this.pre);
		return undefined;
	}

	protected resetRenderer() {
		this.content.textContent = this.buffer.getText();
	}

	protected replaced(_change: BufferChange) {
		this.resetRenderer();
	}

	protected highlighted(done: boolean, tokens: readonly SourceToken[]) {
		this.tokens = tokens;
		if (done && this.tokenizer) this.renderTokens(tokens);
	}

	protected colorsChanged() {
		if (this.tokenizer) this.renderTokens(this.tokens);
	}

	protected renderTokens(tokens: readonly SourceToken[]) {
		const source = this.buffer.getText();
		const fragment = document.createDocumentFragment();
		let index = 0;
		const appendText = (value: string) => {
			const last = fragment.lastChild;
			if (last instanceof Text) last.appendData(value);
			else fragment.append(document.createTextNode(value));
		};

		for (const token of tokens) {
			const start = Math.max(index, token.start);
			const end = Math.min(source.length, token.end);
			if (start > index) appendText(source.slice(index, start));
			if (end > start) {
				const value = source.slice(start, end);
				const color = this.tokenColors[token.kind];
				if (color) {
					const span = create('span');
					span.style.color = color;
					span.textContent = value;
					fragment.append(span);
				} else appendText(value);
			}
			index = Math.max(index, end);
		}
		if (index < source.length) appendText(source.slice(index));
		this.content.replaceChildren(fragment);
	}

	protected rendered() {}

	protected reset() {}

	protected replace(start: number, end: number, value: string) {
		const change = this.buffer.replace(start, end, value);
		this.replaced(change);
		this.highlight.reset(
			() => this.buffer.getText(),
			this.tokenizer,
			change.start,
			change.lineStart,
		);
		return change;
	}
}
