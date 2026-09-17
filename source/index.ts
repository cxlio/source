import {
	EMPTY,
	on,
	onResize,
	focused,
	merge,
	component,
	create,
	css,
	get,
	property,
	type Observable,
	onThemeChange,
	onFontsReady,
	virtualScroll,
	ReplaySubject,
	Subject,
} from '@cxl/ui';
import { textCanvas } from './text.js';
import { sourceCursor } from './cursor.js';
import { HitTest } from './hit-test.js';
import { type BufferChange, type BufferPosition } from './buffer.js';
import { createTextInput, type TextInputUpdate } from './input.js';
import { Code } from './code.js';
import { type SourceGutter } from './gutter.js';
import {
	sourceDecorations,
	type SourceDecorationSet,
	type SourceDecorationsFeature,
	type SourceRange,
} from './decoration.js';

export { Code } from './code.js';
export {
	gutterMarkers,
	lineNumbers,
	type SourceGutter,
	type SourceGutterMarkers,
	type SourceGutterRenderContext,
	type SourceLineInfo,
} from './gutter.js';

export {
	type SourceToken,
	type SourceTokenColors,
	type SourceTokenSpan,
	type SourceTokenizer,
} from './highlight.js';

export {
	type SourceDecoration,
	type SourceDecorationFragment,
	type SourceDecorationHandle,
	type SourceDecorationLayer,
	type SourceDecorationLayerOptions,
	type SourceDecorationPaintContext,
	type SourceDecorationSet,
	type SourceDecorationsFeature,
	type SourceRange,
} from './decoration.js';

export type SourceChange = BufferChange;
export type SourcePosition = BufferPosition;
export type SourceSearchQuery = string | RegExp;

export interface SourceSelectionFeature {
	range(): SourceRange;
	set(anchor: number, head?: number): void;
}

export interface SourceEditFeature {
	replace(value: string, range?: SourceRange): SourceChange;
}

export interface SourceCursorNavigationFeature {
	readonly index: number;
	go(index: number): void;
	range(from?: number, to?: number): SourceRange;
	goStart(): void;
	goEnd(): void;
	next(): void;
	previous(): void;
	nextPage(): void;
	previousPage(): void;
}

export interface SourceCursorFeature extends SourceCursorNavigationFeature {
	indexAt(position: SourcePosition): number;
	position(index?: number): SourcePosition;
}

export interface SourceCursorYFeature extends SourceCursorNavigationFeature {
	getVisibleFirst(): number;
}

export interface SourceHistoryFeature {
	undo(): void;
	redo(): void;
}

export interface SourceSearchOptions {
	reverse?: boolean;
	caseSensitive?: boolean;
}

export interface SourceSearchFeature {
	lastSearch?: SourceSearchQuery;
	lastOptions?: SourceSearchOptions;
	lastReplace?: string;
	find(
		query?: SourceSearchQuery,
		options?: SourceSearchOptions,
	): SourceRange | undefined;
	findAll(query?: SourceSearchQuery, options?: SourceSearchOptions): SourceRange[];
	findNext(): SourceRange | undefined;
	findPrevious(): SourceRange | undefined;
	highlight(query?: SourceSearchQuery, options?: SourceSearchOptions): void;
	replaceNext(
		query?: SourceSearchQuery,
		value?: string,
		options?: SourceSearchOptions,
	): void;
	replaceAll(
		query?: SourceSearchQuery,
		value?: string,
		options?: SourceSearchOptions,
	): void;
}

interface SelectionSnapshot {
	anchor: number;
	head: number;
}

interface HistoryRecord {
	change: SourceChange;
	before: SelectionSnapshot;
	after: SelectionSnapshot;
}

interface ActiveSearch {
	query: SourceSearchQuery;
	caseSensitive?: boolean;
	range: SourceRange;
}

const MaxHistoryEntries = 1_000;
const MaxHistoryText = 16 * 1024 * 1024;
const DefaultSearchHighlight = 'rgba(255, 210, 0, 0.35)';

function* searchMatches(
	value: string,
	query: SourceSearchQuery,
	caseSensitive?: boolean,
): Generator<SourceRange> {
	if (typeof query === 'string') {
		if (!query) return;
		query = new RegExp(
			query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
			caseSensitive ? '' : 'i',
		);
	}

	let flags = query.flags.replace(/[gy]/g, '');
	if (caseSensitive === true) flags = flags.replace(/i/g, '');
	else if (caseSensitive === false && !flags.includes('i')) flags += 'i';
	const expression = new RegExp(query.source, `${flags}g`);
	let match = expression.exec(value);
	while (match) {
		yield { start: match.index, end: match.index + match[0].length };
		if (!match[0]) {
			const codePoint = value.codePointAt(expression.lastIndex);
			expression.lastIndex += expression.unicode && (codePoint ?? 0) > 0xffff
				? 2
				: 1;
		}
		match = expression.exec(value);
	}
}

