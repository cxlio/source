import { spec, type TestApi } from '@cxl/spec';
import { Buffer } from './buffer.js';
import { Source } from './index.js';
import { createTextareaInput } from './input.js';
import { HitTest } from './hit-test.js';
import { textCanvas, SourceLine } from './text.js';

const LargeLineCount = 100_000;

function createLargeSource() {
	return Array.from(
		{ length: LargeLineCount },
		(_, line) => `${line}\t${'value'.repeat(8)}`,
	).join('\n');
}

function createTextCanvas(a: TestApi, width = 320) {
	const host = a.element('div');
	host.style.cssText =
		`position:relative;width:${width}px;height:160px;font:12px monospace;color:#000`;
	const text = textCanvas(host);
	text.canvas.style.cssText =
		'position:absolute;inset:0;width:100%;height:100%';
	text.measureElement.style.cssText =
		'visibility:hidden;position:absolute;inset:0;width:100%;white-space:pre-wrap;word-break:break-word';
	host.append(text.canvas, text.measureElement);
	return text;
}

async function createSourceEditor(a: TestApi, value: string) {
	const source = a.element(Source);
	source.style.cssText =
		'display:block;width:320px;height:160px;font:12px monospace';
	source.value = value;
	await a.sleep(75);
	return {
		source,
		target: source.shadowRoot?.querySelector('textarea') ?? source,
	};
}

async function editorAction(
	a: TestApi,
	element: Element,
	type: 'keyDown' | 'keyUp' | 'press' | 'type',
	value: string,
) {
	const result = await a.action({ type, value, element });
	a.ok(result.success, result.message ?? result.failureMessage);
}

async function editorShortcut(
	a: TestApi,
	element: Element,
	modifier: 'Control' | 'Shift',
	key: string,
) {
	await editorAction(a, element, 'keyDown', modifier);
	await editorAction(a, element, 'press', key);
	await editorAction(a, element, 'keyUp', modifier);
}

function clipboardSelection(element: Element, type: 'copy' | 'cut' = 'copy') {
	const clipboard = new DataTransfer();
	element.dispatchEvent(
		new ClipboardEvent(type, {
			bubbles: true,
			cancelable: true,
			clipboardData: clipboard,
		}),
	);
	return clipboard.getData('text/plain');
}

function paintedBounds(canvas: HTMLCanvasElement, width = canvas.width) {
	const context = canvas.getContext('2d');
	if (!context) return;
	const pixels = context.getImageData(0, 0, width, canvas.height).data;
	let top = canvas.height;
	let bottom = -1;
	for (let pixel = 0; pixel < pixels.length / 4; pixel++) {
		if (!pixels[pixel * 4 + 3]) continue;
		const y = Math.floor(pixel / width);
		top = Math.min(top, y);
		bottom = Math.max(bottom, y);
	}
	return { top, bottom };
}

async function editorValue(a: TestApi, element: Element) {
	await editorShortcut(a, element, 'Control', 'a');
	return clipboardSelection(element);
}

