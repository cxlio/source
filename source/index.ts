import {
	on,
	onResize,
	onVisibility,
	EMPTY,
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
	ReplaySubject,
} from '@cxl/ui';
import { textCanvas } from './text.js';
import { sourceCursor } from './cursor.js';
import { HitTest } from './hit-test.js';
import { Buffer } from './buffer.js';
import { createTextInput, type TextInputUpdate } from './input.js';

/**
 * Displays a large text buffer with incremental editing and viewport rendering.
 * Native text input, selection, and composition are synchronized with the
 * document buffer while only visible lines are measured and painted.
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
			const host = create('div', { id: 'body' });
			const text = textCanvas(host);
			const cursor = sourceCursor(host);
			const hitTest = new HitTest(text);
			const refresh = new ReplaySubject<{ dataLength: number }>(1);
			const buffer = new Buffer();
			const input = createTextInput($, host);
			const paste = on(input.element, 'paste');
			const contextRadius = 2048;

			let anchor = 0;
			let head = 0;
			let inputEnd = 0;
			let inputStart = 0;
			let offsetY = 0;
			let pointerAnchor: number | undefined;

			host.append(text.canvas, cursor.canvas, text.measureElement);
			$.shadowRoot?.append(host);
			$.tabIndex = input.kind === 'edit-context' ? 0 : -1;
			$.setAttribute('role', 'textbox');
			$.setAttribute('aria-multiline', 'true');
			$.autocapitalize = 'off';
			$.setAttribute('autocorrect', 'off');
			$.spellcheck = false;
			if (!$.hasAttribute('aria-label'))
				$.setAttribute('aria-label', 'Source editor');

			function clamp(index: number) {
				return Math.max(0, Math.min(index, buffer.length));
			}

			function syncInput() {
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
				const start = buffer.positionAt(Math.min(anchor, head));
				const end = buffer.positionAt(Math.max(anchor, head));
				cursor.setSelection(text.getSelectionRects(start, end), offsetY);
				const caret = text.getCaret(buffer.positionAt(head));
				if (caret) {
					cursor.setPosition(caret, offsetY);
					input.setBounds(cursor.bounds);
				} else cursor.hideCaret();
			}

			function scrollToHead() {
				const position = buffer.positionAt(head);
				const caret = text.getCaret(position);
				if (caret) {
					const top = caret.y + offsetY;
					if (top < 0) $.scrollTop += top;
					else if (top + caret.height > $.clientHeight)
						$.scrollTop += top + caret.height - $.clientHeight;
				} else {
					const lineHeight = text.measureElement.offsetHeight || 16;
					$.scrollTop = position.line * lineHeight;
				}
			}

			function setSelection(next: number, extend = false) {
				head = clamp(next);
				if (!extend) anchor = head;
				syncInput();
				scrollToHead();
				renderSelection();
			}

			function applyEdit(
				start: number,
				end: number,
				value: string,
				selectionStart = start + value.length,
				selectionEnd = selectionStart,
			) {
				const change = buffer.replace(start, end, value);
				anchor = clamp(selectionStart);
				head = clamp(selectionEnd);
				text.invalidate(change.lineStart, change.lineEnd, change.lineDelta);
				refresh.next({ dataLength: buffer.getLineCount() });
				syncInput();
			}

			function replaceSelection(value: string) {
				const start = Math.min(anchor, head);
				applyEdit(start, Math.max(anchor, head), value);
			}

			function normalizeInput(update: TextInputUpdate) {
				return update.start === head - 1 && /^\. ?$/.test(update.text)
					? { ...update, text: update.text.replace('.', ' ') }
					: update;
			}

			function copySelection(event: ClipboardEvent) {
				if (anchor === head || !event.clipboardData) return false;
				event.preventDefault();
				event.clipboardData.setData(
					'text/plain',
					buffer.getText(Math.min(anchor, head), Math.max(anchor, head)),
				);
				return true;
			}

			function moveVertical(lines: number) {
				const position = buffer.positionAt(head);
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
					(key !== 'v' && anchor === head)
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
				let next: number | undefined;
				clipboardKey(event);
				if (insertKey(event)) return;
				if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
					anchor = 0;
					head = buffer.length;
					next = head;
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
				if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
					syncInput();
					renderSelection();
				} else setSelection(next, extend);
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
				if (event && host.hasPointerCapture(event.pointerId))
					host.releasePointerCapture(event.pointerId);
				pointerAnchor = undefined;
			}

			return merge(
				onFontsReady().switchMap(() =>
					onVisibility($).switchMap(visible =>
						visible
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
										scrollContainer: $.shadowRoot ?? undefined,
										refresh,
										render(index, order) {
											if (order === 0) text.begin(index);
											return text.renderLine(
												index,
												buffer.getLine(index),
											);
										},
										dataLength: buffer.getLineCount(),
										translate: false,
									}).tap(event => {
										offsetY = event.offset;
										text.commit(event.offset);
										renderSelection();
									}),
								)
							: EMPTY,
					),
				),
				get($, 'value').tap(source => {
					buffer.reset(source);
					anchor = head = Math.min(head, buffer.length);
					inputEnd = inputStart = 0;
					text.resize();
					syncInput();
					refresh.next({ dataLength: buffer.getLineCount() });
				}),
				input.updates.tap(update => {
					update = normalizeInput(update);
					applyEdit(
						update.start,
						update.end,
						update.text,
						update.selectionStart,
						update.selectionEnd,
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
				on(host, 'pointerdown').tap(event => {
					if (event.button !== 0) return;
					const position = pointerPosition(event);
					if (position === undefined) return;
					event.preventDefault();
					input.focus();
					pointerAnchor = event.shiftKey ? anchor : position;
					anchor = pointerAnchor;
					head = position;
					host.setPointerCapture(event.pointerId);
					syncInput();
					renderSelection();
				}),
				on(host, 'pointermove').tap(event => {
					if (pointerAnchor === undefined) return;
					if (!(event.buttons & 1)) {
						stopPointerSelection(event);
						return;
					}
					const position = pointerPosition(event);
					if (position === undefined) return;
					anchor = pointerAnchor;
					head = position;
					syncInput();
					renderSelection();
				}),
				on(host, 'pointerup').tap(stopPointerSelection),
				on(host, 'pointercancel').tap(stopPointerSelection),
				on(host, 'lostpointercapture').tap(() => {
					pointerAnchor = undefined;
				}),
				onThemeChange.tap(() => {
					text.updateStyles();
					cursor.updateStyles();
					refresh.next({ dataLength: buffer.getLineCount() });
				}),
			);
		},
	],
});