/**
 * Displays a large text buffer with incremental editing and viewport rendering.
 * Native text input, selection, and composition are synchronized with the
 * document buffer while only visible lines are measured and painted.
 *
 * @title Source Code Editor
 * @icon subject
 * @alpha
 */
export class Source extends Code {
	fatCursor = false;
	gutters: readonly SourceGutter[] = [];
	readonly changes: Observable<SourceChange>;
	readonly cursor: SourceCursorFeature = (() => {
		const source = this;
		return {
			get index() {
				return source.selectionHead;
			},
			go: index => source.selection.set(index),
			indexAt: position => source.buffer.indexAt(position),
			position: (index = source.selectionHead) =>
				source.buffer.positionAt(source.clampSelection(index)),
			range: (from = source.selectionHead, to = from) => ({
				start: source.clampSelection(Math.min(from, to)),
				end: source.clampSelection(Math.max(from, to)),
			}),
			goStart: () => source.selection.set(0),
			goEnd: () => source.selection.set(Infinity),
			next: () => source.moveHorizontal(1),
			previous: () => source.moveHorizontal(-1),
			nextPage: () => source.selection.set(source.selectionHead + 10),
			previousPage: () => source.selection.set(source.selectionHead - 10),
		};
	})();
	readonly cursorX: SourceCursorNavigationFeature = (() => {
		const source = this;
		return {
			get index() {
				return source.buffer.positionAt(source.selectionHead).ch;
			},
			go: index => source.goColumn(index),
			range: (from = source.cursorX.index, to = from) => {
				const line = source.buffer.positionAt(source.selectionHead).line;
				const start = source.buffer.indexAt({ line, ch: from });
				const end = source.buffer.indexAt({ line, ch: to });
				const lineStart = source.buffer.indexAt({ line, ch: 0 });
				return {
					start: Math.min(start, end) - lineStart,
					end: Math.max(start, end) - lineStart,
				};
			},
			goStart: () => source.goColumn(0),
			goEnd: () => source.goColumn(Infinity),
			next: () => source.moveHorizontal(1),
			previous: () => source.moveHorizontal(-1),
			nextPage: () => source.goColumn(source.cursorX.index + 10),
			previousPage: () => source.goColumn(source.cursorX.index - 10),
		};
	})();
	readonly cursorY: SourceCursorYFeature = (() => {
		const source = this;
		return {
			get index() {
				return source.buffer.positionAt(source.selectionHead).line;
			},
			go: index => source.goLine(index),
			range: (from = source.cursorY.index, to = from) =>
				source.buffer.lineRange(from, to),
			goStart: () => source.goLine(0),
			goEnd: () => source.goLine(Infinity),
			next: () => source.moveVertical(1),
			previous: () => source.moveVertical(-1),
			nextPage: () => source.movePage(1),
			previousPage: () => source.movePage(-1),
			getVisibleFirst: () => source.text.firstVisibleLine,
		};
	})();
	readonly cursorToken: SourceCursorNavigationFeature = (() => {
		const source = this;
		return {
			get index() {
				return source.tokenIndex();
			},
			go: index => source.goToken(index),
			range: (from = source.tokenIndex(), to = from) =>
				source.tokenRange(from, to),
			goStart: () => source.goToken(0),
			goEnd: () => source.goToken(Infinity),
			next: () => source.goToken(source.tokenIndex() + 1),
			previous: () => source.goToken(source.tokenIndex() - 1),
			nextPage: () => source.goToken(source.tokenIndex() + 10),
			previousPage: () => source.goToken(source.tokenIndex() - 10),
		};
	})();
	readonly selection: SourceSelectionFeature = {
		range: () => ({
			start: Math.min(this.selectionAnchor, this.selectionHead),
			end: Math.max(this.selectionAnchor, this.selectionHead),
		}),
		set: (anchor, head = anchor) =>
			this.setSelectionState(anchor, head, true),
	};
	readonly edit: SourceEditFeature = {
		replace: (value, range = this.selection.range()) =>
			this.applyEdit(value, range),
	};
	readonly history: SourceHistoryFeature = {
		undo: () => {
			const record = this.undoRecords.pop();
			if (!record) return;
			this.undoSize -= this.historyRecordSize(record);
			const { change } = record;
			this.applyEdit(
				change.removed,
				{ start: change.start, end: change.start + change.text.length },
				record.before,
				false,
			);
			this.redoRecords.push(record);
			this.redoSize = this.trimHistory(
				this.redoRecords,
				this.redoSize + this.historyRecordSize(record),
			);
		},
		redo: () => {
			const record = this.redoRecords.pop();
			if (!record) return;
			this.redoSize -= this.historyRecordSize(record);
			const { change } = record;
			this.applyEdit(
				change.text,
				{ start: change.start, end: change.start + change.removed.length },
				record.after,
				false,
			);
			this.undoRecords.push(record);
			this.undoSize = this.trimHistory(
				this.undoRecords,
				this.undoSize + this.historyRecordSize(record),
			);
		},
	};
	readonly search: SourceSearchFeature = {
		find: (query = this.search.lastSearch, options = this.search.lastOptions) =>
			this.findSearch(query, options),
		findAll: (
			query = this.search.lastSearch,
			options = this.search.lastOptions,
		) => this.findAllSearch(query, options),
		findNext: () =>
			this.findSearch(this.search.lastSearch, {
				...this.search.lastOptions,
				reverse: false,
			}),
		findPrevious: () =>
			this.findSearch(this.search.lastSearch, {
				...this.search.lastOptions,
				reverse: true,
			}),
		highlight: (query, options) => this.highlightSearch(query, options),
		replaceNext: (
			query = this.search.lastSearch,
			value = this.search.lastReplace,
			options = this.search.lastOptions,
		) => {
			if (value === undefined) return;
			this.search.lastReplace = value;
			const selection = this.selection.range();
			const active = this.activeSearch;
			const range =
				active !== undefined &&
				active.query === query &&
				active.caseSensitive === options?.caseSensitive &&
				active.range.start === selection.start &&
				active.range.end === selection.end
					? selection
					: this.findSearch(query, options);
			if (range) this.edit.replace(value, range);
		},
		replaceAll: (
			query = this.search.lastSearch,
			value = this.search.lastReplace,
			options = this.search.lastOptions,
		) => {
			if (value === undefined) return;
			this.search.lastReplace = value;
			const ranges = this.findAllSearch(query, options).reverse();
			for (const range of ranges) this.edit.replace(value, range);
		},
	};
	protected activeSearch?: ActiveSearch;
	protected readonly changeSubject = new Subject<SourceChange>();
	protected readonly gutterHost = (() => {
		const element = create('div', { id: 'gutters' });
		element.setAttribute('part', 'gutters');
		return element;
	})();
	protected readonly host = create('div', { id: 'body' });
	protected offsetY = 0;
	protected readonly redoRecords: HistoryRecord[] = [];
	protected redoSize = 0;
	protected readonly refresh = new ReplaySubject<{ dataLength: number }>(1);
	protected selectionAnchor = 0;
	protected selectionHead = 0;
	protected selectionSync?: (scroll: boolean) => void;
	protected readonly text = textCanvas(this.host);
	protected readonly hitTest = new HitTest(this.text);
	protected preferredX?: number;
	protected readonly decorationRenderer = sourceDecorations(
		this.host,
		range => {
			const normalized = this.cursor.range(range.start, range.end);
			const start = this.buffer.positionAt(normalized.start);
			const end = this.buffer.positionAt(normalized.end);
			return this.text.getSelectionRects(start, end).map(fragment => ({
				...fragment,
				y: fragment.y + this.offsetY,
				start: this.buffer.indexAt({
					line: fragment.line,
					ch: fragment.start,
				}),
				end: this.buffer.indexAt({
					line: fragment.line,
					ch: fragment.end,
				}),
			}));
		},
		() => {
			const first = this.text.toRender.at(0);
			const last = this.text.toRender.at(-1);
			return {
				start: first
					? this.buffer.indexAt({ line: first.row, ch: 0 })
					: 0,
				end: last
					? this.buffer.indexAt({
							line: last.row,
							ch: last.text.length,
						})
					: 0,
			};
		},
	);
	protected readonly searchDecorations: SourceDecorationSet<undefined> =
		this.decorations.create({
			layer: 'behind-text',
			paint: ({ context, fragments }) => {
				context.fillStyle = this.searchDecorationColor;
				context.globalAlpha = this.searchDecorationAlpha;
				for (const fragment of fragments)
					context.fillRect(
						fragment.x,
						fragment.y,
						fragment.width,
						fragment.height,
					);
			},
		});
	protected searchDecorationAlpha = 1;
	protected searchDecorationColor = DefaultSearchHighlight;
	protected searchHighlight?: {
		query: SourceSearchQuery;
		caseSensitive?: boolean;
	};
	protected readonly undoRecords: HistoryRecord[] = [];
	protected undoSize = 0;

