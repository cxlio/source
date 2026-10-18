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
	onMutation,
	virtualScroll,
	ReplaySubject,
	Subject,
} from '@cxl/ui';
import { textCanvas, type SourceTextSpan } from './text.js';
import { sourceCursor } from './cursor.js';
import { HitTest } from './hit-test.js';
import { sourceGeometry, type SourceGeometryFeature } from './geometry.js';
export type {
	SourceBounds,
	SourceCaretGeometry,
	SourceGeometryFragment,
	SourceGeometryFeature,
} from './geometry.js';
import { type BufferChange, type BufferPosition } from './buffer.js';
import { createTextInput, type TextInputUpdate } from './input.js';
import { Code } from './code.js';
import { type SourceGutter } from './gutter.js';
import { SourceFolding, type SourceFoldFeature, type SourceFoldSpan } from './fold.js';
import type { SourceToken, SourceTokenSpan } from './highlight.js';
export { type SourceFoldFeature, type SourceFoldRange } from './fold.js';
import {
	sourceDecorations,
	type SourceDecorationsFeature,
	type SourceRange,
} from './decoration.js';

export { Code } from './code.js';
export { loadSourceHighlighter } from './modes.js';
export {
	gutterMarkers,
	foldGutter,
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
	type SourceHighlighter,
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

export interface SourceSelection {
	readonly anchor: number;
	readonly head: number;
}

export interface SourceSelectionFeature {
	readonly onChange: Observable<void>;
	range(): SourceRange;
	ranges(): SourceRange[];
	set(anchor: number, head?: number): void;
	block(anchor: number, head?: number): void;
	add(...ranges: SourceRange[]): void;
	begin(): void;
	end(): void;
	clear(): void;
	somethingSelected(): boolean;
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

type CursorMovement =
	| 'goStart'
	| 'goEnd'
	| 'next'
	| 'previous'
	| 'nextPage'
	| 'previousPage';

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

type SelectionSnapshot = readonly SourceSelection[];

interface HistoryRecord {
	changes: SourceChange[];
	before: SelectionSnapshot;
	after: SelectionSnapshot;
}

interface ActiveSearch {
	query: SourceSearchQuery;
	caseSensitive?: boolean;
	range: SourceRange;
}

const MaxHistoryEntries = 1_000;
const EstimatedRowHeight = 50;
const MaxHistoryText = 16 * 1024 * 1024;
const DefaultSearchHighlight = 'rgba(255, 210, 0, 0.35)';
const DefaultSelection: SourceSelection = { anchor: 0, head: 0 };

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

function selectionRange({ anchor, head }: SourceSelection): SourceRange {
	return { start: Math.min(anchor, head), end: Math.max(anchor, head) };
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
			nextPage: () => source.moveHorizontal(1, 10),
			previousPage: () => source.moveHorizontal(-1, 10),
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
			next: () => source.goToken(source.tokenIndex() + 1, 1),
			previous: () => source.goToken(source.tokenIndex() - 1, -1),
			nextPage: () => source.goToken(source.tokenIndex() + 10, 1),
			previousPage: () => source.goToken(source.tokenIndex() - 10, -1),
		};
	})();
	readonly selection: SourceSelectionFeature = (() => {
		const source = this;
		return {
			get onChange() {
				return source.selectionSubject;
			},
			range: () => selectionRange(this.activeSelection),
			ranges: () => this.selectionState.map(selectionRange),
			set: (anchor, head = anchor) => {
				this.blockAnchor = undefined;
				if (this.selectionExtending)
					this.setActiveSelectionState(this.selectionAnchor, head, true);
				else this.setSelectionState(anchor, head, true);
			},
			block: (anchor, head = anchor) =>
				this.setBlockSelectionState(anchor, head, true),
			add: (...ranges) => {
				if (!ranges.length) return;
				this.blockAnchor = undefined;
				this.setSelectionsState(
					[
						...this.selectionState,
						...ranges.map(range => ({
							anchor: range.start,
							head: range.end,
						})),
					],
					true,
				);
			},
			begin: () => {
				this.blockAnchor = undefined;
				this.selectionExtending = true;
			},
			end: () => {
				this.selectionExtending = false;
			},
			clear: () => {
				this.blockAnchor = undefined;
				this.setSelectionsState(
					[{ anchor: this.selectionAnchor, head: this.selectionAnchor }],
					true,
				);
			},
			somethingSelected: () =>
				this.selectionState.some(({ anchor, head }) => anchor !== head),
		};
	})();
	readonly edit: SourceEditFeature = {
		replace: (value, range) =>
			range
				? this.applyEdit(value, range)
				: this.applySelectionEdit(value),
	};
	readonly history: SourceHistoryFeature = {
		undo: () => {
			const record = this.undoRecords.pop();
			if (!record) return;
			this.undoSize -= this.historyRecordSize(record);
			this.replayHistory(record, true);
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
			this.replayHistory(record, false);
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
	protected readonly folding = new SourceFolding(
		this.buffer,
		() => this.cursorY.index,
		() => {
			this.text.invalidateGeometry();
			this.refresh.next({ dataLength: this.folding.visibleCount, resetFrom: 0 });
			const selections = this.selectionSnapshot().map(({ anchor, head }) => ({
				anchor: this.foldBoundary(anchor),
				head: this.foldBoundary(head),
			}));
			this.setSelectionsState(selections, false);
		},
	);
	protected activeSearch?: ActiveSearch;
	protected blockAnchor?: number;
	protected readonly changeSubject = new Subject<SourceChange>();
	protected selectionExtending = false;
	protected selectionState: SourceSelection[] = [DefaultSelection];
	protected readonly selectionSubject = new Subject<void>();
	protected readonly gutterHost = (() => {
		const element = create('div', { id: 'gutters' });
		element.setAttribute('part', 'gutters');
		return element;
	})();
	protected readonly host = create('div', { id: 'body' });
	protected offsetY = 0;
	protected readonly rowHeights = new Map<number, number>();
	protected readonly redoRecords: HistoryRecord[] = [];
	protected redoSize = 0;
	protected readonly refresh = new ReplaySubject<{ dataLength: number; resetFrom?: number }>(1);
	protected selectionSync?: (scroll: boolean) => void;
	protected readonly text = textCanvas(this.host);
	protected readonly hitTest = new HitTest(this.text);
	protected readonly geometryFeature = sourceGeometry(this.buffer, this.text, this.host, this.folding);
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
					line: fragment.endLine ?? fragment.line,
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
					? this.buffer.indexAt(this.text.getPosition(last, last.text.length))
					: 0,
			};
		},
	);
	protected readonly searchDecorations =
		this.decorationRenderer.create<undefined>({
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
	protected searchRanges: { start: number; end: number }[] = [];
	protected searchHighlightTimer?: number;
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
#gutters [part~="fold-toggle"],
#gutters [part~="fold-toggle"] > button { padding: 0; }
#gutters [part~="fold-toggle"] > button {
	background: transparent;
	border: 0;
	color: inherit;
}
#measure {
	visibility:hidden;
	position: absolute;
	top: 0; left: var(--source-gutter-width, 0px);
	width: calc(100% - var(--source-gutter-width, 0px));
	white-space: pre-wrap;
	word-break: break-word;
}
[part="fold-placeholder"] { opacity: 0; }
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
					let pointerBlock = false;

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
						const selections = $.selectionState;
						const firstLine = text.firstVisibleLine;
						const last = text.toRender.at(-1);
						const lastLine = last ? text.getPosition(last, last.text.length).line : firstLine;
						const visible = selections.flatMap(selection => {
							const { start, end } = selectionRange(selection);
							const startPosition = buffer.positionAt(start);
							const endPosition = buffer.positionAt(end);
							return endPosition.line < firstLine || startPosition.line > lastLine
								? []
								: [{ selection, startPosition, endPosition }];
						});
						cursor.setSelection(
							visible.flatMap(({ startPosition, endPosition }) => {
								return text.getSelectionRects(
									startPosition,
									endPosition,
								);
							}),
							$.offsetY,
						);
						if (!$.matches(':focus-within')) {
							cursor.hideCaret();
							return;
						}
						const carets = visible.flatMap(({ selection }) => {
							const caret = text.getCaret(buffer.positionAt(selection.head));
							return caret ? [caret] : [];
						});
						cursor.setPositions(carets, $.offsetY);
						const activeCaret = text.getCaret(
							buffer.positionAt($.selectionHead),
						);
						if (activeCaret) input.setBounds(cursor.bounds);
					}

					let revealDistantHead = false;
					function scrollToHead() {
						const position = buffer.positionAt($.selectionHead);
						const caret = text.getCaret(position);
						if (caret) {
							const top = caret.y + $.offsetY;
							if (top < 0) $.scrollTop += top;
							else if (top + caret.height > $.clientHeight)
								$.scrollTop += top + caret.height - $.clientHeight;
						} else {
							$.scrollToRow($.folding.rowAt(position.line));
						}
						return !caret;
					}

					function setSelection(next: number, extend = false) {
						$.blockAnchor = undefined;
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
						const ranges = $.selection
							.ranges()
							.filter(({ start, end }) => start !== end);
						if (!ranges.length || !event.clipboardData) return false;
						event.preventDefault();
						event.clipboardData.setData(
							'text/plain',
							ranges
								.map(({ start, end }) => buffer.getText(start, end))
								.join('\n'),
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
							(key !== 'v' && !$.selection.somethingSelected())
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

					function moveSelection(
						feature: SourceCursorNavigationFeature,
						movement: CursorMovement,
						extend: boolean,
						block: boolean,
						anchor: number,
						blockAnchor: number,
					) {
						feature[movement]();
						if (block)
							$.setBlockSelectionState(blockAnchor, $.selectionHead, true);
						else if (extend)
							$.setSelectionState(
								anchor,
								$.selectionHead,
								true,
								feature === $.cursorY,
							);
					}

					function selectAllKey(event: KeyboardEvent) {
						if ((!event.ctrlKey && !event.metaKey) || event.key !== 'a')
							return false;
						event.preventDefault();
						$.blockAnchor = undefined;
						$.setSelectionState(0, buffer.length, false);
						return true;
					}

					function moveKey(event: KeyboardEvent) {
						const extend = event.shiftKey;
						const block = event.altKey && extend;
						const { selectionAnchor: anchor, selectionHead: head } = $;
						const blockAnchor = $.blockAnchor ?? anchor;
						let next: number | undefined;
						let feature: SourceCursorNavigationFeature | undefined;
						let movement: CursorMovement | undefined;
						clipboardKey(event);
						if (insertKey(event)) return;
						if (selectAllKey(event)) return;
						if (event.key === 'ArrowLeft') {
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
						if (feature && movement)
							moveSelection(
								feature,
								movement,
								extend,
								block,
								anchor,
								blockAnchor,
							);
						else if (next !== undefined) setSelection(next, extend);
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
						$.blockAnchor = undefined;
						pointerAnchor = undefined;
						pointerBlock = false;
					}

					function resetEditor() {
						$.folding.reset();
						$.clearHistory();
						$.highlightSearch($.searchHighlight?.query, $.searchHighlight);
						$.blockAnchor = undefined;
						$.selectionExtending = false;
						inputEnd = inputStart = 0;
						$.setSelectionsState($.selectionSnapshot(), false);
					}

					$.selectionSync = scroll => {
						syncInput();
						revealDistantHead = scroll ? scrollToHead() : false;
						renderSelection();
					};
					$.rendered = () => {
						if (revealDistantHead) revealDistantHead = scrollToHead();
						renderSelection();
					};
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
							$.applySelectionEdit(
								update.text,
								{ start: update.start, end: update.end },
								{
									anchor: update.selectionStart,
									head: update.selectionEnd,
								},
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
							pointerBlock = event.altKey;
							$.setPointerCapture(event.pointerId);
							if (pointerBlock)
								$.setBlockSelectionState(pointerAnchor, position, false);
							else {
								$.blockAnchor = undefined;
								$.setSelectionState(pointerAnchor, position, false);
							}
						}),
						on($, 'pointermove').tap(event => {
							if (pointerAnchor === undefined) return;
							if (!(event.buttons & 1)) {
								stopPointerSelection(event);
								return;
							}
							const position = pointerPosition(event);
							if (position === undefined) return;
							if (pointerBlock)
								$.setBlockSelectionState(pointerAnchor, position, true);
							else $.setSelectionState(pointerAnchor, position, true);
						}),
						on($, 'pointerup').tap(stopPointerSelection),
						on($, 'pointercancel').tap(stopPointerSelection),
						on($, 'lostpointercapture').tap(() => stopPointerSelection()),
						onThemeChange.tap(() => {
							cursor.updateStyles();
						}),
						get($, 'gutters')
							.tap(gutters => {
								$.gutterHost.replaceChildren(
									...gutters.map(gutter => gutter.element),
								);
								$.refresh.next({ dataLength: $.folding.visibleCount });
							})
							.switchMap(gutters => {
								const changes = gutters.flatMap(gutter =>
									gutter.changes ? [gutter.changes] : [],
								);
								return changes.length ? merge(...changes) : EMPTY;
							})
							.tap(() =>
								$.refresh.next({ dataLength: $.folding.visibleCount }),
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

	get geometry(): SourceGeometryFeature {
		return this.geometryFeature;
	}

	get decorations(): SourceDecorationsFeature {
		return this.decorationRenderer;
	}

	get fold(): SourceFoldFeature {
		return this.folding;
	}

	protected get selectionAnchor() {
		return this.activeSelection.anchor;
	}

	protected get selectionHead() {
		return this.activeSelection.head;
	}

	protected get activeSelection() {
		return this.selectionState.at(-1) ?? DefaultSelection;
	}

	protected goColumn(ch: number) {
		const { line } = this.buffer.positionAt(this.selectionHead);
		const row = this.folding.lineAt(this.folding.rowAt(line));
		this.selection.set(this.folding.indexAt(row, ch));
	}

	protected moveHorizontal(direction: -1 | 1, count = 1) {
		let index = this.selectionHead;
		for (let i = 0; i < count; i++) {
			let next = index + direction;
			if (direction === 1 && this.buffer.charAt(index) === '\r' && this.buffer.charAt(index + 1) === '\n') next++;
			else if (direction === -1 && this.buffer.charAt(index - 2) === '\r' && this.buffer.charAt(index - 1) === '\n') next--;
			const hidden = this.folding.hiddenAt(this.clampSelection(next));
			if (hidden) next = direction === 1 ? hidden.to : hidden.from;
			index = this.clampSelection(next);
		}
		this.selection.set(index);
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
			next = this.folding.indexAt(this.folding.lineAt(this.folding.rowAt(position.line) + direction), this.folding.columnAt(this.selectionHead));
		this.setSelectionState(next, next, true, true);
	}

	protected movePage(direction: -1 | 1) {
		const position = this.buffer.positionAt(this.selectionHead);
		const lineHeight = this.text.measureElement.offsetHeight || 16;
		const lines = Math.max(1, Math.floor(this.clientHeight / lineHeight));
		const next = this.folding.indexAt(this.folding.lineAt(this.folding.rowAt(position.line) + direction * lines), this.folding.columnAt(this.selectionHead));
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

	protected goToken(index: number, direction?: -1 | 1) {
		const tokens = this.highlight.getNavigationTokens();
		if (!tokens.length) return;
		index = this.normalizeOrdinal(index, tokens.length);
		if (direction) {
			while (index >= 0 && index < tokens.length) {
				const token = tokens[index];
				if (token && !this.folding.hiddenAt(token.start)) break;
				index += direction;
			}
			if (index < 0 || index >= tokens.length) {
				const boundary = index < 0 ? 0 : this.buffer.length;
				if (!this.folding.hiddenAt(boundary)) this.selection.set(boundary);
				return;
			}
		}
		this.selection.set(tokens[index]?.start ?? this.buffer.length);
	}

	protected normalizeOrdinal(index: number, maximum: number) {
		if (index === Infinity) return maximum;
		if (!Number.isFinite(index)) return 0;
		return Math.max(0, Math.min(Math.trunc(index), maximum));
	}

	protected applyEdit(value: string, range: SourceRange) {
		const before = this.selectionSnapshot();
		const start = Math.min(range.start, range.end);
		const change = this.replace(start, Math.max(range.start, range.end), value);
		const next = change.start + value.length;
		const selections = before.map(selection =>
			this.mapSelection(selection, change),
		);
		selections[selections.length - 1] = { anchor: next, head: next };
		this.setSelectionsState(selections, false);
		this.recordHistory(
			{ changes: [change], before, after: this.selectionSnapshot() },
			false,
		);
		this.changeSubject.next(change);
		return change;
	}

	protected applySelectionEdit(
		value: string,
		activeRange?: SourceRange,
		activeAfter?: SourceSelection,
		coalesce = false,
	) {
		const before = this.selectionSnapshot();
		const activeIndex = before.length - 1;
		const active = before[activeIndex] ?? DefaultSelection;
		const activeHead = active.head;
		const entries = before.map((selection, index) => {
			let range = selectionRange(selection);
			if (activeRange && index === activeIndex) range = activeRange;
			else if (
				activeRange &&
				selection.anchor === selection.head &&
				active.anchor === active.head
			) {
				range = {
					start: selection.head + activeRange.start - activeHead,
					end: selection.head + activeRange.end - activeHead,
				};
			}
			return { index, range: this.cursor.range(range.start, range.end) };
		});
		entries.sort((left, right) =>
			left.range.start - right.range.start || left.range.end - right.range.end,
		);
		const groups: { indexes: number[]; range: SourceRange }[] = [];
		for (const entry of entries) {
			const previous = groups.at(-1);
			const overlaps =
				previous &&
				(entry.range.start < previous.range.end ||
					(entry.range.start === entry.range.end &&
						entry.range.start >= previous.range.start &&
						entry.range.start <= previous.range.end) ||
					(previous.range.start === previous.range.end &&
						previous.range.start >= entry.range.start &&
						previous.range.start <= entry.range.end));
			if (overlaps) {
				previous.range = {
					start: Math.min(previous.range.start, entry.range.start),
					end: Math.max(previous.range.end, entry.range.end),
				};
				previous.indexes.push(entry.index);
			} else groups.push({ indexes: [entry.index], range: entry.range });
		}

		const selections = before.map(selection => ({ ...selection }));
		const changes: SourceChange[] = [];
		let activeChange: SourceChange | undefined;
		groups.reverse();
		for (const group of groups) {
			const change = this.replace(group.range.start, group.range.end, value);
			changes.push(change);
			for (const [index, selection] of selections.entries())
				selections[index] = this.mapSelection(selection, change);
			const next = change.start + value.length;
			for (const index of group.indexes) {
				selections[index] =
					index === activeIndex && activeAfter
						? { ...activeAfter }
						: { anchor: next, head: next };
				if (index === activeIndex) activeChange = change;
			}
			this.changeSubject.next(change);
		}
		this.blockAnchor = undefined;
		this.setSelectionsState(selections, false);
		this.recordHistory(
			{ changes, before, after: this.selectionSnapshot() },
			coalesce,
		);
		const result = activeChange ?? changes[0];
		if (!result) throw new Error('Selection edit failed');
		return result;
	}

	protected replayHistory(record: HistoryRecord, undo: boolean) {
		const changes = undo ? [...record.changes].reverse() : record.changes;
		for (const change of changes) {
			const value = undo ? change.removed : change.text;
			const length = undo ? change.text.length : change.removed.length;
			this.changeSubject.next(
				this.replace(change.start, change.start + length, value),
			);
		}
		this.blockAnchor = undefined;
		this.setSelectionsState(undo ? record.before : record.after, false);
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
		clearTimeout(this.searchHighlightTimer);
		this.searchHighlightTimer = undefined;
		if (query === undefined || query === '') {
			this.searchRanges = [];
			this.searchHighlight = undefined;
			this.searchDecorations.clear();
			return;
		}
		this.updateSearchDecorationStyle();
		this.searchHighlight = {
			query,
			caseSensitive: options.caseSensitive,
		};
		this.searchRanges = [...searchMatches(this.getText(), query, options.caseSensitive)];
		this.searchDecorations.replaceAll(
			this.searchRanges.map(range => ({ range, value: undefined })),
		);
	}

	protected updateSearchHighlights(change: BufferChange) {
		const search = this.searchHighlight;
		if (!search) return;
		if (typeof search.query !== 'string') {
			if (this.searchHighlightTimer === undefined)
				this.searchHighlightTimer = window.setTimeout(() => {
					this.highlightSearch(search.query, search);
				}, 0);
			return;
		}
		const ranges = this.searchRanges;
		const size = search.query.length;
		const delta = change.text.length - (change.end - change.start);
		const editEnd = change.start + change.text.length;
		let left = 0;
		let high = ranges.length;
		while (left < high) {
			const middle = (left + high) >> 1;
			if ((ranges[middle]?.end ?? 0) <= change.start) left = middle + 1;
			else high = middle;
		}
		let right = left;
		while (right < ranges.length && (ranges[right]?.start ?? Infinity) < change.end)
			right++;
		for (let index = right; delta && index < ranges.length; index++) {
			const range = ranges[index];
			if (range) {
				range.start += delta;
				range.end += delta;
			}
		}
		const start = Math.max(ranges[left - 1]?.end ?? 0, change.start - size + 1);
		const result = this.scanSearchHighlights(start, right, editEnd, search.query, search.caseSensitive);
		this.searchRanges = ranges.slice(0, left).concat(result.updated, ranges.slice(result.right));
		this.searchDecorations.replaceRange(
			{ start, end: result.end },
			result.updated.map(range => ({ range, value: undefined })),
		);
	}

	protected scanSearchHighlights(
		start: number,
		right: number,
		editEnd: number,
		query: string,
		caseSensitive?: boolean,
	) {
		const ranges = this.searchRanges;
		const size = query.length;
		const updated: { start: number; end: number }[] = [];
		let cursor = start;
		let removedEnd = editEnd;
		while (cursor < this.buffer.length) {
			const chunkEnd = Math.min(this.buffer.length, cursor + 4096 + size - 1);
			const value = this.buffer.getText(cursor, chunkEnd);
			let next = cursor;
			for (const match of searchMatches(value, query, caseSensitive)) {
				const range = { start: cursor + match.start, end: cursor + match.end };
				while (right < ranges.length && (ranges[right]?.start ?? Infinity) < range.start) {
					removedEnd = Math.max(removedEnd, ranges[right]?.end ?? 0);
					right++;
				}
				if (range.start >= editEnd && ranges[right]?.start === range.start)
					return { updated, right, end: range.start };
				updated.push(range);
				next = range.end;
			}
			cursor = Math.max(next, chunkEnd - size + 1);
			if (chunkEnd === this.buffer.length) cursor = chunkEnd;
			while (right < ranges.length && (ranges[right]?.start ?? Infinity) < cursor) {
				removedEnd = Math.max(removedEnd, ranges[right]?.end ?? 0);
				right++;
			}
			if (cursor >= editEnd + size && cursor >= removedEnd)
				return { updated, right, end: cursor };
		}
		return { updated, right, end: this.buffer.length + 1 };
	}

	protected historyRecordSize(record: HistoryRecord) {
		return record.changes.reduce(
			(size, change) => size + change.text.length + change.removed.length,
			0,
		);
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
		const before = record.before.at(-1);
		const after = record.after.at(-1);
		const change = record.changes[0];
		const previousChange = previous?.changes[0];
		if (
			coalesce &&
			previous &&
			change &&
			previousChange &&
			record.changes.length === 1 &&
			previous.changes.length === 1 &&
			this.selectionsEqual(previous.after, record.before) &&
			record.before.length === 1 &&
			before?.anchor === before?.head &&
			after?.anchor === after?.head &&
			!change.removed &&
			change.start === previousChange.start + previousChange.text.length
		) {
			this.undoSize -= this.historyRecordSize(previous);
			previous.changes[0] = {
				...previousChange,
				text: previousChange.text + change.text,
				lineEnd: Math.max(previousChange.lineEnd, change.lineEnd),
				lineDelta: previousChange.lineDelta + change.lineDelta,
			};
			previous.after = record.after;
			this.undoSize += this.historyRecordSize(previous);
		} else {
			this.undoRecords.push(record);
			this.undoSize += this.historyRecordSize(record);
		}
		this.undoSize = this.trimHistory(this.undoRecords, this.undoSize);
	}

	protected selectionSnapshot(): SourceSelection[] {
		return this.selectionState.map(selection => ({ ...selection }));
	}

	protected setSelectionState(
		anchor: number,
		head: number,
		scroll: boolean,
		preservePreferredX = false,
	) {
		this.setSelectionsState([{ anchor, head }], scroll, preservePreferredX);
	}

	protected setBlockSelectionState(
		anchor: number,
		head: number,
		scroll: boolean,
	) {
		anchor = this.clampSelection(anchor);
		head = this.clampSelection(head);
		const anchorPosition = this.buffer.positionAt(anchor);
		const headPosition = this.buffer.positionAt(head);
		this.folding.reveal(anchor);
		this.folding.reveal(head);
		const folded = this.folding.hasHiddenLines;
		const from = folded ? this.folding.rowAt(anchorPosition.line) : anchorPosition.line;
		const to = folded ? this.folding.rowAt(headPosition.line) : headPosition.line;
		const direction = from <= to ? 1 : -1;
		const selections: SourceSelection[] = [];
		const anchorColumn = folded ? this.folding.columnAt(anchor) : anchorPosition.ch;
		const headColumn = folded ? this.folding.columnAt(head) : headPosition.ch;
		for (let row = from; ; row += direction) {
			const line = folded ? this.folding.lineAt(row) : row;
			selections.push({
				anchor: this.folding.indexAt(line, anchorColumn),
				head: this.folding.indexAt(line, headColumn),
			});
			if (row === to) break;
		}
		this.blockAnchor = anchor;
		this.setSelectionsState(selections, scroll);
	}

	protected setActiveSelectionState(
		anchor: number,
		head: number,
		scroll: boolean,
		preservePreferredX = false,
	) {
		const selections = this.selectionSnapshot();
		selections[selections.length - 1] = { anchor, head };
		this.setSelectionsState(selections, scroll, preservePreferredX);
	}

	protected setSelectionsState(
		selections: SelectionSnapshot,
		scroll: boolean,
		preservePreferredX = false,
	) {
		this.activeSearch = undefined;
		if (!preservePreferredX) this.preferredX = undefined;
		const next = (selections.length ? selections : [DefaultSelection]).map(
			({ anchor, head }) => ({
				anchor: this.clampSelection(anchor),
				head: this.clampSelection(head),
			}),
		);
		if (this.folding.hasHiddenLines) for (const selection of next) {
			this.folding.reveal(selection.anchor);
			this.folding.reveal(selection.head);
		}
		const changed = !this.selectionsEqual(this.selectionState, next);
		this.selectionState = next;
		this.selectionSync?.(scroll);
		if (changed) this.selectionSubject.next();
	}

	protected mapSelection(
		selection: SourceSelection,
		change: SourceChange,
	): SourceSelection {
		const delta = change.text.length - (change.end - change.start);
		const map = (index: number) => {
			if (index <= change.start) return index;
			if (index >= change.end) return index + delta;
			return change.start + change.text.length;
		};
		return { anchor: map(selection.anchor), head: map(selection.head) };
	}

	protected selectionsEqual(
		left: SelectionSnapshot,
		right: SelectionSnapshot,
	) {
		return (
			left.length === right.length &&
			left.every((selection, index) => {
				const other = right[index];
				return (
					other?.anchor === selection.anchor &&
					other.head === selection.head
				);
			})
		);
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
		this.rowHeights.clear();
		const renderedHeights = new Map<number, number>();
		host.append(
			this.gutterHost,
			decorationRenderer.behindCanvas,
			text.canvas,
			decorationRenderer.aboveCanvas,
			text.foldHost,
			text.measureElement,
		);
		this.shadowRoot?.append(host);
		this.updateSearchDecorationStyle();
		refresh.next({ dataLength: this.folding.visibleCount });

		return merge(
			onMutation(this, { attributes: true, attributeFilter: ['style', 'class'] })
				.raf(() => this.resetRenderer()),
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
				estimateSize: EstimatedRowHeight,
				refresh: refresh.tap(({ dataLength, resetFrom = dataLength }) => {
					for (const row of this.rowHeights.keys())
						if (row >= resetFrom || row >= dataLength) this.rowHeights.delete(row);
				}),
				render: (index, order) => {
					const line = this.folding.lineAt(index);
					if (order === 0) text.begin(line);
					const spans = this.folding.spans(line);
					const rect = spans ? this.renderFoldedLine(line, spans) : text.renderLine(line, this.buffer.getLine(line), this.highlight.getLine(line));
					renderedHeights.set(index, rect.offsetHeight);
					return rect;
				},
				dataLength: this.folding.visibleCount,
				translate: false,
			}).tap(event => {
				const last = text.toRender.at(-1);
				const lastRow = last ? this.folding.rowAt(last.row) : -1;
				const measuredEnd = lastRow >= event.end || event.end === event.dataLength ? event.end : event.end - 1;
				for (const [row, height] of renderedHeights)
					if (event.atEnd || (row >= event.start - 1 && row < measuredEnd))
						this.rowHeights.set(row, height);
				renderedHeights.clear();
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
				if (event.end < this.folding.visibleCount && last &&
					event.offset + last.offsetTop + last.height < host.clientHeight)
					refresh.next({ dataLength: this.folding.visibleCount });
			}),
			onFontsReady().tap(() => this.resetRenderer()),
			onThemeChange.tap(() => {
				text.updateStyles();
				this.updateSearchDecorationStyle();
				this.resetRenderer();
			}),
		);
	}

	protected override resetRenderer() {
		this.text.resize();
		this.refresh.next({ dataLength: this.folding.visibleCount, resetFrom: 0 });
	}

	protected scrollToRow(row: number) {
		let top = row * EstimatedRowHeight;
		let total = this.folding.visibleCount * EstimatedRowHeight;
		for (const [index, height] of this.rowHeights) {
			const delta = height - EstimatedRowHeight;
			total += delta;
			if (index < row) top += delta;
		}
		const viewport = this.host.clientHeight;
		const maximum = total - viewport;
		this.scrollTop = maximum > 0 ? Math.ceil(Math.max(top - viewport / 2, 0) / maximum * (this.scrollHeight - this.clientHeight)) : 0;
	}

	protected override replaced(change: BufferChange) {
		this.folding.replaced(change);
		for (const gutter of this.gutters) gutter.replaced?.(change);
		this.text.invalidate(
			change.lineStart,
			change.lineEnd,
			change.lineDelta,
		);
		this.decorationRenderer.replaced(change);
		this.updateSearchHighlights(change);
		this.refresh.next({ dataLength: this.folding.visibleCount });
	}

	protected override highlighted(done: boolean, tokens: readonly SourceToken[], failed = false) {
		if (done) this.folding.update(failed ? [] : tokens);
		this.refresh.next({ dataLength: this.folding.visibleCount });
	}

	protected override colorsChanged() {
		this.text.setTokenColors(this.tokenColors);
		this.refresh.next({ dataLength: this.folding.visibleCount });
	}

	protected override rendered() {}

	protected override reset() {
		this.folding.reset();
		this.clearHistory();
		this.selectionExtending = false;
		for (const gutter of this.gutters) gutter.reset?.();
		this.decorationRenderer.reset();
		if (this.searchHighlight)
			this.highlightSearch(this.searchHighlight.query, this.searchHighlight);
		this.setSelectionsState(this.selectionSnapshot(), false);
	}

	private renderFoldedLine(line: number, spans: readonly SourceFoldSpan[]) {
		let value = '';
		const tokens: SourceTokenSpan[] = [];
		const projected: SourceTextSpan[] = [];
		for (const span of spans) {
			const position = this.buffer.positionAt(span.start);
			const start = value.length;
			value += span.folded ? '…' : this.buffer.getText(span.start, span.end);
			projected.push({ start, end: value.length, position, endPosition: span.folded ? this.buffer.positionAt(span.end) : undefined });
			if (span.folded) continue;
			for (const token of this.highlight.getLine(position.line)) {
				const from = Math.max(token.start, position.ch);
				const to = Math.min(token.end, position.ch + value.length - start);
				if (from < to) tokens.push({ start: start + from - position.ch, end: start + to - position.ch, kind: token.kind });
			}
		}
		return this.text.renderLine(line, value, tokens, projected);
	}

	private foldBoundary(index: number) {
		return this.folding.hiddenAt(index)?.from ?? index;
	}

	private clampSelection(index: number) {
		if (index === Infinity) return this.buffer.length;
		if (!Number.isFinite(index)) return 0;
		return Math.max(0, Math.min(Math.trunc(index), this.buffer.length));
	}
}
