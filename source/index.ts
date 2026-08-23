import {
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

export { Code } from './code.js';

export {
	type SourceToken,
	type SourceTokenColors,
	type SourceTokenSpan,
	type SourceTokenizer,
} from './highlight.js';

export type SourceChange = BufferChange;
export type SourcePosition = BufferPosition;

export interface SourceRange {
	readonly start: number;
	readonly end: number;
}

export interface SourceSelectionFeature {
	range(): SourceRange;
	set(anchor: number, head?: number): void;
}

export interface SourceEditFeature {
	replace(value: string, range?: SourceRange): SourceChange;
}

export interface SourceCursorFeature {
	readonly index: number;
	go(index: number): void;
	indexAt(position: SourcePosition): number;
	position(index?: number): SourcePosition;
	range(from?: number, to?: number): SourceRange;
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
	lastSearch?: string | RegExp;
	lastOptions?: SourceSearchOptions;
	lastReplace?: string;
	find(
		query?: string | RegExp,
		options?: SourceSearchOptions,
	): SourceRange | undefined;
	findAll(query?: string | RegExp, options?: SourceSearchOptions): SourceRange[];
	findNext(): SourceRange | undefined;
	findPrevious(): SourceRange | undefined;
	replaceNext(
		query?: string | RegExp,
		value?: string,
		options?: SourceSearchOptions,
	): void;
	replaceAll(
		query?: string | RegExp,
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
	query: string | RegExp;
	caseSensitive?: boolean;
	range: SourceRange;
}

const MaxHistoryEntries = 1_000;
const MaxHistoryText = 16 * 1024 * 1024;

function* searchMatches(
	value: string,
	query: string | RegExp,
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
		replaceNext: (
			query = this.search.lastSearch,
			value = this.search.lastReplace,
			options = this.search.lastOptions,
		) => {
			if (value === undefined) return;
			this.search.lastReplace = value;
			const range = this.findSearch(query, options);
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
	protected readonly host = create('div', { id: 'body' });
	protected offsetY = 0;
	protected readonly redoRecords: HistoryRecord[] = [];
	protected redoSize = 0;
	protected readonly refresh = new ReplaySubject<{ dataLength: number }>(1);
	protected selectionAnchor = 0;
	protected selectionHead = 0;
	protected selectionSync?: (scroll: boolean) => void;
	protected readonly text = textCanvas(this.host);
	protected readonly undoRecords: HistoryRecord[] = [];
	protected undoSize = 0;

	static {
		component(Source, {
			tagName: 'c-source',
			init: [property('fatCursor')],
			augment: [
				css(`
:host {
	cursor: text;
	outline: none;
	position: relative;
	user-select: none;
	-webkit-user-select: none;
}
:host(:focus-visible),
:host(:focus-within) {
	outline: 2px solid Highlight;
	outline-offset: 2px;
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
					const hitTest = new HitTest(text);
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

					function moveVertical(lines: number) {
						const position = buffer.positionAt($.selectionHead);
						return buffer.indexAt({
							line: position.line + lines,
							ch: position.ch,
						});
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
						clipboardKey(event);
						if (insertKey(event)) return;
						if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
							event.preventDefault();
							$.setSelectionState(0, buffer.length, false);
							return;
						} else if (event.key === 'ArrowLeft') {
							next =
								!extend && anchor !== head
									? Math.min(anchor, head)
									: head - 1;
						} else if (event.key === 'ArrowRight') {
							next =
								!extend && anchor !== head
									? Math.max(anchor, head)
									: head + 1;
						} else if (event.key === 'ArrowUp') next = moveVertical(-1);
						else if (event.key === 'ArrowDown') next = moveVertical(1);
						else if (event.key === 'Home') {
							const position = buffer.positionAt(head);
							next = buffer.indexAt({ line: position.line, ch: 0 });
						} else if (event.key === 'End') {
							const position = buffer.positionAt(head);
							next = buffer.indexAt({ line: position.line, ch: Infinity });
						} else if (event.key === 'PageUp' || event.key === 'PageDown') {
							const lineHeight = text.measureElement.offsetHeight || 16;
							const lines = Math.max(1, Math.floor($.clientHeight / lineHeight));
							next = moveVertical(event.key === 'PageUp' ? -lines : lines);
						} else return;

						event.preventDefault();
						setSelection(next, extend);
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
					);
				},
			],
		});
	}

	constructor() {
		super();
		this.changes = this.changeSubject;
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
		query: string | RegExp | undefined,
		options: SourceSearchOptions = {},
	) {
		if (query === undefined) return [];
		this.search.lastSearch = query;
		this.search.lastOptions = { ...options };
		return [...searchMatches(this.getText(), query, options.caseSensitive)];
	}

	protected findSearch(
		query: string | RegExp | undefined,
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

	protected historyRecordSize(record: HistoryRecord) {
		return record.change.text.length + record.change.removed.length;
	}

	protected recordHistory(record: HistoryRecord, coalesce: boolean) {
		this.redoRecords.length = 0;
		this.redoSize = 0;
		const previous = this.undoRecords.at(-1);
		if (
			coalesce &&
			previous &&
			previous.after.anchor === record.before.anchor &&
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

	protected setSelectionState(anchor: number, head: number, scroll: boolean) {
		this.activeSearch = undefined;
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
		const { host, refresh, text } = this;
		host.append(text.canvas, text.measureElement);
		this.shadowRoot?.append(host);
		refresh.next({ dataLength: this.buffer.getLineCount() });

		return merge(
			onFontsReady().switchMap(() =>
				merge(
					onResize(host).raf(() => {
						if (host.clientHeight > 0 && host.clientWidth > 0)
							text.resize();
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
						this.rendered();
					}),
				),
			),
			onThemeChange.tap(() => {
				text.updateStyles();
				refresh.next({ dataLength: this.buffer.getLineCount() });
			}),
		);
	}

	protected override resetRenderer() {
		this.text.resize();
		this.refresh.next({ dataLength: this.buffer.getLineCount() });
	}

	protected override replaced(change: BufferChange) {
		this.text.invalidate(
			change.lineStart,
			change.lineEnd,
			change.lineDelta,
		);
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