	static {
		component(Source, {
			tagName: 'c-source',
			init: [property('fatCursor'), property('gutters')],
			augment: [
				css(`
:host {
	cursor: text;
	outline: none;
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
#body { height:100%; position:relative; }
#gutters {
	background: var(--cxl-color-surface-container, Canvas);
	color: var(--cxl-color-on-surface-variant, CanvasText);
	cursor: default;
	display: flex;
	height: 100%;
	left: 0;
	overflow: hidden;
	position: absolute;
	top: 0;
	z-index: 1;
}
#gutters > [part~="gutter"],
#gutters > [part~="gutter-group"] > [part~="gutter"] {
	box-sizing: border-box;
	min-width: 1em;
	position: relative;
}
#gutters > [part~="gutter-group"] { display: flex; }
#gutters [part~="line-numbers"] { text-align: right; }
#gutters [part~="gutter-element"] {
	box-sizing: border-box;
	left: 0;
	overflow: hidden;
	padding: 0 0.5ch;
	position: absolute;
	right: 0;
}
#gutters [part~="gutter-element"] > * {
	box-sizing: border-box;
	height: 100%;
	width: 100%;
}
#measure {
	visibility:hidden;
	position: absolute;
	top: 0; left: var(--source-gutter-width, 0px);
	width: calc(100% - var(--source-gutter-width, 0px));
	white-space: pre-wrap;
	word-break: break-word;
}
#input {
	position: fixed;
	width: 1px;
	height: 1px;
	padding: 0;
	border: 0;
	opacity: 0;
	resize: none;
}
`),
				$ => {
					const { buffer } = $;
					const host = $.host;
					const text = $.text;
					const cursor = sourceCursor(host);
					const hitTest = $.hitTest;
					const input = createTextInput($, host);
					const paste = on(input.element, 'paste');
					const contextRadius = 2048;

					let inputEnd = 0;
					let inputStart = 0;
					let pointerAnchor: number | undefined;

					host.insertBefore(cursor.canvas, text.measureElement);
					$.tabIndex = input.kind === 'edit-context' ? 0 : -1;
					$.setAttribute('role', 'textbox');
					$.setAttribute('aria-multiline', 'true');
					$.autocapitalize = 'off';
					$.setAttribute('autocorrect', 'off');
					$.spellcheck = false;
					if (!$.hasAttribute('aria-label'))
						$.setAttribute('aria-label', 'Source editor');

					function syncInput() {
						const { selectionAnchor: anchor, selectionHead: head } = $;
						if (
							!inputEnd ||
							head < inputStart + contextRadius / 4 ||
							head > inputEnd - contextRadius / 4
						) {
							inputStart = Math.max(0, head - contextRadius);
							inputEnd = Math.min(buffer.length, head + contextRadius);
						}
						inputEnd = Math.min(inputEnd, buffer.length);
						const length = inputEnd - inputStart;
						input.sync(
							buffer.getText(inputStart, inputEnd),
							Math.max(0, Math.min(anchor - inputStart, length)),
							Math.max(0, Math.min(head - inputStart, length)),
							inputStart,
						);
					}

					function renderSelection() {
						const { selectionAnchor: anchor, selectionHead: head } = $;
						const start = buffer.positionAt(Math.min(anchor, head));
						const end = buffer.positionAt(Math.max(anchor, head));
						cursor.setSelection(
							text.getSelectionRects(start, end),
							$.offsetY,
						);
						const caret = text.getCaret(buffer.positionAt(head));
						if (caret && $.matches(':focus-within')) {
							cursor.setPosition(caret, $.offsetY);
							input.setBounds(cursor.bounds);
						} else cursor.hideCaret();
					}

					function scrollToHead() {
						const position = buffer.positionAt($.selectionHead);
						const caret = text.getCaret(position);
						if (caret) {
							const top = caret.y + $.offsetY;
							if (top < 0) $.scrollTop += top;
							else if (top + caret.height > $.clientHeight)
								$.scrollTop += top + caret.height - $.clientHeight;
						} else {
							const lineHeight = text.measureElement.offsetHeight || 16;
							$.scrollTop = position.line * lineHeight;
						}
					}

					function setSelection(next: number, extend = false) {
						$.setSelectionState(
							extend ? $.selectionAnchor : next,
							next,
							true,
						);
					}

					function replaceSelection(value: string) {
						$.edit.replace(value);
					}

					function normalizeInput(update: TextInputUpdate) {
						return update.start === $.selectionHead - 1 && /^\. ?$/.test(update.text)
							? { ...update, text: update.text.replace('.', ' ') }
							: update;
					}

					function copySelection(event: ClipboardEvent) {
						const { start, end } = $.selection.range();
						if (start === end || !event.clipboardData) return false;
						event.preventDefault();
						event.clipboardData.setData(
							'text/plain',
							buffer.getText(start, end),
						);
						return true;
					}

					function insertKey(event: KeyboardEvent) {
						const value: string | undefined = {
							Enter: '\n',
							Tab: '\t',
						}[event.key];
						if (value === undefined) return false;
						event.preventDefault();
						replaceSelection(value);
						return true;
					}

					function clipboardKey(event: KeyboardEvent) {
						if (
							input.kind !== 'edit-context' ||
							(!event.ctrlKey && !event.metaKey)
						)
							return;
						const key = event.key.toLowerCase();
						if (
							(key !== 'c' && key !== 'x' && key !== 'v') ||
							(key !== 'v' && $.selectionAnchor === $.selectionHead)
						)
							return;
						input.clipboardElement.removeAttribute('aria-hidden');
						input.clipboardElement.focus({ preventScroll: true });
					}

					function restoreClipboardFocus() {
						if (input.clipboardElement === input.element) return;
						input.clipboardElement.setAttribute('aria-hidden', 'true');
						input.focus();
					}

					function moveKey(event: KeyboardEvent) {
						const extend = event.shiftKey;
						const { selectionAnchor: anchor, selectionHead: head } = $;
						let next: number | undefined;
						let feature: SourceCursorNavigationFeature | undefined;
						let movement:
							| 'goStart'
							| 'goEnd'
							| 'next'
							| 'previous'
							| 'nextPage'
							| 'previousPage'
							| undefined;
						clipboardKey(event);
						if (insertKey(event)) return;
						if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
							event.preventDefault();
							$.setSelectionState(0, buffer.length, false);
							return;
						} else if (event.key === 'ArrowLeft') {
							if (!extend && anchor !== head) next = Math.min(anchor, head);
							else {
								feature = $.cursorX;
								movement = 'previous';
							}
						} else if (event.key === 'ArrowRight') {
							if (!extend && anchor !== head) next = Math.max(anchor, head);
							else {
								feature = $.cursorX;
								movement = 'next';
							}
						} else if (event.key === 'ArrowUp') {
							feature = $.cursorY;
							movement = 'previous';
						} else if (event.key === 'ArrowDown') {
							feature = $.cursorY;
							movement = 'next';
						} else if (event.key === 'Home') {
							feature = $.cursorX;
							movement = 'goStart';
						} else if (event.key === 'End') {
							feature = $.cursorX;
							movement = 'goEnd';
						} else if (event.key === 'PageUp' || event.key === 'PageDown') {
							feature = $.cursorY;
							movement = event.key === 'PageUp' ? 'previousPage' : 'nextPage';
						} else return;

						event.preventDefault();
						if (feature && movement) {
							feature[movement]();
							if (extend)
								$.setSelectionState(
									anchor,
									$.selectionHead,
									true,
									feature === $.cursorY,
								);
						} else if (next !== undefined) setSelection(next, extend);
					}

					function pointerPosition(event: PointerEvent) {
						const rect = host.getBoundingClientRect();
						const caret = hitTest.getCaretAtPosition(
							event.clientX - rect.left,
							event.clientY - rect.top,
						);
						return caret && buffer.indexAt(caret.position);
					}

					function stopPointerSelection(event?: PointerEvent) {
						if (event && $.hasPointerCapture(event.pointerId))
							$.releasePointerCapture(event.pointerId);
						pointerAnchor = undefined;
					}

					function resetEditor() {
						$.clearHistory();
						inputEnd = inputStart = 0;
						$.setSelectionState(
							Math.min($.selectionHead, buffer.length),
							Math.min($.selectionHead, buffer.length),
							false,
						);
					}

					$.selectionSync = scroll => {
						syncInput();
						if (scroll) scrollToHead();
						renderSelection();
					};
					$.rendered = renderSelection;
					$.reset = resetEditor;
					resetEditor();

					return merge(
						onResize(host).raf(() => cursor.resize()),
						focused($).tap(value =>
							value ? renderSelection() : cursor.hideCaret(),
						),
						get($, 'fatCursor').tap(value => {
							cursor.setOptions({ type: value ? 'block' : 'text' });
							renderSelection();
						}),
						input.updates.tap(update => {
							update = normalizeInput(update);
							$.applyEdit(
								update.text,
								{ start: update.start, end: update.end },
								{
									anchor: update.selectionStart,
									head: update.selectionEnd,
								},
								true,
								true,
							);
						}),
						on(input.element, 'keydown').tap(moveKey),
						on(input.element, 'copy').tap(event => {
							copySelection(event);
							restoreClipboardFocus();
						}),
						on(input.element, 'cut').tap(event => {
							if (copySelection(event)) replaceSelection('');
							restoreClipboardFocus();
						}),
						paste.tap(event => {
							const value = event.clipboardData?.getData('text/plain');
							if (value === undefined) return;
							event.preventDefault();
							replaceSelection(value);
							restoreClipboardFocus();
						}),
						on($, 'pointerdown').tap(event => {
							if (event.button !== 0) return;
							if (event.composedPath().includes($.gutterHost)) return;
							const position = pointerPosition(event);
							if (position === undefined) return;
							event.preventDefault();
							input.focus();
							pointerAnchor = event.shiftKey
								? $.selectionAnchor
								: position;
							$.setPointerCapture(event.pointerId);
							$.setSelectionState(pointerAnchor, position, false);
						}),
						on($, 'pointermove').tap(event => {
							if (pointerAnchor === undefined) return;
							if (!(event.buttons & 1)) {
								stopPointerSelection(event);
								return;
							}
							const position = pointerPosition(event);
							if (position === undefined) return;
							$.setSelectionState(pointerAnchor, position, false);
						}),
						on($, 'pointerup').tap(stopPointerSelection),
						on($, 'pointercancel').tap(stopPointerSelection),
						on($, 'lostpointercapture').tap(() => {
							pointerAnchor = undefined;
						}),
						onThemeChange.tap(() => {
							cursor.updateStyles();
						}),
						get($, 'gutters')
							.tap(gutters => {
								$.gutterHost.replaceChildren(
									...gutters.map(gutter => gutter.element),
								);
								$.refresh.next({ dataLength: buffer.getLineCount() });
							})
							.switchMap(gutters => {
								const changes = gutters.flatMap(gutter =>
									gutter.changes ? [gutter.changes] : [],
								);
								return changes.length ? merge(...changes) : EMPTY;
							})
							.tap(() =>
								$.refresh.next({ dataLength: buffer.getLineCount() }),
							),
					);
				},
			],
		});
	}

	constructor() {
		super();
		this.changes = this.changeSubject;
	}

	get decorations(): SourceDecorationsFeature {
		return this.decorationRenderer;
	}

	protected goColumn(ch: number) {
		const { line } = this.buffer.positionAt(this.selectionHead);
		this.selection.set(this.buffer.indexAt({ line, ch }));
	}

	protected moveHorizontal(direction: -1 | 1) {
		let next = this.selectionHead + direction;
		if (
			direction === 1 &&
			this.buffer.charAt(this.selectionHead) === '\r' &&
			this.buffer.charAt(this.selectionHead + 1) === '\n'
		)
			next++;
		else if (
			direction === -1 &&
			this.buffer.charAt(this.selectionHead - 2) === '\r' &&
			this.buffer.charAt(this.selectionHead - 1) === '\n'
		)
			next--;
		this.selection.set(next);
	}

	protected goLine(line: number) {
		this.selection.set(this.buffer.indexAt({ line, ch: 0 }));
	}

	protected moveVertical(direction: -1 | 1) {
		const position = this.buffer.positionAt(this.selectionHead);
		const caret = this.text.getCaret(position);
		let next: number | undefined;
		if (caret) {
			const x = this.preferredX ?? caret.x;
			this.preferredX = x;
			const hit = this.hitTest.getCaretAtPosition(
				x,
				caret.y + this.offsetY + direction * caret.height + caret.height / 2,
			);
			if (hit) next = this.buffer.indexAt(hit.position);
		}
		if (next === undefined || next === this.selectionHead)
			next = this.buffer.indexAt({
				line: position.line + direction,
				ch: position.ch,
			});
		this.setSelectionState(next, next, true, true);
	}

	protected movePage(direction: -1 | 1) {
		const position = this.buffer.positionAt(this.selectionHead);
		const lineHeight = this.text.measureElement.offsetHeight || 16;
		const lines = Math.max(1, Math.floor(this.clientHeight / lineHeight));
		const next = this.buffer.indexAt({
			line: position.line + direction * lines,
			ch: position.ch,
		});
		this.setSelectionState(next, next, true, true);
	}

	protected tokenIndex() {
		const tokens = this.highlight.getNavigationTokens();
		let low = 0;
		let high = tokens.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			const token = tokens[middle];
			if (token && token.end <= this.selectionHead) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	protected tokenRange(from: number, to: number): SourceRange {
		const tokens = this.highlight.getNavigationTokens();
		if (!tokens.length)
			return { start: this.selectionHead, end: this.selectionHead };
		from = this.normalizeOrdinal(from, tokens.length);
		to = this.normalizeOrdinal(to, tokens.length);
		if (from > to) [from, to] = [to, from];
		return {
			start: tokens[from]?.start ?? this.buffer.length,
			end: tokens[to]?.end ?? this.buffer.length,
		};
	}

	protected goToken(index: number) {
		const tokens = this.highlight.getNavigationTokens();
		if (!tokens.length) return;
		index = this.normalizeOrdinal(index, tokens.length);
		this.selection.set(tokens[index]?.start ?? this.buffer.length);
	}

	protected normalizeOrdinal(index: number, maximum: number) {
		if (index === Infinity) return maximum;
		if (!Number.isFinite(index)) return 0;
		return Math.max(0, Math.min(Math.trunc(index), maximum));
	}

	protected applyEdit(
		value: string,
		range: SourceRange,
		after?: SelectionSnapshot,
		record = true,
		coalesce = false,
	) {
		const before = this.selectionSnapshot();
		const start = Math.min(range.start, range.end);
		const change = this.replace(start, Math.max(range.start, range.end), value);
		const next = change.start + value.length;
		this.setSelectionState(
			after?.anchor ?? next,
			after?.head ?? next,
			false,
		);
		if (record) {
			this.recordHistory({
				change,
				before,
				after: this.selectionSnapshot(),
			}, coalesce);
		}
		this.changeSubject.next(change);
		return change;
	}

	protected clearHistory() {
		this.redoRecords.length = 0;
		this.redoSize = 0;
		this.undoRecords.length = 0;
		this.undoSize = 0;
	}

	protected findAllSearch(
		query: SourceSearchQuery | undefined,
		options: SourceSearchOptions = {},
	) {
		if (query === undefined) return [];
		this.search.lastSearch = query;
		this.search.lastOptions = { ...options };
		return [...searchMatches(this.getText(), query, options.caseSensitive)];
	}

	protected findSearch(
		query: SourceSearchQuery | undefined,
		options: SourceSearchOptions = {},
	) {
		if (query === undefined) return;
		const current = this.selection.range();
		const active = this.activeSearch;
		const reverse = options.reverse ?? false;
		let boundary = reverse ? current.start : current.end;
		if (
			active?.query === query &&
			active.caseSensitive === options.caseSensitive &&
			active.range.start === current.start &&
			active.range.end === current.end &&
			current.start === current.end
		)
			boundary += reverse ? -1 : 1;

		let first: SourceRange | undefined;
		let last: SourceRange | undefined;
		let match: SourceRange | undefined;
		for (const range of searchMatches(
			this.getText(),
			query,
			options.caseSensitive,
		)) {
			first ??= range;
			last = range;
			if (reverse) {
				if (range.end <= boundary) match = range;
			} else if (range.start >= boundary) {
				match = range;
				break;
			}
		}
		match ??= reverse ? last : first;
		this.search.lastSearch = query;
		this.search.lastOptions = { ...options };
		if (!match) {
			this.selection.set(this.cursor.index);
			return;
		}
		this.selection.set(match.start, match.end);
		this.activeSearch = {
			query,
			caseSensitive: options.caseSensitive,
			range: match,
		};
		return match;
	}

	protected highlightSearch(
		query: SourceSearchQuery | undefined,
		options: SourceSearchOptions = {},
	) {
		if (query === undefined || query === '') {
			this.searchHighlight = undefined;
			this.searchDecorations.clear();
			return;
		}
		this.updateSearchDecorationStyle();
		this.searchHighlight = {
			query,
			caseSensitive: options.caseSensitive,
		};
		this.searchDecorations.replaceAll(
			[...searchMatches(this.getText(), query, options.caseSensitive)].map(
				range => ({ range, value: undefined }),
			),
		);
	}

	protected historyRecordSize(record: HistoryRecord) {
		return record.change.text.length + record.change.removed.length;
	}

	protected updateSearchDecorationStyle() {
		const forcedColors = matchMedia('(forced-colors: active)').matches;
		this.searchDecorationColor =
			getComputedStyle(this)
				.getPropertyValue('--cxl-source-search-highlight')
				.trim() ||
			(forcedColors ? 'Highlight' : DefaultSearchHighlight);
		this.searchDecorationAlpha = forcedColors ? 0.35 : 1;
	}

	protected recordHistory(record: HistoryRecord, coalesce: boolean) {
		this.redoRecords.length = 0;
		this.redoSize = 0;
		const previous = this.undoRecords.at(-1);
		if (
			coalesce &&
			previous?.after.anchor === record.before.anchor &&
			previous.after.head === record.before.head &&
			record.before.anchor === record.before.head &&
			record.after.anchor === record.after.head &&
			!record.change.removed &&
			record.change.start ===
				previous.change.start + previous.change.text.length
		) {
			this.undoSize -= this.historyRecordSize(previous);
			previous.change = {
				...previous.change,
				text: previous.change.text + record.change.text,
				lineEnd: Math.max(previous.change.lineEnd, record.change.lineEnd),
				lineDelta: previous.change.lineDelta + record.change.lineDelta,
			};
			previous.after = record.after;
			this.undoSize += this.historyRecordSize(previous);
		} else {
			this.undoRecords.push(record);
			this.undoSize += this.historyRecordSize(record);
		}
		this.undoSize = this.trimHistory(this.undoRecords, this.undoSize);
	}

	protected selectionSnapshot(): SelectionSnapshot {
		return { anchor: this.selectionAnchor, head: this.selectionHead };
	}

	protected setSelectionState(
		anchor: number,
		head: number,
		scroll: boolean,
		preservePreferredX = false,
	) {
		this.activeSearch = undefined;
		if (!preservePreferredX) this.preferredX = undefined;
		this.selectionAnchor = this.clampSelection(anchor);
		this.selectionHead = this.clampSelection(head);
		this.selectionSync?.(scroll);
	}

	protected trimHistory(records: HistoryRecord[], size: number) {
		while (records.length > MaxHistoryEntries || size > MaxHistoryText) {
			const record = records.shift();
			if (record) size -= this.historyRecordSize(record);
		}
		return size;
	}

	protected override initializeRenderer() {
		const { decorationRenderer, host, refresh, text } = this;
		host.append(
			this.gutterHost,
			decorationRenderer.behindCanvas,
			text.canvas,
			decorationRenderer.aboveCanvas,
			text.measureElement,
		);
		this.shadowRoot?.append(host);
		this.updateSearchDecorationStyle();
		refresh.next({ dataLength: this.buffer.getLineCount() });

		return merge(
			onResize(host).raf(() => {
				if (host.clientHeight > 0 && host.clientWidth > 0) text.resize();
			}),
			onResize(this.gutterHost).raf(() => {
				const width = this.gutterHost.offsetWidth;
				host.style.setProperty('--source-gutter-width', `${width}px`);
				this.resetRenderer();
			}),
			virtualScroll({
				host,
				scrollElement: this,
				scrollContainer: this.shadowRoot ?? undefined,
				refresh,
				render: (index, order) => {
					if (order === 0) text.begin(index);
					return text.renderLine(
						index,
						this.buffer.getLine(index),
						this.highlight.getLine(index),
					);
				},
				dataLength: this.buffer.getLineCount(),
				translate: false,
			}).tap(event => {
				this.offsetY = event.offset;
				text.commit(event.offset);
				decorationRenderer.render();
				for (const gutter of this.gutters)
					gutter.render({
						lines: text.toRender,
						lineCount: this.buffer.getLineCount(),
						offset: event.offset,
					});
				this.rendered();
			}),
			onFontsReady().tap(() => this.resetRenderer()),
			onThemeChange.tap(() => {
				text.updateStyles();
				this.updateSearchDecorationStyle();
				refresh.next({ dataLength: this.buffer.getLineCount() });
			}),
		);
	}

	protected override resetRenderer() {
		this.text.resize();
		this.refresh.next({ dataLength: this.buffer.getLineCount() });
	}

	protected override replaced(change: BufferChange) {
		for (const gutter of this.gutters) gutter.replaced?.(change);
		this.text.invalidate(
			change.lineStart,
			change.lineEnd,
			change.lineDelta,
		);
		this.decorationRenderer.replaced(change);
		if (this.searchHighlight)
			this.highlightSearch(this.searchHighlight.query, this.searchHighlight);
		this.refresh.next({ dataLength: this.buffer.getLineCount() });
	}

	protected override highlighted() {
		this.refresh.next({ dataLength: this.buffer.getLineCount() });
	}

	protected override colorsChanged() {
		this.text.setTokenColors(this.tokenColors);
		this.refresh.next({ dataLength: this.buffer.getLineCount() });
	}

	protected override rendered() {}

	protected override reset() {
		this.clearHistory();
		for (const gutter of this.gutters) gutter.reset?.();
		this.decorationRenderer.reset();
		if (this.searchHighlight)
			this.highlightSearch(this.searchHighlight.query, this.searchHighlight);
		this.selectionAnchor = this.selectionHead = Math.min(
			this.selectionHead,
			this.buffer.length,
		);
	}

	private clampSelection(index: number) {
		if (index === Infinity) return this.buffer.length;
		if (!Number.isFinite(index)) return 0;
		return Math.max(0, Math.min(Math.trunc(index), this.buffer.length));
	}
}
