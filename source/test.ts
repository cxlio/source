import { spec, type TestApi } from '@cxl/spec';
import {
	ScannerApi,
	type Scanner,
	type Token,
} from '@cxl/gbc.sdk';
import { Buffer } from './buffer.js';
import {
	Code,
	Source,
	gutterMarkers,
	lineNumbers,
	type SourceChange,
	type SourceDecorationFragment,
} from './index.js';
import { createTextareaInput } from './input.js';
import { HitTest } from './hit-test.js';
import { SourceHighlight } from './highlight.js';
import { textCanvas, type SourceLine } from './text.js';

const LargeLineCount = 100_000;

type TestTokenKind = 'word' | 'number' | 'eof';

const testScanner: Scanner<Token<TestTokenKind>> = source => {
	const api = ScannerApi({ source });
	return {
		backtrack: api.backtrack,
		next() {
			api.skipWhitespace();
			if (api.eof()) return api.tk('eof', 0);
			const number = api.current() >= '0' && api.current() <= '9';
			return api.tk(
				number ? 'number' : 'word',
				api.matchWhile(ch =>
					number
						? ch >= '0' && ch <= '9'
						: ch !== ' ' && ch !== '\n',
				),
			);
		},
	};
};

const failingScanner: Scanner<Token<TestTokenKind>> = source => {
	const api = ScannerApi({ source });
	return {
		backtrack: api.backtrack,
		next() {
			if (api.eof()) return api.tk('eof', 0);
			if (api.current() === '!') throw new Error('Expected digit');
			return api.tk('word', 1);
		},
	};
};

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
	source.setText(value);
	await a.sleep(75);
	return {
		source,
		target: source.editContext
			? source
			: (source.shadowRoot?.querySelector('textarea') ?? source),
	};
}

async function createCode(a: TestApi, value: string) {
	const code = a.element(Code);
	code.style.cssText =
		'display:block;width:320px;height:160px;font:12px monospace';
	code.setText(value);
	await a.sleep(75);
	return code;
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
	modifier: 'Alt' | 'Control' | 'Shift',
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
	return bottom < top ? undefined : { top, bottom };
}

function paintedWidth(canvas: HTMLCanvasElement) {
	const context = canvas.getContext('2d');
	if (!context) return 0;
	const pixels = context.getImageData(
		0,
		0,
		canvas.width,
		canvas.height,
	).data;
	let left = canvas.width;
	let right = -1;
	for (let pixel = 0; pixel < pixels.length / 4; pixel++) {
		if (!pixels[pixel * 4 + 3]) continue;
		const x = pixel % canvas.width;
		left = Math.min(left, x);
		right = Math.max(right, x);
	}
	return right < left ? 0 : right - left + 1;
}

function isPainted(
	canvas: HTMLCanvasElement,
	top: number,
	bottom: number,
) {
	const context = canvas.getContext('2d');
	if (!context) return false;
	const pixels = context.getImageData(
		0,
		top,
		canvas.width,
		bottom - top,
	).data;
	for (let index = 3; index < pixels.length; index += 4)
		if (pixels[index]) return true;
	return false;
}

async function editorValue(a: TestApi, element: Element) {
	await editorShortcut(a, element, 'Control', 'a');
	return clipboardSelection(element);
}