export default spec('@cxl/ui.source', a => {
	a.test('native input', it => {
		it.should('apply bounded textarea input changes', a => {
			const host = a.element('div');
			const container = document.createElement('div');
			host.attachShadow({ mode: 'open' }).append(container);
			const input = createTextareaInput(container);

			let update;
			const subscription = input.updates.subscribe(value => (update = value));
			input.sync('alpha', 2, 2, 10);
			const textarea = container.querySelector('textarea');
			if (!textarea) {
				a.ok(false, 'textarea input created');
				return;
			}
			textarea.value = 'alXpha';
			textarea.setSelectionRange(3, 3);
			textarea.dispatchEvent(
				new InputEvent('input', {
					bubbles: true,
					data: 'X',
					inputType: 'insertText',
				}),
			);
			a.equalValues(update, {
				start: 12,
				end: 12,
				text: 'X',
				selectionStart: 13,
				selectionEnd: 13,
			});

			textarea.value = 'alX日pha';
			textarea.setSelectionRange(4, 4);
			textarea.dispatchEvent(
				new CompositionEvent('compositionstart', { data: '' }),
			);
			textarea.dispatchEvent(
				new InputEvent('input', {
					bubbles: true,
					data: '日',
					inputType: 'insertCompositionText',
					isComposing: true,
				}),
			);
			a.equalValues(update, {
				start: 13,
				end: 13,
				text: '日',
				selectionStart: 14,
				selectionEnd: 14,
			});
			subscription.unsubscribe();
		});

		it.testElement('edit through the active browser input path', async a => {
			const { source, target } = await createSourceEditor(a, 'one');
			await a.a11y(source);
			await editorAction(a, target, 'type', 'X');
			a.ok(
				document.activeElement === source ||
					source.shadowRoot?.activeElement === target,
				'native input focused',
			);
			a.equal(await editorValue(a, target), 'Xone');

			const pasted = new DataTransfer();
			pasted.setData('text/plain', 'two\nlines');
			target.dispatchEvent(
				new ClipboardEvent('paste', {
					bubbles: true,
					cancelable: true,
					clipboardData: pasted,
				}),
			);
			await editorAction(a, target, 'press', 'End');
			await editorAction(a, target, 'type', '!');
			a.equal(await editorValue(a, target), 'two\nlines!');
			a.equal(clipboardSelection(target, 'cut'), 'two\nlines!');
		});

		it.testElement('handle native editing and navigation keys', async a => {
			const { target } = await createSourceEditor(a, 'ab');
			await editorAction(a, target, 'press', 'End');
			await editorAction(a, target, 'press', 'Enter');
			await editorAction(a, target, 'type', 'cd');
			await editorAction(a, target, 'press', 'Tab');
			await editorAction(a, target, 'press', 'Backspace');
			await editorAction(a, target, 'press', 'ArrowLeft');
			await editorAction(a, target, 'press', 'Delete');
			a.equal(await editorValue(a, target), 'ab\nc');
		});

		it.testElement('insert spaces without scrolling or punctuation', async a => {
			const { source, target } = await createSourceEditor(a, 'a');
			await editorAction(a, target, 'press', 'End');
			await editorAction(a, target, 'press', 'Space');
			const editContext = source.editContext;
			if (!editContext) {
				a.ok(false, 'EditContext is active');
				return;
			}
			editContext.dispatchEvent(
				new TextUpdateEvent('textupdate', {
					selectionEnd: 3,
					selectionStart: 3,
					text: '. ',
					updateRangeEnd: 2,
					updateRangeStart: 1,
				}),
			);
			a.equal(await editorValue(a, target), 'a  ', 'Space inserts literally');
			a.equal(
				source.getAttribute('autocorrect'),
				'off',
				'native autocorrection disabled',
			);
		});

		it.testElement('keep text fixed through first focus and edit', async a => {
			const { source, target } = await createSourceEditor(a, 'MMMM');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas',
			);
			if (!canvas) {
				a.ok(false, 'editor canvas exists');
				return;
			}
			const context = canvas.getContext('2d');
			const unchangedWidth = Math.floor(
				context?.measureText('MMMM').width ?? 20,
			);
			const initial = paintedBounds(canvas, unchangedWidth);
			await editorAction(a, target, 'press', 'End');
			await a.sleep(50);
			const focused = paintedBounds(canvas, unchangedWidth);
			await editorAction(a, target, 'type', 'i');
			await a.sleep(50);
			const edited = paintedBounds(canvas, unchangedWidth);
			a.equalValues(focused, initial, 'focus keeps painted text fixed');
			a.equalValues(edited, initial, 'first edit keeps painted text fixed');
		});

		it.testElement('extend and collapse multiline keyboard selections', async a => {
			const { target } = await createSourceEditor(a, 'one\ntwo\nthree');
			await editorAction(a, target, 'press', 'ArrowDown');
			await editorShortcut(a, target, 'Shift', 'ArrowDown');
			a.equal(clipboardSelection(target), 'two\n');
			await editorAction(a, target, 'press', 'Home');
			await editorAction(a, target, 'type', '!');
			a.equal(await editorValue(a, target), 'one\ntwo\n!three');
		});

		it.testElement('scroll the caret into view during page navigation', async a => {
			const { source, target } = await createSourceEditor(
				a,
				Array.from({ length: 100 }, (_, line) => `line ${line}`).join('\n'),
			);
			await editorAction(a, target, 'press', 'PageDown');
			await editorAction(a, target, 'press', 'PageDown');
			await a.sleep(50);
			a.ok(source.scrollTop > 0, 'caret navigation scrolls the viewport');
		});

		it.testElement('select text with a real pointer drag', async a => {
			const { source, target } = await createSourceEditor(a, 'ABCDE');
			const body = source.shadowRoot?.querySelector<HTMLElement>('#body');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas',
			);
			if (!body || !canvas) {
				a.ok(false, 'editor rendering surface exists');
				return;
			}
			const rect = body.getBoundingClientRect();
			const width = canvas.getContext('2d')?.measureText('ABC').width ?? 22;
			const lineHeight =
				source.shadowRoot?.querySelector<HTMLElement>('#measure')
					?.offsetHeight ?? 14;
			const marker = (x: number) => {
				const element = a.element('div');
				element.style.cssText = `position:absolute;pointer-events:none;z-index:1000;left:${window.scrollX + x - 1}px;top:${window.scrollY + rect.top + lineHeight / 2 - 1}px;width:2px;height:2px`;
				return element;
			};
			const start = marker(rect.left + 2);
			const end = marker(rect.left + width);
			const forward = await a.drag(start, end);
			a.ok(forward.success, forward.message ?? forward.failureMessage);
			a.equal(clipboardSelection(target), 'ABC');

			const backward = await a.drag(end, start);
			a.ok(backward.success, backward.message ?? backward.failureMessage);
			a.equal(clipboardSelection(target), 'ABC');
		});
	});

	a.test('Buffer', it => {
		it.should('read empty multiline and CRLF documents', a => {
			const buffer = new Buffer();
			buffer.reset('');
			a.equal(buffer.length, 0);
			a.equal(buffer.getLineCount(), 1);
			a.equal(buffer.getLine(0), '');

			buffer.reset('one\r\ntwo\n');
			a.equal(buffer.length, 9);
			a.equal(buffer.getLineCount(), 3);
			a.equal(buffer.getLine(0), 'one');
			a.equal(buffer.getLine(1), 'two');
			a.equal(buffer.getLine(2), '');
			a.equal(buffer.getText(), 'one\r\ntwo\n');
		});

		it.should('convert positions and indexes', a => {
			const buffer = new Buffer();
			buffer.reset('one\r\n😀two\nthree');

			a.equalValues(buffer.positionAt(5), { line: 1, ch: 0 });
			a.equalValues(buffer.positionAt(7), { line: 1, ch: 2 });
			a.equal(buffer.indexAt({ line: 1, ch: 2 }), 7);
			a.equal(buffer.indexAt({ line: 0, ch: Infinity }), 3);
			a.equal(buffer.indexAt({ line: 20, ch: Infinity }), buffer.length);
		});

		it.should('insert delete and replace across pieces', a => {
			const buffer = new Buffer();
			buffer.reset('one\nthree');

			const inserted = buffer.insert(4, 'two\n');
			a.equalValues(inserted, {
				start: 4,
				end: 4,
				text: 'two\n',
				removed: '',
				lineStart: 1,
				lineEnd: 2,
				lineDelta: 1,
			});
			a.equal(buffer.getText(), 'one\ntwo\nthree');
			a.equal(buffer.getLine(1), 'two');

			const replaced = buffer.replace(4, 8, 'second\n');
			a.equal(replaced.removed, 'two\n');
			a.equal(buffer.getText(), 'one\nsecond\nthree');

			const deleted = buffer.delete(4, 11);
			a.equal(deleted.removed, 'second\n');
			a.equal(buffer.getText(), 'one\nthree');
		});

		it.should('preserve content through long edit sequences', a => {
			const buffer = new Buffer();
			let expected = 'alpha\nbeta\ngamma';
			buffer.reset(expected);

			for (let edit = 0; edit < 2_000; edit++) {
				const start = (edit * 17) % (expected.length + 1);
				const end = Math.min(expected.length, start + (edit % 3));
				const text = edit % 5 === 0 ? `\n${edit}` : String(edit % 10);
				buffer.replace(start, end, text);
				expected = expected.slice(0, start) + text + expected.slice(end);
			}

			a.equal(buffer.getText(), expected);
			a.equal(buffer.length, expected.length);
			a.equal(buffer.getLineCount(), expected.split('\n').length);
			for (let index = 0; index <= buffer.length; index += 97)
				a.equal(buffer.indexAt(buffer.positionAt(index)), index);
		});

		it.should('edit a large document without rebuilding its text', a => {
			const buffer = new Buffer();
			const source = createLargeSource();
			buffer.reset(source);
			const index = buffer.indexAt({ line: 50_000, ch: 4 });
			const start = performance.now();
			buffer.insert(index, 'updated');
			const duration = performance.now() - start;

			a.equal(buffer.getLineCount(), LargeLineCount);
			a.equal(buffer.getLine(50_000).slice(0, 18), '5000updated0\tvalue');
			a.log({ largeDocumentEditDuration: duration });
		});
	});

	a.test('textCanvas', it => {
		it.should('begin resets firstVisibleLine and offsetY', a => {
			const tc = createTextCanvas(a);
			tc.begin(5);
			a.equal(tc.firstVisibleLine, 5, 'firstVisibleLine set to argument');
			a.equal(tc.offsetY, 0, 'offsetY reset to 0');
		});

		it.should('renderLine populates cache and returns measurements', a => {
			const tc = createTextCanvas(a);

			const out = tc.renderLine(0, 'hello');
			a.equal(out.offsetLeft, 0, 'offsetLeft is zero');
			a.ok(out.offsetWidth > 0, 'width from measureElement');
			a.ok(out.offsetHeight > 0, 'height from measureElement');
			a.equal(out.offsetTop, 0, 'first line top is zero');

			const cached = tc.lineCache.get(0);
			a.ok(cached, 'line cached after renderLine');
			a.equal(
				(cached as SourceLine).text,
				'hello',
				'cached text matches',
			);
		});

		it.should('resize clears the line cache', a => {
			const tc = createTextCanvas(a);
			tc.renderLine(2, 'x');
			a.ok(tc.lineCache.get(2), 'cache populated');
			tc.resize();
			a.equal(
				tc.lineCache.get(2),
				undefined,
				'cache cleared after resize',
			);
		});

		it.should('commit paints a complete line to the canvas', a => {
			const tc = createTextCanvas(a);
			const ctx = tc.canvas.getContext('2d')!;

			tc.begin(0);
			tc.renderLine(0, 'A');
			tc.commit(0);

			const pixels = ctx.getImageData(
				0,
				0,
				tc.canvas.width,
				tc.canvas.height,
			).data;
			a.ok(
				pixels.some(
					(_, index) => index % 4 === 3 && pixels[index],
				),
				'line painted',
			);
		});

		it.should('measure caret and selection geometry', a => {
			const tc = createTextCanvas(a);
			tc.begin(0);
			tc.renderLine(0, 'ABC');
			tc.commit(0);

			const caret = tc.getCaret({ line: 0, ch: 2 });
			if (!caret) {
				a.ok(false, 'caret measured');
				return;
			}
			a.ok(caret.x > 0);
			const selection = tc.getSelectionRects(
				{ line: 0, ch: 1 },
				{ line: 0, ch: 3 },
			);
			a.equal(selection.length, 1);
			a.ok(selection[0].width > 0);

			const hitTest = new HitTest(tc);
			const before = hitTest.getCaretAtPosition(
				0,
				caret.y + caret.height / 2,
			);
			const after = hitTest.getCaretAtPosition(
				caret.x - 0.1,
				caret.y + caret.height / 2,
			);
			a.equalValues(before?.position, { line: 0, ch: 0 });
			a.equalValues(after?.position, { line: 0, ch: 2 });
		});

		it.should('keep a stable baseline as line glyphs change', a => {
			const tc = createTextCanvas(a);
			tc.begin(0);
			tc.renderLine(0, 'iii');
			tc.renderLine(1, 'Mgy');
			tc.commit(0);
			const first = tc.lineCache.get(0)?.lines.get(0);
			const second = tc.lineCache.get(1)?.lines.get(0);
			a.equal(first?.baseline, second?.baseline);
		});

		it.should('hit test empty and wrapped visual lines', a => {
			const empty = createTextCanvas(a);
			empty.begin(0);
			empty.renderLine(0, '');
			empty.commit(0);
			const emptyCaret = new HitTest(empty).getCaretAtPosition(10, 5);
			a.equalValues(emptyCaret?.position, { line: 0, ch: 0 });

			const wrapped = createTextCanvas(a, 50);
			wrapped.begin(0);
			wrapped.renderLine(0, 'abcdefghijklmnop');
			wrapped.commit(0);
			const caret = wrapped.getCaret({ line: 0, ch: 10 });
			if (!caret) {
				a.ok(false, 'wrapped caret measured');
				return;
			}
			a.ok(caret.y > 0, 'caret is on a wrapped visual line');
			const hit = new HitTest(wrapped).getCaretAtPosition(
				caret.x + 0.1,
				caret.y + caret.height / 2,
			);
			a.equalValues(hit?.position, { line: 0, ch: 10 });
		});

		it.should('paint complete wrapped and tabbed lines', a => {
			const tc = createTextCanvas(a);
			const value = `start\t${'wrapped '.repeat(8)}end`;

			tc.begin(0);
			tc.renderLine(0, value);
			tc.commit(0);

			const line = tc.lineCache.get(0);
			if (!line) {
				a.ok(false, 'line measured');
				return;
			}
			a.equal(
				[...line.lines].map(part => part.text).join(''),
				value,
			);
		});

		it.should('bounds retained line measurements', a => {
			const tc = createTextCanvas(a);

			for (let line = 0; line < tc.lineCache.capacity + 100; line++)
				tc.renderLine(line, `line ${line}`);

			a.equal([...tc.lineCache].length, tc.lineCache.capacity);
		});

		it.should('bounds painting work to the viewport', a => {
			const tc = createTextCanvas(a);
			const buffer = new Buffer();
			const source = createLargeSource();
			const resetStart = performance.now();
			buffer.reset(source);
			const resetDuration = performance.now() - resetStart;
			const renderStart = performance.now();

			tc.begin(50_000);
			for (let line = 50_000; line < 50_060; line++)
				tc.renderLine(line, buffer.getLine(line));
			tc.commit(0);

			const renderDuration = performance.now() - renderStart;
			const paintedLines = [...tc.lineCache].filter(
				line => [...line.lines].length,
			).length;
			const scrollStart = performance.now();
			tc.begin(50_060);
			for (let line = 50_060; line < 50_120; line++)
				tc.renderLine(line, buffer.getLine(line));
			tc.commit(0);
			const scrollDuration = performance.now() - scrollStart;
			a.equal(buffer.getLineCount(), LargeLineCount);
			a.equal(buffer.getLine(99_999), `99999\t${'value'.repeat(8)}`);
			a.ok(source.length > 4_000_000);
			a.ok(paintedLines > 0);
			a.ok(paintedLines < 60);
			a.equal([...tc.lineCache].length, 120);
			a.log({
				fixtureBytes: source.length,
				paintedLines,
				renderDuration,
				resetDuration,
				scrollDuration,
			});
		});
	});
});