export default spec('@cxl/ui.source', a => {
	a.test('demo', it => {
		it.testElement('loads as a self-contained static page', async (a: TestApi) => {
			const path = '../../docs/demo/index.html';
			const frame = a.element('iframe');
			frame.width = '240';
			frame.height = '800';
			const loaded = new Promise<void>(resolve =>
				frame.addEventListener('load', () => resolve(), { once: true }),
			);
			frame.src = path;
			await loaded;

			const editor = frame.contentDocument?.querySelector('c-source');
			a.assert(editor, 'demo editor exists');
			a.ok(
				Boolean(frame.contentWindow?.customElements.get('c-source')),
				'demo editor initializes',
			);
			const source = editor as HTMLElement &
				Pick<Source, 'getText' | 'selection'>;
			frame.scrollIntoView({ block: 'center' });
			source.scrollIntoView({ block: 'center' });
			await a.sleep(75);
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas');
			a.assert(canvas, 'demo editor canvas exists');
			const bounds = paintedBounds(canvas);
			a.assert(bounds, 'wrapped text is painted');
			const lineHeight = parseFloat(
				frame.contentWindow?.getComputedStyle(source).lineHeight ?? '0',
			);
			const paintedHeight = bounds.bottom - bounds.top;
			a.ok(
				paintedHeight > lineHeight,
				`wrapped rows span ${paintedHeight}px (${bounds.top}-${bounds.bottom}) at ${lineHeight}px line height`,
			);
			const find = frame.contentDocument?.querySelector<HTMLInputElement>('#find');
			const replace =
				frame.contentDocument?.querySelector<HTMLInputElement>('#replace');
			const next = frame.contentDocument?.querySelector<HTMLButtonElement>('#next');
			const replaceNext =
				frame.contentDocument?.querySelector<HTMLButtonElement>('#replace-next');
			a.assert(find, 'demo find input exists');
			a.assert(replace, 'demo replace input exists');
			a.assert(next, 'demo next button exists');
			a.assert(replaceNext, 'demo replace button exists');
			find.value = 'source';
			replace.value = 'editor';
			next.click();
			const match = source.selection.range();
			replaceNext.click();
			a.equal(source.getText().slice(match.start, match.start + 6), 'editor');
		});
	});

	a.test('code', it => {
		it.testElement('supports native pointer selection', async (a: TestApi) => {
			const code = await createCode(a, 'one\ntwo\nthree');
			const content = code.shadowRoot?.querySelector('pre');
			a.assert(content, 'code exposes selectable HTML text');
			const text = content.querySelector('code')?.firstChild;
			a.assert(text, 'code exposes selectable HTML text');
			const characterRect = (index: number) => {
				const range = document.createRange();
				range.setStart(text, index);
				range.setEnd(text, index + 1);
				return range.getBoundingClientRect();
			};
			const marker = (rect: DOMRect) => {
				const element = a.element('div');
				element.style.cssText = `position:absolute;pointer-events:none;z-index:1000;left:${window.scrollX + rect.left}px;top:${window.scrollY + rect.top + rect.height / 2}px;width:1px;height:1px`;
				return element;
			};

			const selection = await a.drag(
				marker(characterRect(0)),
				marker(characterRect(8)),
			);
			a.ok(selection.success, selection.message ?? selection.failureMessage);
			a.equal(document.getSelection()?.toString(), 'one\ntwo\n');
			const clipboardTarget = a.element('textarea');
			await editorShortcut(a, document.body, 'Control', 'c');
			await editorShortcut(a, clipboardTarget, 'Control', 'v');
			a.equal(clipboardTarget.value, 'one\ntwo\n');
			a.equal(code.tabIndex, -1);
		});

		it.testElement('renders highlighted code without editor controls', async a => {
			const code = await createCode(a, 'alpha 12');
			code.tokenizer = testScanner;
			code.tokenColors = {
				word: '#0d47a1',
				number: '#e64a19',
			};
			await a.sleep(20);

			a.equal(code.getText(), 'alpha 12');
			a.equal(code.getTokenAt(7)?.kind, 'number');
			a.equal(code.shadowRoot?.querySelectorAll('canvas').length, 0);
			a.equal(code.shadowRoot?.querySelectorAll('span').length, 2);
			a.equal(code.shadowRoot?.querySelector('code')?.textContent, 'alpha 12');
			a.equal(code.shadowRoot?.querySelector('textarea'), null);
			a.equal(code.getAttribute('role'), 'code');
			await a.a11y(code);
		});

		it.testElement('renders unhighlighted buffers as one text node', async a => {
			const code = await createCode(a, createLargeSource());
			const content = code.shadowRoot?.querySelector('code');

			a.equal(code.getText(0, 6), '0\tvalu');
			a.equal(content?.childNodes.length, 1);
			a.ok(Boolean(content?.textContent?.includes('99999')));
		});

		it.testElement('is the base of the source editor', async a => {
			const { source } = await createSourceEditor(a, 'alpha');
			const canvases = source.shadowRoot?.querySelectorAll('canvas');

			a.ok(source instanceof Code);
			a.equal(canvases?.length, 4);
			a.equal(
				[...(canvases ?? [])]
					.map(canvas => canvas.getAttribute('part'))
					.join(','),
				'decorations-behind,text,decorations-above,cursor',
			);
			a.equal(
				source.shadowRoot?.querySelectorAll(
					'canvas[part^="decorations-"][aria-hidden="true"]',
				).length,
				2,
			);
			a.equal(source.getAttribute('role'), 'textbox');
		});
	});

	void a.figure(
		'block-selection',
		'<c-source-block-selection style="display:block;width:320px;height:96px;pointer-events:none;font:16px/20px monospace;color:#111;--cxl-source-selection:rgba(0,120,215,.35)"></c-source-block-selection>',
		node => {
			(node as HTMLElement).style.pointerEvents = 'none';
			if (customElements.get('c-source-block-selection')) return;
			customElements.define(
				'c-source-block-selection',
				class extends Source {
					constructor() {
						super();
						this.setText('alpha\nbravo\ncharlie');
					}

					protected override connectedCallback() {
						super.connectedCallback();
						this.selection.block(
							this.cursor.indexAt({ line: 0, ch: 1 }),
							this.cursor.indexAt({ line: 2, ch: 4 }),
						);
					}
				},
			);
		},
	);

	a.test('native input', it => {
		it.testElement('renders text set before connection after editing', async (a: TestApi) => {
			const container = a.element('div');
			container.style.cssText =
				'display:flex;box-sizing:border-box;min-height:360px;padding:16px;width:100%';
			const source = new Source();
			const value = `main {\n\t'Hello World' >> out\n}`;
			source.style.cssText =
				'flex:1;font:14px/20px monospace;tab-size:4';
			source.setText(value);
			source.tokenizer = testScanner;
			container.append(source);
			container.scrollIntoView({ block: 'center' });
			await a.sleep(75);
			a.ok(
				source.getBoundingClientRect().top < window.innerHeight,
				'source renders while visible',
			);
			container.style.marginTop = `${window.innerHeight * 2}px`;
			window.scrollTo(0, 0);
			await a.sleep(75);
			a.ok(
				source.getBoundingClientRect().top > window.innerHeight,
				'source leaves the viewport',
			);
			source.scrollIntoView({ block: 'center' });

			const target = source.editContext
				? source
				: (source.shadowRoot?.querySelector('textarea') ?? source);
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="text"]',
			);
			const body = source.shadowRoot?.querySelector<HTMLElement>('#body');
			const measure = source.shadowRoot?.querySelector<HTMLElement>('#measure');
			a.assert(body && canvas && measure, 'editor rendering surface exists');
			const lineHeight = measure.offsetHeight;
			const rect = body.getBoundingClientRect();
			const marker = a.element('div');
			marker.style.cssText = `position:absolute;pointer-events:none;z-index:1000;left:${window.scrollX + rect.left + 80}px;top:${window.scrollY + rect.top + lineHeight * 1.5}px;width:1px;height:1px`;
			const click = await a.tap(marker);
			a.ok(click.success, click.message ?? click.failureMessage);
			await editorAction(a, target, 'press', 'Enter');
			await a.sleep(75);

			const editedLines = source.getText().split('\n');
			a.ok(
				editedLines.every(Boolean),
				'returning click moves the caret before editing',
			);
			for (let line = 0; line < 4; line++)
				a.ok(
					isPainted(
						canvas,
						line * lineHeight,
						(line + 1) * lineHeight,
					),
					`line ${line + 1} remains painted`,
				);
			a.equal(editedLines.length, 4);
		});

		it.testElement('exposes text and compact native changes', async a => {
			const { source, target } = await createSourceEditor(a, 'alpha');
			const changes: SourceChange[] = [];
			const subscription = source.changes.subscribe(change =>
				changes.push(change),
			);

			await editorAction(a, target, 'type', 'X');

			a.equal(source.getText(), 'Xalpha');
			a.equal(source.getText(1, 3), 'al');
			a.equalValues(changes, [
				{
					start: 0,
					end: 0,
					text: 'X',
					removed: '',
					lineStart: 0,
					lineEnd: 0,
					lineDelta: 0,
				},
			]);
			subscription.unsubscribe();
		});

		it.testElement('edits the public selection range', async a => {
			const { source } = await createSourceEditor(a, 'alpha');

			source.selection.set(4, 1);
			a.equalValues(source.selection.range(), { start: 1, end: 4 });
			const change = source.edit.replace('X');

			a.equal(source.getText(), 'aXa');
			a.equalValues(source.selection.range(), { start: 2, end: 2 });
			a.equalValues(change, {
				start: 1,
				end: 4,
				text: 'X',
				removed: 'lph',
				lineStart: 0,
				lineEnd: 0,
				lineDelta: 0,
			});
		});

		it.testElement('manages observable selection ranges', async a => {
			const { source } = await createSourceEditor(a, 'alpha');
			let changes = 0;
			const subscription = source.selection.onChange.subscribe(() => changes++);

			source.selection.set(NaN, Infinity);
			a.equalValues(source.selection.range(), { start: 0, end: 5 });
			source.selection.set(4, 1);
			a.equalValues(source.selection.ranges(), [{ start: 1, end: 4 }]);
			a.ok(source.selection.somethingSelected());
			source.selection.begin();
			source.selection.begin();
			source.cursor.go(0);
			source.selection.end();
			source.selection.end();
			a.equalValues(source.selection.range(), { start: 0, end: 4 });
			source.selection.set(4, 0);

			source.selection.add(
				{ start: 2, end: 2 },
				{ start: Infinity, end: -1 },
			);
			a.equalValues(source.selection.ranges(), [
				{ start: 0, end: 4 },
				{ start: 2, end: 2 },
				{ start: 0, end: 5 },
			]);
			a.equal(source.cursor.index, 0);
			source.selection.add();
			source.selection.clear();
			a.equalValues(source.selection.ranges(), [{ start: 5, end: 5 }]);
			a.ok(!source.selection.somethingSelected());
			a.equal(changes, 5);
			subscription.unsubscribe();
		});

		it.testElement('creates rectangular block selections', async a => {
			const { source } = await createSourceEditor(a, 'abcd\nx\n\nwxyz');
			const end = source.cursor.indexAt({ line: 3, ch: 3 });

			source.selection.block(1, end);
			a.equalValues(source.selection.ranges(), [
				{ start: 1, end: 3 },
				{ start: 6, end: 6 },
				{ start: 7, end: 7 },
				{ start: 9, end: 11 },
			]);
			a.equal(source.cursor.index, end);

			source.selection.block(end, 1);
			a.equalValues(source.selection.ranges(), [
				{ start: 9, end: 11 },
				{ start: 7, end: 7 },
				{ start: 6, end: 6 },
				{ start: 1, end: 3 },
			]);
			a.equal(source.cursor.index, 1);

			source.selection.block(NaN, Infinity);
			a.equalValues(source.selection.ranges(), [
				{ start: 0, end: 4 },
				{ start: 5, end: 6 },
				{ start: 7, end: 7 },
				{ start: 8, end: 12 },
			]);
		});

		it.testElement('edits multiple selections as one history entry', async a => {
			const { source } = await createSourceEditor(a, 'ab\ncd');
			source.selection.block(
				source.cursor.indexAt({ line: 0, ch: 1 }),
				source.cursor.indexAt({ line: 1, ch: 1 }),
			);

			source.edit.replace('X');
			a.equal(source.getText(), 'aXb\ncXd');
			a.equalValues(source.selection.ranges(), [
				{ start: 2, end: 2 },
				{ start: 6, end: 6 },
			]);

			source.history.undo();
			a.equal(source.getText(), 'ab\ncd');
			a.equalValues(source.selection.ranges(), [
				{ start: 1, end: 1 },
				{ start: 4, end: 4 },
			]);
			source.history.redo();
			a.equal(source.getText(), 'aXb\ncXd');

			source.selection.set(1, 3);
			source.selection.add({ start: 2, end: 4 }, { start: 1, end: 3 });
			source.edit.replace('Y');
			a.equal(source.getText(), 'aYcXd');
			a.equalValues(source.selection.ranges(), [
				{ start: 2, end: 2 },
				{ start: 2, end: 2 },
				{ start: 2, end: 2 },
			]);
		});

		it.testElement('preserves selections through edits and reset', async a => {
			const { source } = await createSourceEditor(a, 'abcdef');

			source.selection.set(6, 5);
			source.selection.add({ start: 4, end: 2 });
			source.edit.replace('X');
			a.equal(source.getText(), 'abXeX');
			a.equalValues(source.selection.ranges(), [
				{ start: 5, end: 5 },
				{ start: 3, end: 3 },
			]);

			source.history.undo();
			a.equal(source.getText(), 'abcdef');
			a.equalValues(source.selection.ranges(), [
				{ start: 5, end: 6 },
				{ start: 2, end: 4 },
			]);
			source.selection.begin();
			source.cursor.go(1);
			source.selection.end();
			a.equalValues(source.selection.ranges(), [
				{ start: 5, end: 6 },
				{ start: 1, end: 4 },
			]);
			source.history.redo();
			a.equalValues(source.selection.ranges(), [
				{ start: 5, end: 5 },
				{ start: 3, end: 3 },
			]);

			source.setText('abc');
			a.equalValues(source.selection.ranges(), [
				{ start: 3, end: 3 },
				{ start: 3, end: 3 },
			]);
		});

		it.testElement('navigates the public cursor by index and position', async a => {
			const { source } = await createSourceEditor(a, 'one\ntwo\nthree');
			const cursor: {
				readonly index: number;
				go(index: number): void;
				range(from?: number, to?: number): { start: number; end: number };
			} = source.cursor;

			cursor.go(6);
			a.equal(cursor.index, 6);
			a.equalValues(cursor.range(), { start: 6, end: 6 });
			a.equalValues(cursor.range(6, 2), { start: 2, end: 6 });
			a.equalValues(source.cursor.position(), { line: 1, ch: 2 });
			a.equal(source.cursor.indexAt({ line: 2, ch: 3 }), 11);

			cursor.go(Infinity);
			a.equal(cursor.index, source.getText().length);
		});

		it.testElement('navigates horizontal and line cursors', async a => {
			const { source } = await createSourceEditor(a, 'one\n\nthree');

			source.cursor.go(2);
			a.equal(source.cursorX.index, 2);
			source.cursorX.next();
			source.cursorX.next();
			a.equalValues(source.cursor.position(), { line: 1, ch: 0 });
			source.cursorX.previous();
			a.equalValues(source.cursor.position(), { line: 0, ch: 3 });
			a.equalValues(source.cursorX.range(3, 1), { start: 1, end: 3 });
			source.cursorX.goEnd();
			a.equal(source.cursor.index, 3);
			source.cursorX.goStart();
			a.equal(source.cursor.index, 0);
			source.cursorX.nextPage();
			a.equal(source.cursor.index, 3);
			source.cursorX.previousPage();
			a.equal(source.cursor.index, 0);

			source.cursorY.go(2);
			a.equal(source.cursorY.index, 2);
			a.equal(source.cursor.index, 5);
			a.equalValues(source.cursorY.range(2, 0), { start: 0, end: 10 });
			a.equalValues(source.cursorY.range(1), { start: 4, end: 4 });
			source.cursorY.go(-1);
			a.equal(source.cursorY.index, 0);
			source.cursorY.go(Infinity);
			a.equal(source.cursorY.index, 2);
			source.cursorY.goStart();
			source.cursorY.nextPage();
			a.equal(source.cursorY.index, 2);
			source.cursorY.previousPage();
			a.equal(source.cursorY.index, 0);
			a.equal(source.cursorY.getVisibleFirst(), 0);

			source.cursor.goEnd();
			source.cursor.previous();
			a.equal(source.cursor.index, 9);
			source.cursor.goStart();
			source.cursor.next();
			source.cursor.nextPage();
			a.equal(source.cursor.index, 10);
			source.cursor.previousPage();
			a.equal(source.cursor.index, 0);

			source.setText('one\r\ntwo');
			source.cursor.go(3);
			source.cursorX.next();
			a.equalValues(source.cursor.position(), { line: 1, ch: 0 });
			source.cursorX.previous();
			a.equal(source.cursor.index, 3);
		});

		it.testElement('navigates tokenizer ranges and tolerates missing data', async a => {
			const { source } = await createSourceEditor(a, 'alpha 12 beta');
			const tokenCursor = source.cursorToken;

			a.equal(tokenCursor.index, 0);
			a.equalValues(tokenCursor.range(), { start: 0, end: 0 });
			tokenCursor.next();
			a.equal(source.cursor.index, 0);

			source.tokenizer = testScanner;
			await a.sleep(20);
			a.equalValues(tokenCursor.range(), { start: 0, end: 5 });
			tokenCursor.next();
			a.equal(source.cursor.index, 6);
			a.equal(tokenCursor.index, 1);
			a.equalValues(tokenCursor.range(2, 1), { start: 6, end: 13 });
			tokenCursor.goEnd();
			a.equal(source.cursor.index, source.getText().length);
			tokenCursor.previous();
			a.equal(source.cursor.index, 9);
			tokenCursor.previousPage();
			a.equal(source.cursor.index, 0);
			tokenCursor.nextPage();
			a.equal(source.cursor.index, source.getText().length);
			tokenCursor.goStart();
			a.equal(source.cursor.index, 0);

			source.edit.replace('', { start: 5, end: source.getText().length });
			tokenCursor.goEnd();
			a.ok(source.cursor.index <= source.getText().length);
			source.tokenizer = undefined;
			await a.sleep(20);
			const index = source.cursor.index;
			tokenCursor.previousPage();
			a.equal(source.cursor.index, index);
			a.equalValues(tokenCursor.range(), { start: index, end: index });

			source.setText('!');
			source.tokenizer = failingScanner;
			await a.sleep(20);
			const failedIndex = source.cursor.index;
			tokenCursor.next();
			a.equal(source.cursor.index, failedIndex);
			a.equalValues(tokenCursor.range(), {
				start: failedIndex,
				end: failedIndex,
			});
		});

		it.testElement('finds strings with direction wrap and case options', async a => {
			const { source } = await createSourceEditor(
				a,
				'Alpha alpha beta ALPHA',
			);

			a.equalValues(source.search.find('alpha'), { start: 0, end: 5 });
			a.equalValues(source.selection.range(), { start: 0, end: 5 });
			a.equalValues(source.search.findNext(), { start: 6, end: 11 });
			a.equalValues(source.search.findPrevious(), { start: 0, end: 5 });
			a.equalValues(
				source.search.findAll('Alpha', { caseSensitive: true }),
				[{ start: 0, end: 5 }],
			);

			source.cursor.go(0);
			a.equalValues(
				source.search.find('alpha', { reverse: true }),
				{ start: 17, end: 22 },
				'reverse search wraps',
			);
		});

		it.testElement('finds regular expressions without zero-length loops', async a => {
			const { source } = await createSourceEditor(a, 'one 12 two 345');

			a.equalValues(source.search.findAll(/\d+/), [
				{ start: 4, end: 6 },
				{ start: 11, end: 14 },
			]);
			a.equalValues(source.search.findAll(/(?=\w)/g).slice(0, 3), [
				{ start: 0, end: 0 },
				{ start: 1, end: 1 },
				{ start: 2, end: 2 },
			]);
		});

		it.testElement('paints visible range decorations through custom painters', async (a: TestApi) => {
			const { source } = await createSourceEditor(
				a,
				`${'wrapped '.repeat(12)}\nsecond line`,
			);
			const painted: SourceDecorationFragment[][] = [];
			const decorations = source.decorations.create<string>({
				layer: 'above-text',
				paint: ({ fragments }) => painted.push([...fragments]),
			});
			const decoration = decorations.add({
				range: { start: 0, end: 108 },
				value: 'match',
			});
			await a.sleep(20);

			const wrapped: SourceDecorationFragment[] | undefined = painted.at(-1);
			a.assert(wrapped, 'decoration painted');
			a.ok(wrapped.length > 1, 'wrapped range has multiple fragments');
			a.ok(
				wrapped.some(fragment => fragment.line === 1),
				'multiline range includes each line',
			);

			painted.length = 0;
			decoration.update({
				range: { start: 108, end: 97 },
				value: 'updated',
			});
			await a.sleep(20);
			a.equal(painted.at(-1)?.at(0)?.line, 1);

			painted.length = 0;
			source.edit.replace('prefix ', { start: 0, end: 0 });
			await a.sleep(20);
			a.equal(painted.at(-1)?.at(0)?.start, 104);

			painted.length = 0;
			decoration.remove();
			await a.sleep(20);
			a.equal(painted.length, 0);

			const intersected = decorations.add({
				range: { start: 0, end: 7 },
				value: 'intersected',
			});
			painted.length = 0;
			source.edit.replace('x', { start: 2, end: 3 });
			await a.sleep(20);
			a.equal(painted.length, 0, 'intersected decoration removed');
			intersected.invalidate();
			a.equal(painted.length, 0, 'removed handle remains inactive');
		});

		it.testElement('only invokes decoration painters for the viewport', async a => {
			const value = Array.from(
				{ length: 200 },
				(_, line) => `line ${line}`,
			).join('\n');
			const { source } = await createSourceEditor(a, value);
			const painted: string[] = [];
			const decorations = source.decorations.create<string>({
				layer: 'behind-text',
				paint: ({ value }) => painted.push(value),
			});
			decorations.replaceAll([
				{ range: { start: 0, end: 6 }, value: 'first' },
				{
					range: {
						start: value.lastIndexOf('line 199'),
						end: value.length,
					},
					value: 'last',
				},
			]);
			await a.sleep(20);
			a.ok(painted.includes('first'));
			a.ok(!painted.includes('last'));

			painted.length = 0;
			source.scrollTop = source.scrollHeight;
			await a.sleep(50);
			a.ok(!painted.includes('first'));
			a.ok(painted.includes('last'));
		});

		it.testElement('highlights and clears all visible search matches', async (a: TestApi) => {
			const { source } = await createSourceEditor(
				a,
				'alpha beta alpha gamma alpha',
			);
			const canvas: HTMLCanvasElement | null | undefined =
				source.shadowRoot?.querySelector<HTMLCanvasElement>(
					'canvas[part="decorations-behind"]',
				);
			a.assert(canvas, 'search decoration canvas exists');

			source.search.highlight('alpha');
			await a.sleep(20);
			a.ok(paintedWidth(canvas) > 0, 'search matches painted');

			source.search.highlight();
			await a.sleep(20);
			a.equal(paintedWidth(canvas), 0, 'search matches cleared');
		});

		it.testElement('replaces the next and all search matches', async a => {
			const { source } = await createSourceEditor(a, 'one ONE one');

			source.search.find('one', { caseSensitive: true });
			source.search.replaceNext('one', 'two', { caseSensitive: true });
			a.equal(source.getText(), 'two ONE one');
			source.cursor.go(0);
			source.search.replaceAll('one', 'x', { caseSensitive: false });
			a.equal(source.getText(), 'two x x');
		});

		it.testElement('undoes and redoes edits with their selections', async a => {
			const { source, target } = await createSourceEditor(a, 'alpha');
			const history: { undo(): void; redo(): void } = source.history;

			await editorShortcut(a, target, 'Control', 'a');
			await editorAction(a, target, 'type', 'beta');
			a.equal(source.getText(), 'beta');

			history.undo();
			a.equal(source.getText(), 'alpha');
			a.equal(clipboardSelection(target), 'alpha', 'restores replaced selection');

			history.redo();
			a.equal(source.getText(), 'beta');
			a.equal(clipboardSelection(target), '', 'restores collapsed selection');
		});

		it.testElement('invalidates redo after a new edit', async a => {
			const { source, target } = await createSourceEditor(a, '');

			await editorAction(a, target, 'type', 'a');
			await editorAction(a, target, 'type', 'b');
			source.history.undo();
			a.equal(source.getText(), '');

			await editorAction(a, target, 'type', 'c');
			source.history.redo();
			a.equal(source.getText(), 'c');
		});

		it.testElement('undoes and redoes deletion', async a => {
			const { source, target } = await createSourceEditor(a, 'ab');

			await editorAction(a, target, 'press', 'End');
			await editorAction(a, target, 'press', 'Backspace');
			a.equal(source.getText(), 'a');

			source.history.undo();
			a.equal(source.getText(), 'ab');
			source.history.redo();
			a.equal(source.getText(), 'a');
		});

		it.testElement('clears history when text is replaced externally', async a => {
			const { source, target } = await createSourceEditor(a, 'alpha');

			await editorAction(a, target, 'type', 'X');
			source.setText('external');
			source.history.undo();

			a.equal(source.getText(), 'external');
		});

		it.should('bounds incremental history records', a => {
			const source = new Source();
			source.setText('');
			for (let edit = 0; edit <= 1_000; edit++) source.edit.replace('x');
			for (let edit = 0; edit <= 1_000; edit++) source.history.undo();

			a.equal(source.getText(), 'x');
		});

		it.testElement('emits compact changes for a large document', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(
				a,
				createLargeSource(),
			);
			const changes: SourceChange[] = [];
			const subscription = source.changes.subscribe(change =>
				changes.push(change),
			);

			await editorAction(a, target, 'type', 'X');

			a.equal(changes.length, 1);
			const [change] = changes;
			a.assert(change);
			a.equal(change.text, 'X');
			a.equal(change.removed, '');
			subscription.unsubscribe();
		});

		it.testElement('defer and coalesce highlighting snapshots', async a => {
			let source = 'alpha';
			let snapshots = 0;
			const highlight = new SourceHighlight(() => undefined);
			const readSource = () => {
				snapshots++;
				return source;
			};

			highlight.reset(readSource, testScanner);
			source = 'alpha 12';
			highlight.reset(readSource, testScanner, 5, 0);
			a.equal(snapshots, 0, 'snapshot is not built in the edit path');

			await a.sleep(20);
			a.equal(snapshots, 1, 'rapid edits share the scheduled snapshot');
			a.equal(highlight.getTokenAt(7)?.kind, 'number');
		});

		it.testElement('exposes SDK tokenizer results publicly', async a => {
			const { source } = await createSourceEditor(a, 'alpha 12');
			source.tokenizer = testScanner;
			source.tokenColors = {
				word: '#0d47a1',
				number: '#e64a19',
				error: '#b00020',
			};
			await a.sleep(20);
			const word = source.getTokenAt(2);
			const number = source.getTokenAt(7);
			a.equalValues(
				word && {
					kind: word.kind,
					start: word.start,
					end: word.end,
				},
				{ kind: 'word', start: 0, end: 5 },
			);
			a.equalValues(
				number && {
					kind: number.kind,
					start: number.start,
					end: number.end,
				},
				{ kind: 'number', start: 6, end: 8 },
			);

			source.tokenizer = undefined;
			await a.sleep(20);
			a.equal(source.getTokenAt(2), undefined);
		});

		it.testElement('keeps rendering when pasted text breaks a tokenizer', async a => {
			const { source, target } = await createSourceEditor(a, 'alpha\nbeta');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="text"]',
			);
			const pasted = new DataTransfer();
			pasted.setData('text/plain', '!pasted\nsecond');
			let error = '';
			const onError = (event: ErrorEvent) => {
				error = event.error instanceof Error ? event.error.message : event.message;
				event.preventDefault();
			};
			window.addEventListener('error', onError);
			try {
				source.tokenizer = failingScanner;
				target.dispatchEvent(
					new ClipboardEvent('paste', {
						bubbles: true,
						cancelable: true,
						clipboardData: pasted,
					}),
				);
				await a.sleep(20);
			} finally {
				window.removeEventListener('error', onError);
			}

			a.equal(error, '', 'tokenizer error is contained');
			a.ok(Boolean(canvas && paintedBounds(canvas)), 'text remains painted');
			a.equal(source.getText(), '!pasted\nsecondalpha\nbeta');
		});

		it.should('apply bounded textarea input changes', (a: TestApi) => {
			const host = a.element('div');
			const container = document.createElement('div');
			host.attachShadow({ mode: 'open' }).append(container);
			const input = createTextareaInput(container);

			let update;
			const subscription = input.updates.subscribe(value => (update = value));
			input.sync('alpha', 2, 2, 10);
			const textarea = container.querySelector('textarea');
			a.assert(textarea, 'textarea input created');
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
			a.equal(getComputedStyle(source).outlineStyle, 'none');
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

		it.testElement('edits and copies block selections through native input', async a => {
			const { source, target } = await createSourceEditor(a, 'ab\ncd');
			source.selection.block(
				source.cursor.indexAt({ line: 0, ch: 0 }),
				source.cursor.indexAt({ line: 1, ch: 1 }),
			);
			a.equal(clipboardSelection(target), 'a\nc');

			await editorAction(a, target, 'type', 'X');
			a.equal(source.getText(), 'Xb\nXd');

			source.history.undo();
			a.equal(source.getText(), 'ab\ncd');
			a.equal(clipboardSelection(target, 'cut'), 'a\nc');
			a.equal(source.getText(), 'b\nd');

			const pasted = new DataTransfer();
			pasted.setData('text/plain', 'Z');
			target.dispatchEvent(
				new ClipboardEvent('paste', {
					bubbles: true,
					cancelable: true,
					clipboardData: pasted,
				}),
			);
			a.equal(source.getText(), 'Zb\nZd');
		});

		it.testElement('extends block selections with the keyboard', async a => {
			const { source, target } = await createSourceEditor(a, 'abc\ndef');
			source.cursor.go(1);
			(target as HTMLElement).focus();

			await editorAction(a, target, 'keyDown', 'Alt');
			await editorAction(a, target, 'keyDown', 'Shift');
			await editorAction(a, target, 'press', 'ArrowDown');
			await editorAction(a, target, 'press', 'ArrowRight');
			await editorAction(a, target, 'keyUp', 'Shift');
			await editorAction(a, target, 'keyUp', 'Alt');

			a.equalValues(source.selection.ranges(), [
				{ start: 1, end: 2 },
				{ start: 5, end: 6 },
			]);
			a.equal(clipboardSelection(target), 'b\ne');
		});

		it.testElement('scrolls a distant block head into view', async a => {
			const { source } = await createSourceEditor(
				a,
				Array.from({ length: 100 }, (_, line) => `line ${line}`).join('\n'),
			);
			source.selection.block(
				0,
				source.cursor.indexAt({ line: 80, ch: 2 }),
			);
			await a.sleep(50);
			a.ok(source.scrollTop > 0, 'block head scrolls into the viewport');
		});

		it.testElement('copy and paste with native keyboard shortcuts', async a => {
			const { target: source } = await createSourceEditor(a, 'copied text');
			const { target } = await createSourceEditor(a, '');
			const clipboardTarget = a.element('textarea');
			await editorShortcut(a, source, 'Control', 'a');
			await editorShortcut(a, source, 'Control', 'c');
			await editorShortcut(a, clipboardTarget, 'Control', 'v');
			a.equal(clipboardTarget.value, 'copied text', 'copy');

			clipboardTarget.value = 'pasted text';
			await editorShortcut(a, clipboardTarget, 'Control', 'a');
			await editorShortcut(a, clipboardTarget, 'Control', 'c');
			await editorShortcut(a, target, 'Control', 'v');
			a.equal(await editorValue(a, target), 'pasted text', 'paste');
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

		it.testElement('insert spaces without scrolling or punctuation', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'a');
			await editorAction(a, target, 'press', 'End');
			await editorAction(a, target, 'press', 'Space');
			const editContext = source.editContext;
			a.assert(editContext, 'EditContext is active');
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

		it.testElement('updates composition text at every block caret', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'ab\ncd');
			const editContext = source.editContext;
			a.assert(editContext, 'EditContext is active');
			source.selection.block(
				source.cursor.indexAt({ line: 0, ch: 1 }),
				source.cursor.indexAt({ line: 1, ch: 1 }),
			);

			editContext.dispatchEvent(
				new TextUpdateEvent('textupdate', {
					compositionEnd: 5,
					compositionStart: 4,
					selectionEnd: 5,
					selectionStart: 5,
					text: '日',
					updateRangeEnd: 4,
					updateRangeStart: 4,
				}),
			);
			editContext.dispatchEvent(
				new TextUpdateEvent('textupdate', {
					compositionEnd: 7,
					compositionStart: 5,
					selectionEnd: 7,
					selectionStart: 7,
					text: '日本',
					updateRangeEnd: 6,
					updateRangeStart: 5,
				}),
			);

			a.equal(source.getText(), 'a日本b\nc日本d');
			a.equalValues(source.selection.ranges(), [
				{ start: 3, end: 3 },
				{ start: 8, end: 8 },
			]);
		});

		it.testElement('keep text fixed through first focus and edit', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'MMMM');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="text"]',
			);
			a.assert(canvas, 'editor canvas exists');
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

		it.testElement('only paints the caret while focused', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'alpha');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="cursor"]',
			);
			a.assert(canvas, 'caret canvas exists');

			a.ok(!isPainted(canvas, 0, canvas.height), 'caret hidden before focus');
			await editorAction(a, target, 'press', 'ArrowRight');
			a.ok(isPainted(canvas, 0, canvas.height), 'caret painted while focused');

			a.element('textarea').focus();
			await a.sleep(20);
			a.ok(!isPainted(canvas, 0, canvas.height), 'caret hidden after blur');

			await editorAction(a, target, 'type', 'X');
			a.equal(await editorValue(a, target), 'aXlpha', 'caret position preserved');
		});

		it.testElement('supports a fat cursor', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'alpha');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="cursor"]',
			);
			a.assert(canvas, 'caret canvas exists');

			await editorAction(a, target, 'press', 'ArrowRight');
			const thinWidth = paintedWidth(canvas);
			source.fatCursor = true;
			await a.sleep(20);

			a.ok(paintedWidth(canvas) > thinWidth, 'fat cursor spans the character');
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

		it.testElement('moves the line cursor across wrapped visual rows', async a => {
			const { source } = await createSourceEditor(
				a,
				`${'wrapped '.repeat(12)}\nsecond`,
			);

			source.cursor.goStart();
			source.cursorY.next();
			const wrapped = source.cursor.position();
			a.equal(wrapped.line, 0);
			a.ok(wrapped.ch > 0, 'cursor advances within the wrapped line');
			source.cursorY.previous();
			a.equal(source.cursor.index, 0);
		});

		it.testElement('renders block selections across wrapped rows', async (a: TestApi) => {
			const { source } = await createSourceEditor(
				a,
				`${'wrapped '.repeat(12)}\n${'second '.repeat(12)}`,
			);
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="cursor"]',
			);
			const measure = source.shadowRoot?.querySelector<HTMLElement>('#measure');
			a.assert(canvas && measure, 'selection rendering surface exists');
			source.selection.block(
				source.cursor.indexAt({ line: 0, ch: 8 }),
				source.cursor.indexAt({ line: 1, ch: 60 }),
			);
			await a.sleep(20);
			const bounds = paintedBounds(canvas);
			a.assert(bounds, 'block selection is painted');
			a.ok(
				bounds.bottom - bounds.top > measure.offsetHeight * 2,
				'selection spans wrapped visual rows',
			);
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
			a.ok(source.cursorY.getVisibleFirst() > 0, 'visible first line updates');
		});

		it.testElement('select text with a real pointer drag', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'ABCDE');
			const body = source.shadowRoot?.querySelector<HTMLElement>('#body');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="text"]',
			);
			a.assert(body && canvas, 'editor rendering surface exists');
			const rect = body.getBoundingClientRect();
			const width = canvas.getContext('2d')?.measureText('ABC').width ?? 22;
			const lineHeight =
				source.shadowRoot?.querySelector<HTMLElement>('#measure')
					?.offsetHeight ?? 14;
			const marker = (x: number, y = rect.top + lineHeight / 2) => {
				const element = a.element('div');
				element.style.cssText = `position:absolute;pointer-events:none;z-index:1000;left:${window.scrollX + x - 1}px;top:${window.scrollY + y - 1}px;width:2px;height:2px`;
				return element;
			};
			const start = marker(rect.left + 2);
			const end = marker(rect.left + width);
			const whitespace = marker(
				rect.right - 2,
				rect.top + lineHeight + 10,
			);
			const forward = await a.drag(start, end);
			a.ok(forward.success, forward.message ?? forward.failureMessage);
			a.equal(clipboardSelection(target), 'ABC');

			const backward = await a.drag(end, start);
			a.ok(backward.success, backward.message ?? backward.failureMessage);
			a.equal(clipboardSelection(target), 'ABC');

			const fromWhitespace = await a.drag(whitespace, start);
			a.ok(
				fromWhitespace.success,
				fromWhitespace.message ?? fromWhitespace.failureMessage,
			);
			a.equal(clipboardSelection(target), 'ABCDE');

			const toWhitespace = await a.drag(start, whitespace);
			a.ok(
				toWhitespace.success,
				toWhitespace.message ?? toWhitespace.failureMessage,
			);
			a.equal(clipboardSelection(target), 'ABCDE');
		});

		it.testElement('select a block with an Alt pointer drag', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(
				a,
				'abcd\nefgh\nijkl',
			);
			const body = source.shadowRoot?.querySelector<HTMLElement>('#body');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="text"]',
			);
			const measure = source.shadowRoot?.querySelector<HTMLElement>('#measure');
			a.assert(body && canvas && measure, 'editor rendering surface exists');
			const rect = body.getBoundingClientRect();
			const context = canvas.getContext('2d');
			const x1 = context?.measureText('a').width ?? 7;
			const x3 = context?.measureText('abc').width ?? 21;
			const marker = (x: number, line: number) => {
				const element = a.element('div');
				element.style.cssText = `position:absolute;pointer-events:none;z-index:1000;left:${window.scrollX + rect.left + x}px;top:${window.scrollY + rect.top + measure.offsetHeight * (line + 0.5)}px;width:1px;height:1px`;
				return element;
			};

			await editorAction(a, target, 'keyDown', 'Alt');
			const selection = await a.drag(marker(x1, 0), marker(x3, 2));
			await editorAction(a, target, 'keyUp', 'Alt');
			a.ok(selection.success, selection.message ?? selection.failureMessage);
			a.equal(clipboardSelection(target), 'bc\nfg\njk');
		});

		it.testElement('stop block selection after pointer cleanup', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(
				a,
				'ABCDE\nABCDE\nABCDE',
			);
			const body = source.shadowRoot?.querySelector<HTMLElement>('#body');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="text"]',
			);
			const measure = source.shadowRoot?.querySelector<HTMLElement>('#measure');
			a.assert(body && canvas && measure, 'editor rendering surface exists');
			const rect = body.getBoundingClientRect();
			const width = canvas.getContext('2d')?.measureText('ABCD').width ?? 29;
			const options = {
				bubbles: true,
				composed: true,
				pointerId: 7,
			};
			const pointer = (
				type: string,
				line: number,
				init: PointerEventInit = {},
			) =>
				body.dispatchEvent(
					new PointerEvent(type, {
						...options,
						buttons: 1,
						clientX: rect.left + width,
						clientY: rect.top + measure.offsetHeight * (line + 0.5),
						...init,
					}),
				);
			source.setPointerCapture = () => undefined;
			source.hasPointerCapture = () => false;

			pointer('pointerdown', 0, {
				altKey: true,
				button: 0,
				clientX: rect.left + 2,
			});
			pointer('pointermove', 1);
			const before = source.selection.ranges();
			pointer('pointercancel', 1, { buttons: 0 });
			pointer('pointermove', 2);

			a.equalValues(source.selection.ranges(), before);

			pointer('pointerdown', 0, {
				altKey: true,
				button: 0,
				clientX: rect.left + 2,
			});
			pointer('pointermove', 1);
			const captured = source.selection.ranges();
			pointer('lostpointercapture', 1, { buttons: 0 });
			pointer('pointermove', 2);
			a.equalValues(source.selection.ranges(), captured);

			(target as HTMLElement).focus();
			await editorAction(a, target, 'keyDown', 'Alt');
			await editorAction(a, target, 'keyDown', 'Shift');
			await editorAction(a, target, 'press', 'ArrowDown');
			await editorAction(a, target, 'keyUp', 'Shift');
			await editorAction(a, target, 'keyUp', 'Alt');
			a.equal(source.selection.ranges().length, 2);
		});

		it.testElement('select downward from the left edge', async (a: TestApi) => {
			const source = new Source();
			source.style.cssText =
				'display:block;width:320px;height:160px;padding-left:8px;font:12px monospace';
			source.setText('one\ntwo\nthree');
			a.dom.append(source);
			await a.sleep(75);
			const target = source.editContext
				? source
				: (source.shadowRoot?.querySelector('textarea') ?? source);
			const body = source.shadowRoot?.querySelector<HTMLElement>('#body');
			const measure = source.shadowRoot?.querySelector<HTMLElement>('#measure');
			a.assert(body && measure, 'editor rendering surface exists');
			const rect = body.getBoundingClientRect();
			const edge = source.getBoundingClientRect().left + 2;
			const lineHeight = measure.offsetHeight;
			const marker = (y: number) => {
				const element = a.element('div');
				element.style.cssText = `position:absolute;pointer-events:none;z-index:1000;left:${window.scrollX + edge - 1}px;top:${window.scrollY + y - 1}px;width:2px;height:2px`;
				return element;
			};
			const start = marker(rect.top + lineHeight / 2);
			const end = marker(rect.top + lineHeight * 2 + lineHeight / 2);

			const selection = await a.drag(start, end);
			a.ok(selection.success, selection.message ?? selection.failureMessage);
			a.equal(clipboardSelection(target), 'one\ntwo\n');
		});

		it.testElement('ignore pointer movement after a context menu', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'ABCDE');
			const body = source.shadowRoot?.querySelector<HTMLElement>('#body');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="text"]',
			);
			a.assert(body && canvas, 'editor rendering surface exists');
			const rect = body.getBoundingClientRect();
			const width = canvas.getContext('2d')?.measureText('ABCD').width ?? 29;
			const y = rect.top + 6;

			body.dispatchEvent(
				new PointerEvent('pointerdown', {
					bubbles: true,
					button: 2,
					buttons: 2,
					clientX: rect.left + 2,
					clientY: y,
					pointerId: 1,
				}),
			);
			body.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					button: 2,
					clientX: rect.left + 2,
					clientY: y,
				}),
			);
			body.dispatchEvent(
				new PointerEvent('pointermove', {
					bubbles: true,
					buttons: 0,
					clientX: rect.left + width,
					clientY: y,
					pointerId: 1,
				}),
			);

			a.equal(
				clipboardSelection(target),
				'',
				'right click does not leave pointer selection active',
			);
		});
	});

	a.test('gutters', it => {
		it.testElement('renders line numbers and named gutter markers', async a => {
			const { source } = await createSourceEditor(a, 'one\ntwo\nthree');
			const markers = gutterMarkers();
			const marker = document.createElement('div');
			marker.textContent = '!';

			source.gutters = [lineNumbers(), markers];
			markers.setGutterMarker(1, 'ide-hints-gutter', marker);
			await a.sleep(20);

			const numbers = source.shadowRoot?.querySelectorAll(
				'[part~="line-number"]',
			);
			a.equal(numbers?.length, 3);
			a.equal(numbers?.[0]?.textContent, '1');
			a.equal(numbers?.[2]?.textContent, '3');
			a.equal(
				markers.lineInfo(1).gutterMarkers?.['ide-hints-gutter'],
				marker,
			);
			a.ok(marker.isConnected);
			a.equal(
				source.shadowRoot
					?.querySelector('[part~="line-numbers"]')
					?.getAttribute('aria-hidden'),
				'true',
			);
			await a.a11y(source);
		});

		it.testElement('updates gutter markers across edits and clearing', async a => {
			const { source } = await createSourceEditor(a, 'one\ntwo');
			const markers = gutterMarkers();
			const marker = document.createElement('div');
			source.gutters = [markers];
			markers.setGutterMarker(1, 'ide-hints-gutter', marker);

			source.edit.replace('\n', { start: 0, end: 0 });
			a.equal(markers.lineInfo(1).gutterMarkers, undefined);
			a.equal(
				markers.lineInfo(2).gutterMarkers?.['ide-hints-gutter'],
				marker,
			);

			markers.setGutterMarker(2, 'ide-hints-gutter', null);
			a.equal(markers.lineInfo(2).gutterMarkers, undefined);
			a.equal(marker.isConnected, false);
		});

		it.testElement('renders line numbers only for the virtual viewport', async a => {
			const { source } = await createSourceEditor(a, createLargeSource());
			source.gutters = [lineNumbers()];
			await a.sleep(20);

			const numbers = source.shadowRoot?.querySelectorAll(
				'[part~="line-number"]',
			);
			a.ok(Boolean(numbers?.length));
			a.ok((numbers?.length ?? LargeLineCount) < LargeLineCount);
			a.equal(
				source.shadowRoot?.querySelector('[part~="markers"]'),
				null,
			);
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
			a.equal(buffer.indexAt({ line: Number.NaN, ch: Number.NaN }), 0);
			a.equalValues(buffer.lineRange(1), { start: 5, end: 10 });
			a.equalValues(buffer.lineRange(Infinity, 0), {
				start: 0,
				end: buffer.length,
			});
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

		it.should('commit paints a complete line to the canvas', (a: TestApi) => {
			const tc = createTextCanvas(a);
			const ctx = tc.canvas.getContext('2d');
			a.assert(ctx, 'canvas context exists');

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

		it.should('measure caret and selection geometry', (a: TestApi) => {
			const tc = createTextCanvas(a);
			tc.begin(0);
			tc.renderLine(0, 'ABC');
			tc.commit(0);

			const caret = tc.getCaret({ line: 0, ch: 2 });
			a.assert(caret, 'caret measured');
			a.ok(caret.x > 0);
			const selection = tc.getSelectionRects(
				{ line: 0, ch: 1 },
				{ line: 0, ch: 3 },
			);
			a.equal(selection.length, 1);
			const [selectionRect] = selection;
			a.assert(selectionRect);
			a.ok(selectionRect.width > 0);

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

		it.should('hit test empty and wrapped visual lines', (a: TestApi) => {
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
			a.assert(caret, 'wrapped caret measured');
			a.ok(caret.y > 0, 'caret is on a wrapped visual line');
			const hit = new HitTest(wrapped).getCaretAtPosition(
				caret.x + 0.1,
				caret.y + caret.height / 2,
			);
			a.equalValues(hit?.position, { line: 0, ch: 10 });
		});

		it.should('hit test whitespace below the final line', (a: TestApi) => {
			const tc = createTextCanvas(a);
			tc.begin(0);
			tc.renderLine(0, 'ABC');
			tc.commit(0);
			const line = tc.lineCache.get(0);
			a.assert(line, 'line measured');

			const caret = new HitTest(tc).getCaretAtPosition(
				tc.canvas.offsetWidth,
				line.offsetTop + line.height + 10,
			);
			a.equalValues(caret?.position, { line: 0, ch: 3 });
		});

		it.should('paint complete wrapped and tabbed lines', (a: TestApi) => {
			const tc = createTextCanvas(a);
			const value = `start\t${'wrapped '.repeat(8)}end`;

			tc.begin(0);
			tc.renderLine(0, value);
			tc.commit(0);

			const line = tc.lineCache.get(0);
			a.assert(line, 'line measured');
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
			buffer.reset(source);

			tc.begin(50_000);
			for (let line = 50_000; line < 50_060; line++)
				tc.renderLine(line, buffer.getLine(line));
			tc.commit(0);

			const paintedLines = [...tc.lineCache].filter(
				line => [...line.lines].length,
			).length;
			tc.begin(50_060);
			for (let line = 50_060; line < 50_120; line++)
				tc.renderLine(line, buffer.getLine(line));
			tc.commit(0);
			a.equal(buffer.getLineCount(), LargeLineCount);
			a.equal(buffer.getLine(99_999), `99999\t${'value'.repeat(8)}`);
			a.ok(source.length > 4_000_000);
			a.ok(paintedLines > 0);
			a.ok(paintedLines < 60);
			a.equal([...tc.lineCache].length, 120);
		});
	});
});
