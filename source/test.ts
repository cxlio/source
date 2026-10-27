import { loadThemeDefinition } from '@cxl/ui';
import { spec, type TestApi } from '@cxl/spec';
import { Buffer } from './buffer.js';
import {
	Code,
	loadSourceHighlighter,
	Source,
	gutterMarkers,
	lineNumbers,
	foldGutter,
	type SourceHighlighter,
	type SourceToken,
	type SourceChange,
	type SourceCheckpointFeature,
		type SourceCursorFeature,
	type SourceDecorationFragment,
	type SourceTokenFeature,
} from './index.js';
import { createTextareaInput } from './input.js';
import { HitTest } from './hit-test.js';
import { SourceHighlight } from './highlight.js';
import { SourceFolding } from './fold.js';
import { textCanvas, type SourceLine } from './text.js';

function cursorCoordinates(source: Source) {
	return { line: source.cursorY.index, ch: source.cursorX.index };
}

function fullScan(highlighter: SourceHighlighter, value: string): Iterable<SourceToken> {
	return typeof highlighter === 'function' ? highlighter(value) : highlighter.resume({ source: {
		id: {}, version: 0, length: value.length, read: (start, end) => value.slice(start, end), text: () => value,
	} });
}

const LargeLineCount = 100_000;
const ModeExamples = {
	gb: "main {\n value = 'hello'\n 12 >> out\n}",
	markdown: '# Heading\n**bold** and `code`\n[label](https://example.test)\n> quote',
	basic: 'IF value = 12 THEN\n PRINT "hello"\nEND IF\nREM comment',
	shell: 'if test -n "$HOME"; then\n echo "hello" | cat\nfi\n# comment',
} as const;


const foldHighlighter: SourceHighlighter = function* (source) {
	for (const match of source.matchAll(/[{}]/g)) {
		const start = match.index;
		yield {
			source,
			start,
			end: start + 1,
			line: source.slice(0, start).split('\n').length - 1,
			kind: match[0],
			highlight: 'punctuation',
			foldStart: match[0] === '{' ? 1 : 0,
			foldEnd: match[0] === '}' ? 1 : 0,
		};
	}
};

async function createFoldEditor(a: TestApi, value: string) {
	const { source } = await createSourceEditor(a, value);
	source.highlighter = foldHighlighter;
	source.gutters = [lineNumbers(), foldGutter(source.fold)];
	await a.sleep(40);
	return source;
}

function highlightKind(token: SourceToken | undefined) {
	return token?.highlight ?? token?.kind;
}

function visibleLineNumbers(source: Source) {
	return [...(source.shadowRoot?.querySelectorAll('[part~="line-number"]') ?? [])].map(element => Number(element.textContent) - 1);
}

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
	a.test('lexical token lookup', it => {
		it.should('exposes the editor token contract instead of only a range', a => {
			const source = new Source();
			source.setText('alpha beta');
			source.cursor.go(3);
			const token = source.token.at();
			a.equalValues({ ...token, getBox: undefined, getStyle: undefined }, {
				start: 0, end: 5, value: 'alpha', type: 'unknown',
				cursor: { start: 3, end: 3, value: 'alp' },
				getBox: undefined, getStyle: undefined,
			});
			a.equal(source.token.current.value, undefined);
		});

		it.should('supports externally published current tokens and observable replay', a => {
			const source = new Source();
			source.setText('alpha');
			const values: (string | ArrayBuffer | undefined)[] = [];
			source.token.current.next(source.token.at(2));
			const subscription = source.token.current.subscribe(token => values.push(token?.value));
			a.equal(source.token.current.value?.value, 'alpha');
			source.token.current.next(undefined);
			const binary = new ArrayBuffer(2);
			source.token.current.next({ start: 0, end: 2, value: binary, type: 'unknown' });
			a.equalValues(values, ['alpha', undefined, binary]);
			subscription.unsubscribe();
		});

		it.should('returns selection text and normalized cursor context without moving the cursor', a => {
			const source = new Source();
			source.setText('alpha beta');
			source.selection.set(8, 2);
			const token = source.token.at();
			a.equal(token.type, 'selection');
			a.equal(token.value, 'pha be');
			a.equalValues(token.cursor, { start: 2, end: 2, value: '' });
			a.equalValues(source.selection.range(), { start: 2, end: 8 });
			a.equal(source.cursor.index, 2);
			source.selection.set(0);
			const end = source.token.at(Infinity);
			a.equal(end.value, 'beta');
			a.equalValues(end.cursor, { start: 10, end: 10, value: 'beta' });
			a.equal(source.token.at(NaN).value, 'alpha');
			source.setText('');
			a.equal(source.token.at().value, '');
			a.equalValues(source.token.at().cursor, { start: 0, end: 0, value: '' });
		});

		it.testElement('preserves syntax precedence and exposes editor geometry and styling callbacks', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'alpha + beta');
			source.highlighter = function* (text) {
				yield { source: text, start: 0, end: text.length, line: 0, kind: 'string' };
			};
			a.equal(source.token.at(2).type, 'unknown');
			await a.sleep(40);
			const token = source.token.at(2);
			a.equal(token.type, 'string');
			a.equal(token.value, 'alpha + beta');
			a.equalValues(token.cursor, { start: 2, end: 2, value: 'al' });
			const caret = source.geometry.caret(0);
			a.assert(caret.status === 'visible');
			a.equalValues(token.getBox?.(), {
				left: caret.bounds.x, top: caret.bounds.y,
				right: caret.bounds.x + caret.bounds.width,
				bottom: caret.bounds.y + caret.bounds.height,
			});
			const style = getComputedStyle(source);
			a.equal(token.getStyle?.(), `font:${style.font};tab-size:${style.tabSize};letter-spacing:${style.letterSpacing}`);
			source.selection.set(1, 3);
			a.equal(source.token.at().type, 'selection');
			a.equal(source.token.at().value, 'alpha + beta');
			source.selection.set(0);
			source.highlighter = function* (text) {
				yield { source: text, start: 0, end: text.length, line: 0, kind: 'custom' };
			};
			await a.sleep(40);
			a.equal(source.token.at(2).type, 'unknown');
			a.equal(source.token.at(2).value, 'alpha + beta');
			source.remove();
			a.equal(token.getBox?.(), undefined);
		});

		it.should('groups words whitespace and punctuation with left-biased boundaries', a => {
			const source = new Source();
			source.setText('alpha_$12 \t+=beta');
			const token: SourceTokenFeature = source.token;
			for (const index of [0, 1, 8, 9])
				a.equalValues(token.wordRange(index), { start: 0, end: 9 });
			for (const index of [10, 11])
				a.equalValues(token.wordRange(index), { start: 9, end: 11 });
			for (const index of [12, 13])
				a.equalValues(token.wordRange(index), { start: 11, end: 13 });
			for (const index of [14, 17, Infinity])
				a.equalValues(token.wordRange(index), { start: 13, end: 17 });
			for (const index of [-10, -Infinity, NaN, 1.9])
				a.equalValues(token.wordRange(index), { start: 0, end: 9 });
		});

		it.should('handles empty documents and never crosses logical line endings', a => {
			const source = new Source();
			for (const index of [0, -1, Infinity, NaN])
				a.equalValues(source.token.wordRange(index), { start: 0, end: 0 });
			source.setText('one \r\n\r\n \ttwo\n');
			for (const index of [4, 5])
				a.equalValues(source.token.wordRange(index), { start: 3, end: 4 });
			for (const index of [6, 7])
				a.equalValues(source.token.wordRange(index), { start: 6, end: 6 });
			for (const index of [8, 9, 10])
				a.equalValues(source.token.wordRange(index), { start: 8, end: 10 });
			a.equalValues(source.token.wordRange(13), { start: 10, end: 13 });
			a.equalValues(source.token.wordRange(Infinity), { start: 14, end: 14 });
			source.setText('\n\n');
			for (const index of [0, 1, 2])
				a.equalValues(source.token.wordRange(index), { start: index, end: index });
		});

		it.should('keeps Unicode letters marks numbers and surrogate pairs intact', a => {
			const source = new Source();
			const word = 'é中e\u0301𝒜١_$';
			const symbols = '😀💡!?';
			source.setText(`${word}${symbols} next`);
			for (let index = 0; index <= word.length; index++)
				a.equalValues(source.token.wordRange(index), { start: 0, end: word.length });
			for (let index = word.length + 1; index <= word.length + symbols.length; index++)
				a.equalValues(source.token.wordRange(index), {
					start: word.length, end: word.length + symbols.length,
				});
			source.setText('x\u00a0\u2003y');
			a.equalValues(source.token.wordRange(2), { start: 1, end: 3 });
			source.setText('\uD800!\uDC00');
			a.equalValues(source.token.wordRange(2), { start: 0, end: 3 });
		});

		it.should('defaults to the active head and leaves selections and notifications unchanged', a => {
			const source = new Source();
			source.setText('alpha beta gamma');
			source.selection.set(10, 7);
			source.selection.add({ start: 12, end: 15 });
			const before = source.selection.ranges();
			const head = source.cursor.index;
			let changes = 0;
			const subscription = source.selection.onChange.subscribe(() => changes++);
			a.equalValues(source.token.wordRange(), { start: 11, end: 16 });
			a.equalValues(source.token.wordRange(2), { start: 0, end: 5 });
			a.equalValues(source.selection.ranges(), before);
			a.equal(source.cursor.index, head);
			a.equal(changes, 0);
			subscription.unsubscribe();
		});

		it.testElement('works independently of absent pending completed and removed highlighters', async a => {
			const { source } = await createSourceEditor(a, 'alpha + beta');
			a.equal(source.getTokenAt(7), undefined);
			a.equalValues(source.token.wordRange(7), { start: 6, end: 7 });
			source.highlighter = function* (text) {
				yield { source: text, start: 0, end: text.length, line: 0, kind: 'string' };
			};
			a.equal(source.getTokenAt(7), undefined);
			a.equalValues(source.token.wordRange(7), { start: 6, end: 7 });
			await a.sleep(40);
			a.equal(source.getTokenAt(7)?.kind, 'string');
			a.equalValues(source.token.wordRange(7), { start: 6, end: 7 });
			source.cursorToken.goStart();
			a.equalValues(source.cursorToken.range(), { start: 0, end: 12 });
			source.highlighter = undefined;
			a.equal(source.getTokenAt(7), undefined);
			a.equalValues(source.token.wordRange(7), { start: 6, end: 7 });
		});

		it.should('tracks edits fragmented runs history and external text replacement', a => {
			const source = new Source();
			source.setText('alpha beta');
			source.edit.replace('Z', { start: 2, end: 3 });
			a.equalValues(source.token.wordRange(3), { start: 0, end: 5 });
			source.edit.replace('', { start: 5, end: 6 });
			a.equalValues(source.token.wordRange(6), { start: 0, end: 9 });
			source.edit.replace('done', source.token.wordRange(6));
			a.equal(source.getText(), 'done');
			a.equalValues(source.token.wordRange(Infinity), { start: 0, end: 4 });
			source.history.undo();
			a.equalValues(source.token.wordRange(6), { start: 0, end: 9 });
			source.history.undo();
			a.equalValues(source.token.wordRange(7), { start: 6, end: 10 });
			source.history.redo();
			a.equalValues(source.token.wordRange(7), { start: 0, end: 9 });
			source.setText('new\ntext');
			a.equalValues(source.token.wordRange(Infinity), { start: 4, end: 8 });
		});

		it.should('finds exact long runs across Unicode chunk edges and edited pieces', a => {
			const source = new Source();
			for (const run of ['a'.repeat(10_000), '𝒜'.repeat(600), '😀'.repeat(600), ' \t'.repeat(600)]) {
				source.setText(`!${run}!`);
				source.edit.replace(run.slice(300, 302), { start: 301, end: 303 });
				for (const index of [2, 256, 257, 301, 514, run.length + 1])
					a.equalValues(source.token.wordRange(index), {
						start: run.startsWith('😀') ? 0 : 1,
						end: run.startsWith('😀') ? run.length + 2 : run.length + 1,
					});
			}
		});

		it.should('bounds ordinary buffer lookups to local chunks on a large single line', a => {
			const reads: number[] = [];
			let characters = 0;
			class MeasuredBuffer extends Buffer {
				override getText(start?: number, end?: number) {
					reads.push(start === undefined || end === undefined ? Infinity : end - start);
					return super.getText(start, end);
				}
				override charAt(index: number) {
					characters++;
					return super.charAt(index);
				}
			}
			const buffer = new MeasuredBuffer();
			const prefix = 'word '.repeat(100_000);
			buffer.reset(`${prefix}target suffix`);
			a.equalValues(buffer.wordRange(prefix.length + 3), {
				start: prefix.length, end: prefix.length + 6,
			});
			a.ok(reads.length <= 3);
			a.ok(reads.every(length => length <= 257));
			a.ok(characters <= 12);
		});
	});

	a.test('incremental highlighting', async (it: TestApi) => {
		const examples = {
			javascript: 'const value = 1;\n', typescript: 'const value: number = 1;\n',
			json: '{"value":1},\n', html: '<div>value</div>\n', gb: 'const value = 1\n',
			markdown: '# Heading\n\n```js\nconst value = 1;\n```\n\n', basic: 'PRINT 1\n', shell: 'echo value\n',
		};
		for (const [mode, unit] of Object.entries(examples)) {
			const native = await loadSourceHighlighter(mode);
			it.assert(native && typeof native !== 'function');
			it.should(`bounds edited scanner work and matches fresh output in ${mode}`, a => {
				const frames = a.mockRequestAnimationFrame();
				const buffer = new Buffer();
				buffer.reset(unit.repeat(1500));
				let reads = 0;
				let calls = 0;
				let texts = 0;
				const counted: SourceHighlighter = {
					resume(input, checkpoint) {
						calls++;
						return native.resume({ ...input, source: { ...input.source,
							read(start, end) { reads += end - start; return input.source.read(start, end); },
							text() { texts++; return input.source.text(); },
						} }, checkpoint);
					},
					equivalent: (left, right) => native.equivalent(left, right),
					rebase: (checkpoint, source, offset, line) => native.rebase(checkpoint, source, offset, line),
				};
				let tokens: readonly SourceToken[] = [];
				let completed = false;
				const highlight = new SourceHighlight((done, value, failed) => { a.equal(failed, false); completed = done; tokens = value; });
				highlight.reset(buffer, counted);
				for (let frame = 0; frame < 256; frame++) frames.advance();
				a.equal(completed, true);
				const initial = tokens[0];
				const initialText = buffer.getText();
				calls = reads = texts = 0;
				const index = unit.length * 750 + unit.indexOf('1') + 1;
				highlight.replace(buffer, buffer.replace(index, index, 'x'), counted);
				highlight.replace(buffer, buffer.replace(index + 1, index + 1, 'y'), counted);
				a.equal(calls, 0, 'coalesced edits defer scanning');
				for (let frame = 0; frame < 256; frame++) frames.advance();
				a.ok(calls < 8, `bounded windows: ${calls}`);
				a.ok(reads < buffer.length * 0.75, `bounded native reads: ${reads}`);
				a.equal(texts, 0, 'no whole-source materialization');
				const value = buffer.getText();
				const signature = (values: readonly SourceToken[]) => JSON.stringify(values.map(token => [token.kind, token.highlight, token.start, token.end, token.line, token.foldStart, token.foldEnd, token.error?.message, token.error?.position.start, token.error?.position.end, token.error?.position.line]));
				a.equal(signature(tokens) === signature([...fullScan(native, value)]), true, 'full-scan token equivalence');
				a.equal(tokens[0]?.source, value);
				a.equal(initial?.source, initialText, 'previous token snapshot remains unchanged');
				const sample = [tokens[0], tokens[Math.floor(tokens.length / 2)], tokens.at(-1)];
				a.equal(JSON.stringify(structuredClone(sample)) === JSON.stringify(sample), true, 'serializable tokens');
				const reference = new SourceHighlight(() => undefined);
				reference.reset(buffer, native);
				for (let frame = 0; frame < 256; frame++) frames.advance();
				for (const line of [0, buffer.positionAt(index).line, buffer.positionAt(index).line + 1, 1499])
					a.equalValues(highlight.getLine(line), reference.getLine(line));
				for (const [start, end, text] of [[index, index + 2, '\n'], [0, 0, '\n'], [buffer.length - 1, buffer.length, '']] as const) {
					highlight.replace(buffer, buffer.replace(start, end, text), counted);
					for (let frame = 0; frame < 256; frame++) frames.advance();
					a.equal(signature(tokens) === signature([...fullScan(native, buffer.getText())]), true, 'edited full-scan equivalence');
				}
			});
		}
		const native = await loadSourceHighlighter('javascript');
		it.assert(native && typeof native !== 'function');
		for (const scanner of [native, function* (value: string) { yield* fullScan(native, value); }]) {
			it.should(`retains adjusted paint spans while ${typeof scanner === 'function' ? 'custom' : 'native'} highlighting is pending`, a => {
				const frames = a.mockRequestAnimationFrame();
				const buffer = new Buffer();
				buffer.reset('const value = 12;\nconst other = 3;');
				const highlight = new SourceHighlight(() => undefined);
				highlight.reset(buffer, scanner);
				for (let frame = 0; frame < 64; frame++) frames.advance();
				for (const [start, end, text] of [[15, 16, ''], [15, 15, '4'], [14, 16, '56'], [15, 15, '\n'], [15, 16, '']] as const) {
					highlight.replace(buffer, buffer.replace(start, end, text), scanner);
					const reference = new SourceHighlight(() => undefined);
					reference.reset(buffer, native);
					const pending = Array.from({ length: buffer.getLineCount() }, (_, line) => highlight.getLine(line));
					for (let frame = 0; frame < 64; frame++) frames.advance();
					for (let line = 0; line < buffer.getLineCount(); line++) {
						a.equalValues(pending[line], reference.getLine(line), 'pending paint matches the edited token positions');
						a.equalValues(highlight.getLine(line), reference.getLine(line));
					}
				}
				highlight.replace(buffer, buffer.replace(15, 15, '7'), scanner);
				highlight.replace(buffer, buffer.replace(16, 16, '8'), scanner);
				a.ok(highlight.getLine(0).some(span => span.kind === 'number' && span.start === 14 && span.end === 18));
				highlight.replace(buffer, buffer.replace(1, 2, 'x'), scanner);
				a.equal(highlight.getNavigationTokens().length, 0, 'an earlier coalesced edit invalidates the retained semantic prefix');
				a.ok(highlight.getLine(1).length > 0, 'paint cache ownership survives coalesced edits');
				for (let frame = 0; frame < 64; frame++) frames.advance();
				highlight.reset('', undefined);
				a.equal(highlight.getLine(0).length, 0);
			});
		}
		it.testElement('paints Backspace with syntax colors before parsing completes', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'const value = 12;');
			source.highlighter = native;
			source.tokenColors = { keyword: '#123456', number: '#654321' };
			await a.sleep(60);
			const context = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]')?.getContext('2d');
			a.assert(context);
			const frames = a.mockRequestAnimationFrame();
			const painted: { text: string; color: string | CanvasGradient | CanvasPattern }[] = [];
			const fillText = context.fillText;
			context.fillText = function (text, x, y, maxWidth) {
				if (!source.getTokenAt(14)) painted.push({ text, color: this.fillStyle });
				fillText.call(this, text, x, y, maxWidth);
			};
			try {
				source.selection.set(16);
				source.input.backspace();
				for (let frame = 0; frame < 4; frame++) frames.advance();
				a.equal(source.getText(), 'const value = 1;');
				a.ok(painted.some(call => call.text === 'const' && call.color === '#123456'));
				a.ok(painted.some(call => call.text === '1' && call.color === '#654321'));
			} finally { context.fillText = fillText; }
		});
		it.testElement('keeps bottom lines painted through repeated Backspace redraws', async (a: TestApi) => {
			const frame = a.element('iframe');
			frame.style.cssText = 'width:800px;height:900px;border:0';
			frame.src = '../../docs/demo/index.html';
			await a.sleep(300);
			const source = frame.contentDocument?.querySelector<Source>('c-source');
			a.assert(source);
			source.style.height = '720px';
			await a.sleep(100);
			const context = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]')?.getContext('2d');
			a.assert(context);
			const paints: boolean[] = [];
			const clearRect = context.clearRect;
			const fillText = context.fillText;
			context.clearRect = function (x, y, width, height) {
				paints.push(false);
				clearRect.call(this, x, y, width, height);
			};
			context.fillText = function (text, x, y, maxWidth) {
				if (text === 'createEditor') paints[paints.length - 1] = true;
				fillText.call(this, text, x, y, maxWidth);
			};
			try {
				source.selection.set(source.getText().indexOf('function createEditor') + 10);
				for (let edit = 0; edit < 10; edit++) {
					source.input.backspace();
					await a.sleep(40);
				}
				source.selection.set(source.getText().indexOf('\n') + 1);
				source.input.backspace();
				await a.sleep(60);
				a.equal(frame.contentDocument?.getElementById('status')?.textContent,
					`${source.getText().length.toLocaleString()} characters`);
				a.ok(paints.length > 0);
				a.equal(paints.filter(painted => !painted).length, 0, 'every redraw includes the bottom line');
			} finally { context.clearRect = clearRect; context.fillText = fillText; }
		});
		it.should('cancels stale work, invalidates lookups and retries after failures', (a: TestApi) => {
			const frames = a.mockRequestAnimationFrame();
			const buffer = new Buffer();
			buffer.reset('const value = 1;\n'.repeat(1000));
			let fail = false;
			let calls = 0;
			let failed = false;
			let tokens: readonly SourceToken[] = [];
			const custom: SourceHighlighter = {
				resume: function* (input, checkpoint) {
					calls++;
					if (fail) throw new Error('injected');
					return yield* native.resume(input, checkpoint);
				},
				equivalent: (left, right) => native.equivalent(left, right),
				rebase: (checkpoint, source, offset, line) => native.rebase(checkpoint, source, offset, line),
			};
			const highlight = new SourceHighlight((_done, value, error) => { tokens = value; failed = error; });
			highlight.reset(buffer, custom);
			highlight.reset('const final = 2;', custom);
			for (let frame = 0; frame < 64; frame++) frames.advance();
			a.equal(calls, 1);
			a.equal(tokens[0]?.source, 'const final = 2;');
			highlight.reset(buffer, custom);
			for (let frame = 0; frame < 64; frame++) frames.advance();
			highlight.replace(buffer, buffer.replace(8000, 8001, 'x'), custom);
			a.equal(highlight.getTokenAt(9000), undefined);
			a.ok(highlight.getLine(600).length > 0, 'pending paint does not expose stale semantic tokens');
			fail = true;
			for (let frame = 0; frame < 64; frame++) frames.advance();
			a.equal(failed, true);
			fail = false;
			highlight.reset(buffer, custom);
			for (let frame = 0; frame < 64; frame++) frames.advance();
			a.equal(failed, false);
			a.equal(tokens[0]?.kind, 'keyword');
			highlight.replace(buffer, buffer.replace(1, 2, 'x'), custom);
			highlight.reset('', undefined);
			for (let frame = 0; frame < 64; frame++) frames.advance();
			a.equal(tokens.length, 0);
			a.equal(highlight.getNavigationTokens().length, 0);
			let closed = 0;
			const legacy: SourceHighlighter = function* (value) {
				try { yield* fullScan(native, value); } finally { closed++; }
			};
			highlight.reset(buffer, legacy);
			frames.advance();
			highlight.reset('', undefined);
			a.equal(closed, 1);
		});
		it.should('publishes initial navigation before a large scan completes', (a: TestApi) => {
			const frames = a.mockRequestAnimationFrame();
			let done = false;
			const highlight = new SourceHighlight(complete => { done = complete; });
			highlight.reset('const value = 1;\n'.repeat(10000), native);
			frames.advance();
			a.equal(highlight.getTokenAt(0)?.kind, 'keyword');
			a.equal(done, false);
			highlight.reset('', undefined);
		});
		it.should('retains piece snapshots across merges and resets', a => {
			const buffer = new Buffer();
			buffer.reset('a\nb');
			buffer.insert(0, 'x');
			const snapshot = buffer.snapshot();
			buffer.insert(1, 'y');
			buffer.delete(2, 3);
			buffer.reset('new');
			a.equal(snapshot.getText(), 'xa\nb');
			a.equalValues(snapshot.positionAt(3), { line: 1, ch: 0 });
		});
	});
	a.test('line edits', it => {
		const snapshot = (source: Source) => ({ ranges: source.selection.ranges(), head: source.cursor.index });
		const verify = (a: TestApi, source: Source, command: 'insertLine' | 'removeLine' | 'indentMore' | 'indentLess' | 'indentAuto', expected: string) => {
			const text = source.getText();
			const before = snapshot(source);
			source.edit[command]();
			a.equal(source.getText(), expected);
			const after = snapshot(source);
			source.history.undo();
			a.equal(source.getText(), text);
			a.equalValues(snapshot(source), before);
			source.history.redo();
			a.equal(source.getText(), expected);
			a.equalValues(snapshot(source), after);
		};

		it.should('inserts below empty, single, first, middle and final lines with native newlines', a => {
			const source = new Source();
			for (const newline of ['\n', '\r\n']) {
				for (const [text, at, expected, caret] of [
					['', 0, '\n', 1],
					['one', 1, 'one\n', 4],
					[`a${newline}b${newline}c`, 0, `a${newline}${newline}b${newline}c`, 1 + newline.length],
					[`a${newline}b${newline}c`, 2 + newline.length, `a${newline}b${newline}${newline}c`, 2 + 2 * newline.length],
					[`a${newline}b`, 2 + newline.length, `a${newline}b${newline}`, 2 + 2 * newline.length],
					[`a${newline}`, 1 + newline.length, `a${newline}${newline}`, 1 + 2 * newline.length],
				] as const) {
					source.setText(text);
					source.selection.set(at);
					verify(a, source, 'insertLine', expected);
					a.equal(source.cursor.index, caret);
				}
			}
		});

		it.should('inserts once per overlapping range with configured inherited indentation', a => {
			const source = new Source();
			source.indentWithTabs = false;
			source.tabSize = 2;
			source.setText('  a\n\tb\nc');
			source.selection.set(6, 0);
			source.selection.add({ start: 4, end: 6 }, { start: 7, end: 8 });
			verify(a, source, 'insertLine', '  a\n\tb\n  \nc\n');
			a.equalValues(source.selection.ranges(), [{ start: 9, end: 9 }, { start: 9, end: 9 }, { start: 12, end: 12 }]);
			source.edit.insertLine();
			a.equal(source.getText(), '  a\n\tb\n  \n  \nc\n\n');
			source.indentWithTabs = true;
			source.setText(' \ta\nnext');
			source.selection.set(2);
			verify(a, source, 'insertLine', ' \ta\n\t\nnext');
		});

		it.should('removes whole lines including final separators without splitting CRLF', a => {
			const source = new Source();
			for (const newline of ['\n', '\r\n']) {
				for (const [text, start, end, expected] of [
					['one', 1, 1, ''],
					[`a${newline}b${newline}c`, 0, 0, `b${newline}c`],
					[`a${newline}b${newline}c`, 1 + newline.length, 1 + newline.length, `a${newline}c`],
					[`a${newline}b${newline}c`, 2 + 2 * newline.length, 3 + 2 * newline.length, `a${newline}b`],
					[`a${newline}`, 1 + newline.length, 1 + newline.length, 'a'],
					[`a${newline}b${newline}`, 1 + newline.length, 2 + 2 * newline.length, `a${newline}`],
					[`a${newline}b`, 0, 2 + newline.length, ''],
				] as const) {
					source.setText(text);
					source.selection.set(start, end);
					verify(a, source, 'removeLine', expected);
				}
			}
		});

		it.should('deduplicates overlapping and adjacent deletions and excludes terminal column zero', a => {
			const source = new Source();
			source.setText('a\nb\nc\nd\ne');
			source.selection.set(4, 0);
			source.selection.add({ start: 2, end: 4 }, { start: 4, end: 4 }, { start: 8, end: 8 });
			verify(a, source, 'removeLine', 'd');
			a.equalValues(source.selection.ranges(), [{ start: 0, end: 0 }, { start: 0, end: 0 }, { start: 0, end: 0 }, { start: 1, end: 1 }]);
			source.setText('a\nb\nc');
			source.selection.set(4, 0);
			verify(a, source, 'removeLine', 'c');
		});

		it.should('indents deduplicated logical lines and preserves reversed selection direction', a => {
			const source = new Source();
			source.indentWithTabs = false;
			source.tabSize = 2;
			source.setText('a\nb\nc');
			source.selection.set(4, 1);
			source.selection.add({ start: 0, end: 3 }, { start: 3, end: 1 });
			verify(a, source, 'indentMore', '  a\n  b\nc');
			a.equalValues(source.selection.ranges(), [{ start: 3, end: 8 }, { start: 0, end: 7 }, { start: 3, end: 7 }]);
			a.equal(source.cursor.index, 3);
			verify(a, source, 'indentLess', 'a\nb\nc');
			a.equal(source.cursor.index, 1);
		});

		it.should('preserves endpoints inside leading whitespace when adding indentation', a => {
			const source = new Source();
			source.indentWithTabs = false;
			source.tabSize = 4;
			source.setText('    abc');
			source.selection.set(3, 1);
			verify(a, source, 'indentMore', '        abc');
			a.equalValues(source.selection.range(), { start: 5, end: 7 });
			a.equal(source.cursor.index, 5);
		});

		it.testElement('edits registered mounted components with CRLF and synchronized geometry', async (a: TestApi) => {
			a.equal(customElements.get('c-source'), Source);
			const registered = document.createElement('c-source');
			a.assert(registered instanceof Source);
			const { source } = await createSourceEditor(a, 'a\r\nb\r\nc');
			source.indentWithTabs = false;
			source.tabSize = 2;
			source.selection.set(6, 0);
			verify(a, source, 'indentMore', '  a\r\n  b\r\nc');
			verify(a, source, 'indentLess', 'a\r\nb\r\nc');
			source.selection.set(3);
			source.edit.insertLine();
			a.equal(source.getText(), 'a\r\nb\r\n\r\nc');
			source.edit.removeLine();
			a.equal(source.getText(), 'a\r\nb\r\nc');
			await a.a11y(source);
			await new Promise(requestAnimationFrame);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible');
			source.setText('  a\r\n b\r\nc');
			source.selection.set(5, 7);
			verify(a, source, 'indentAuto', '  a\r\n  b\r\nc');
		});

		it.should('uses visual stops and configured whitespace for mixed prefixes', a => {
			const source = new Source();
			for (const tabs of [true, false]) {
				source.indentWithTabs = tabs;
				source.tabSize = 4;
				source.setText(' \ta\n   b\n\t c\n \t');
				source.selection.set(0, Infinity);
				verify(a, source, 'indentMore', tabs ? '\t\ta\n\t   b\n\t\t c\n\t\t' : '        a\n       b\n         c\n        ');
				source.setText(' \ta\n   b\n\t c\n \t');
				source.selection.set(0, Infinity);
				verify(a, source, 'indentLess', tabs ? 'a\nb\n\tc\n' : 'a\nb\n    c\n');
			}
		});

		it.should('normalizes auto indentation from preceding nonblank lines and clears blank lines', a => {
			const source = new Source();
			source.indentWithTabs = false;
			source.tabSize = 2;
			source.setText('\ta\n \n b\n\t\tc\n');
			source.selection.set(3, Infinity);
			verify(a, source, 'indentAuto', '\ta\n\n  b\n  c\n');
			source.selection.set(0, Infinity);
			verify(a, source, 'indentAuto', 'a\n\nb\nc\n');
			source.setText(' \n\tb');
			source.selection.set(0, Infinity);
			verify(a, source, 'indentAuto', '\nb');
		});

		it.should('handles bounded selections, invalid tab sizes and disabled input', a => {
			const source = new Source();
			source.input.disable();
			source.indentWithTabs = false;
			for (const size of [0, -1, 1.5, NaN, Infinity, 257]) {
				source.tabSize = size;
				source.setText('x');
				source.selection.set(Infinity, -100);
				verify(a, source, 'indentMore', '    x');
				verify(a, source, 'indentLess', 'x');
			}
			source.setText('');
			source.selection.set(NaN, Infinity);
			verify(a, source, 'indentMore', '    ');
			verify(a, source, 'indentLess', '');
		});

		it.should('keeps no-ops out of history and notifications and invalidates redo for real edits', a => {
			const source = new Source();
			source.setText('a');
			source.edit.insertLine();
			source.history.undo();
			let changes = 0;
			const subscription = source.changes.subscribe(() => changes++);
			source.edit.indentLess();
			source.edit.indentAuto();
			a.equal(changes, 0);
			source.history.redo();
			a.equal(source.getText(), 'a\n');
			source.history.undo();
			source.edit.indentMore();
			const value = source.getText();
			source.history.redo();
			a.equal(source.getText(), value);
			source.setText('');
			changes = 0;
			source.edit.removeLine();
			source.edit.indentLess();
			source.edit.indentAuto();
			a.equal(changes, 0);
			subscription.unsubscribe();
		});

		it.should('emits replayable changes for each modified line and keeps replacement independent', a => {
			const source = new Source();
			source.setText('a\nb');
			source.selection.set(0, 3);
			let value = source.getText();
			const changes: SourceChange[] = [];
			const subscription = source.changes.subscribe(change => {
				a.equal(value.slice(change.start, change.end), change.removed);
				value = value.slice(0, change.start) + change.text + value.slice(change.end);
				changes.push(change);
			});
			source.edit.indentMore();
			a.equal(changes.length, 2);
			a.equal(value, source.getText());
			source.history.undo();
			a.equal(value, 'a\nb');
			source.history.redo();
			a.equal(value, '\ta\n\tb');
			source.edit.replace('X', { start: 1, end: 2 });
			a.equal(source.getText(), '\tX\n\tb');
			source.history.undo();
			a.equal(source.getText(), '\ta\n\tb');
			subscription.unsubscribe();
		});
	});

	a.test('public input', it => {
		it.testElement('handles composed shadow clipboard events once', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'ab');
			const clipboard = source.shadowRoot?.querySelector('textarea');
			a.assert(clipboard);
			source.selection.set(1);
			const data = new DataTransfer();
			data.setData('text/plain', 'X');
			clipboard.dispatchEvent(new ClipboardEvent('paste', {
				bubbles: true, composed: true, cancelable: true, clipboardData: data,
			}));
			a.equal(source.getText(), 'aXb');
			source.history.undo();
			a.equal(source.getText(), 'ab');
			source.history.redo();
			source.selection.set(1, 2);
			clipboard.dispatchEvent(new ClipboardEvent('cut', {
				bubbles: true, composed: true, cancelable: true, clipboardData: data,
			}));
			a.equal(data.getData('text/plain'), 'X');
			a.equal(source.getText(), 'ab');
			source.history.undo();
			a.equal(source.getText(), 'aXb');
		});

		it.should('accepts IDE string and UTF-8 ArrayBuffer insertion interchangeably', a => {
			const source = a.element(Source);
			const input: { insert(value: string | ArrayBuffer): void } = source.input;
			source.setText('ab');
			source.selection.set(1);
			input.insert(new TextEncoder().encode('日😀').buffer);
			a.equal(source.getText(), 'a日😀b');
			source.history.undo();
			a.equal(source.getText(), 'ab');
			source.history.redo();
			a.equal(source.getText(), 'a日😀b');
			source.input.disable();
			input.insert(new TextEncoder().encode('blocked').buffer);
			a.equal(source.getText(), 'a日😀b');
			source.input.enable();
			input.insert(new Uint8Array([0xff]).buffer);
			a.equal(source.getText(), 'a日😀�b');
			input.insert(new ArrayBuffer(0));
			source.history.undo();
			a.equal(source.getText(), 'a日😀b');
		});

		it.should('gates every command without affecting programmatic edits or redo', a => {
			const source = a.element(Source);
			source.setText('abc');
			source.selection.set(1);
			source.input.insert('X');
			source.history.undo();
			let changes = 0;
			const subscription = source.changes.subscribe(() => changes++);
			for (let cycle = 0; cycle < 2; cycle++) {
				source.input.disable();
				source.input.disable();
				a.equal(source.input.enabled, false);
				source.input.insert('Z');
				source.input.backspace();
				source.input.del();
				source.input.enter();
				source.input.tab();
				a.equal(source.getText(), 'abc');
				a.equal(changes, 0);
				source.input.enable();
				source.input.enable();
				a.equal(source.input.enabled, true);
			}
			source.history.redo();
			a.equal(source.getText(), 'aXbc');
			source.input.disable();
			source.edit.replace('Y');
			a.equal(source.getText(), 'aXYbc');
			subscription.unsubscribe();
		});

		it.should('deletes code points, CRLF and selections with atomic history', a => {
			const source = a.element(Source);
			for (const value of ['', 'a', '😀', '\r\n', '日']) {
				for (const direction of ['backspace', 'del'] as const) {
					source.setText(value);
					source.selection.set(direction === 'backspace' ? value.length : 0);
					source.input[direction]();
					a.equal(source.getText(), '');
					source.history.undo();
					a.equal(source.getText(), value);
					source.history.redo();
					a.equal(source.getText(), '');
				}
			}
			source.setText('a😀b\r\nc');
			source.selection.set(3);
			source.selection.add({ start: 6, end: 6 });
			source.input.backspace();
			a.equal(source.getText(), 'abc');
			source.history.undo();
			a.equal(source.getText(), 'a😀b\r\nc');
			source.selection.set(3, 1);
			source.input.del();
			a.equal(source.getText(), 'ab\r\nc');
		});

		it.should('configures Enter and Tab separately for each normalized range', a => {
			const source = a.element(Source);
			source.setText('  a\n\tb');
			source.selection.set(3);
			source.selection.add({ start: 6, end: 6 });
			source.input.enter();
			a.equal(source.getText(), '  a\n  \n\tb\n\t');
			source.history.undo();
			a.equal(source.getText(), '  a\n\tb');
			source.history.redo();
			a.equal(source.getText(), '  a\n  \n\tb\n\t');
			source.setText('a\nbb');
			source.selection.set(1);
			source.selection.add({ start: 4, end: 4 });
			source.indentWithTabs = false;
			source.tabSize = 4;
			source.input.tab();
			a.equal(source.getText(), 'a   \nbb  ');
			source.history.undo();
			a.equal(source.getText(), 'a\nbb');
			source.input.insert('Z');
			source.history.redo();
			a.equal(source.getText(), 'aZ\nbbZ');
			for (const size of [0, -1, 1.5, NaN, Infinity, 257]) {
				source.setText('');
				source.tabSize = size;
				source.input.tab();
				a.equal(source.getText(), '    ');
			}
			source.setText('');
			source.indentWithTabs = true;
			source.input.tab();
			a.equal(source.getText(), '\t');
		});

		it.should('keeps no-op commands out of changes and history', a => {
			const source = a.element(Source);
			source.setText('a');
			source.selection.set(1);
			source.input.insert('b');
			source.history.undo();
			let changes = 0;
			const subscription = source.changes.subscribe(() => changes++);
			source.input.insert('');
			source.input.del();
			source.selection.set(0);
			source.input.backspace();
			source.selection.set(0, 1);
			source.input.insert('a');
			a.equal(changes, 0);
			source.history.redo();
			a.equal(source.getText(), 'ab');
			subscription.unsubscribe();
		});

		for (const backend of ['edit-context', 'textarea'] as const) {
			it.testElement(`gates and resynchronizes native ${backend} input across reconnects`, async (a: TestApi) => {
				const descriptor = Object.getOwnPropertyDescriptor(window, 'EditContext');
				if (backend === 'textarea') Object.defineProperty(window, 'EditContext', { configurable: true, value: undefined });
				try {
					const { source, target } = await createSourceEditor(a, 'ab');
					source.selection.set(1);
					const update = (text: string) => {
						if (source.editContext) source.editContext.dispatchEvent(new TextUpdateEvent('textupdate', {
							text, updateRangeStart: 1, updateRangeEnd: 1,
							selectionStart: 1 + text.length, selectionEnd: 1 + text.length,
						}));
						else {
							const textarea = source.shadowRoot?.querySelector('textarea');
							a.assert(textarea);
							textarea.value = `a${text}b`;
							textarea.setSelectionRange(1 + text.length, 1 + text.length);
							textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true, data: text }));
						}
					};
					source.input.disable();
					a.equal(target.getAttribute('aria-readonly'), 'true');
					await a.a11y(source);
					update('日');
					update('日本');
					a.equal(source.getText(), 'ab');
					source.selection.set(0, 2);
					a.equal(clipboardSelection(target), 'ab');
					a.equal(clipboardSelection(target, 'cut'), 'ab');
					const clipboard = new DataTransfer();
					clipboard.setData('text/plain', 'X');
					target.dispatchEvent(new ClipboardEvent('paste', { cancelable: true, clipboardData: clipboard }));
					for (const key of ['Enter', 'Tab', 'Backspace', 'Delete']) target.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
					a.equal(source.getText(), 'ab');
					target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
					a.equal(source.cursor.index, 2);
					source.selection.set(1);
					source.input.enable();
					a.equal(target.getAttribute('aria-readonly'), 'false');
					update('日');
					a.equal(source.getText(), 'a日b');
					source.history.undo();
					a.equal(source.getText(), 'ab');
					for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
						for (const key of ['Backspace', 'Delete']) {
							const event = new KeyboardEvent('keydown', { key, [modifier]: true, cancelable: true });
							target.dispatchEvent(event);
							a.equal(event.defaultPrevented, false);
							a.equal(source.getText(), 'ab');
						}
					}
					source.selection.set(1);
					source.indentWithTabs = false;
					source.tabSize = 2;
					target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
					a.equal(source.getText(), 'a b');
					target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
					a.equal(source.getText(), 'a \nb');
					target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }));
					a.equal(source.getText(), 'a b');
					target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', cancelable: true }));
					a.equal(source.getText(), 'a ');
					target.dispatchEvent(new ClipboardEvent('paste', { cancelable: true, clipboardData: clipboard }));
					a.equal(source.getText(), 'a X');
					source.selection.set(0, 3);
					a.equal(clipboardSelection(target, 'cut'), 'a X');
					a.equal(source.getText(), '');
					source.setText('ab');
					const parent = source.parentElement;
					a.assert(parent);
					source.remove();
					parent.append(source);
					await a.sleep(75);
					a.equal(source.shadowRoot?.querySelectorAll('textarea').length, 1);
					source.selection.set(1);
					update('Z');
					a.equal(source.getText(), 'aZb');
					source.history.undo();
					a.equal(source.getText(), 'ab');
				} finally {
					if (descriptor) Object.defineProperty(window, 'EditContext', descriptor);
					else Reflect.deleteProperty(window, 'EditContext');
				}
			});
		}
	});

	a.test('viewport cursors', it => {
		it.testElement('uses one navigation contract with row and column scroll cursors', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'line\n'.repeat(300));
			source.style.font = '16px/20px monospace';
			await a.sleep(75);
			const cell = a.element('div');
			cell.style.cssText = 'width:1ch;height:1lh;font:16px/20px monospace';
			const { width, height } = cell.getBoundingClientRect();
			const selection = source.selection.ranges();
			source.scrollY.go(20);
			a.equal(source.scrollY.index, 20);
			a.equal(source.scrollTop, 20 * height);
			source.scrollY.next(5);
			source.scrollY.previous(2);
			a.equal(source.scrollY.index, 23);
			source.scrollY.nextPage(0.5);
			a.equal(source.scrollY.index, 23 + source.clientHeight / height / 2);
			source.scrollY.previousPage(0.5);
			a.equal(source.scrollY.index, 23);
			a.equal(source.scrollY.getVisibleFirst(), 23);
			a.equal(source.scrollY.getVisibleMiddle(), 23 + source.clientHeight / height / 2);
			a.equal(source.scrollY.getVisibleLast(), 23 + source.clientHeight / height);
			a.equalValues(source.scrollY.range(30, 10), { start: 10, end: 30 });
			for (const cursor of [source.scrollX, source.scrollY]) {
				const index = cursor.index;
				a.equalValues(cursor.position(), { start: index, end: index });
				a.equal(cursor.indexAt(index), index);
				cursor.nextLogical(5);
				cursor.previousLogical(5);
				cursor.reveal('middle');
				a.equal(cursor.index, index);
				a.equalValues(cursor.position(-Infinity), { start: 0, end: 0 });
				a.equal(cursor.indexAt(NaN), index);
			}
			source.scrollY.go(NaN);
			a.equal(source.scrollY.index, 23);
			source.scrollY.goEnd();
			a.equal(source.scrollY.index, (source.scrollHeight - source.clientHeight) / height);
			source.scrollY.nextPage();
			a.equal(source.scrollY.index, (source.scrollHeight - source.clientHeight) / height);
			source.scrollY.goStart();
			source.scrollY.previous();
			a.equal(source.scrollY.index, 0);
			source.scrollX.goEnd();
			a.equal(source.scrollX.index, Math.max(0, source.scrollWidth - source.clientWidth) / width);
			source.scrollX.goStart();
			a.equal(source.scrollX.getVisibleFirst(), 0);
			a.equal(source.scrollX.getVisibleLast(), source.clientWidth / width);
			a.equalValues(source.selection.ranges(), selection);
		});

		it.testElement('scrolls columns and pages without moving the caret', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'line\n'.repeat(300));
			source.style.font = '16px/20px monospace';
			const gutter = a.element('div');
			gutter.style.cssText = 'width:1200px;flex-shrink:0';
			source.gutters = [{ element: gutter, render() {} }];
			await a.sleep(75);
			const cell = a.element('div');
			cell.style.cssText = 'width:1ch;height:1lh;font:16px/20px monospace';
			const width = cell.getBoundingClientRect().width;
			a.ok(source.scrollWidth > source.clientWidth);
			source.scrollX.go(4);
			a.ok(Math.abs(source.scrollLeft - 4 * width) < 1);
			source.scrollX.next(3);
			source.scrollX.previous(1);
			a.ok(Math.abs(source.scrollX.index - 6) < 1 / width);
			a.ok(Math.abs(source.scrollLeft - 6 * width) < 1);
			a.equalValues(source.scrollX.range(8, 2), { start: 2, end: 8 });
			const before = source.scrollLeft;
			source.scrollX.nextPage(0.5);
			a.ok(Math.abs(source.scrollLeft - before - source.clientWidth / 2) < 0.02);
			source.scrollX.previousPage(0.5);
			a.ok(Math.abs(source.scrollX.index - 6) < 1 / width);
			source.scrollX.reveal();
			a.ok(Math.abs(source.scrollX.index - 6) < 1 / width);
			source.scrollX.goEnd();
			a.equal(source.scrollLeft, source.scrollWidth - source.clientWidth);
			a.ok(Math.abs(source.scrollX.index - source.scrollLeft / width) < 0.001);
			source.scrollX.next();
			a.equal(source.scrollLeft, source.scrollWidth - source.clientWidth);
			source.scrollX.goStart();
			source.scrollX.previous();
			a.equal(source.scrollX.index, 0);
			source.style.transform = 'scale(1.5)';
			source.scrollX.next(4);
			a.ok(Math.abs(source.scrollLeft - 4 * width) < 1);
			a.equal(source.cursor.index, 0);
		});

		it.testElement('uses visual row units through wrapping folding native scrolling and font changes', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nhidden\nhidden\n}\n' + 'wrapped '.repeat(200));
			source.style.font = '16px/20px monospace';
			source.fold.close(0);
			await a.sleep(75);
			source.scrollY.next(3);
			a.equal(source.scrollTop, 60);
			await a.sleep(75);
			a.equal(source.cursorY.getVisibleFirst(), 4);
			a.ok((source.cursor.getVisibleFirst() ?? 0) > 21, 'scrolling passes the start of the wrapped logical line');
			a.equal(source.fold.range(0)?.closed, true);
			source.scrollTop = 75;
			a.equal(source.scrollY.index, 3.75);
			source.scrollY.next();
			a.equal(source.scrollTop, 95);
			source.style.font = '24px/32px monospace';
			source.style.transform = 'scale(1.5)';
			await a.sleep(75);
			source.scrollY.go(2);
			a.equal(source.scrollTop, 64);
			source.scrollY.nextPage(0.5);
			a.equal(source.scrollTop, 64 + source.clientHeight / 2);
			a.equal(source.cursor.index, 0);
		});

		it.testElement('keeps detached and hidden scroll cursors finite', async (a: TestApi) => {
			const source = new Source();
			source.setText('line\n'.repeat(100));
			for (const cursor of [source.scrollX, source.scrollY]) {
				cursor.go(Infinity);
				cursor.nextPage();
				cursor.previous();
				a.equal(cursor.index, 0);
				a.equalValues(cursor.range(-Infinity, Infinity), { start: 0, end: 0 });
				a.equal(cursor.getVisibleFirst(), undefined);
			}
			const { source: hidden } = await createSourceEditor(a, 'line\n'.repeat(100));
			hidden.style.display = 'none';
			for (const cursor of [hidden.scrollX, hidden.scrollY]) {
				cursor.go(5);
				cursor.nextPage();
				a.equal(cursor.index, 0);
				a.equal(cursor.getVisibleLast(), undefined);
			}
		});

		it.testElement('maps measured viewport targets into each cursor unit without reading or measuring text', async (a: TestApi) => {
			const source = a.element(Source);
			source.style.cssText = 'display:block;width:320px;height:100px;font:12px/20px monospace';
			source.mode = 'javascript';
			source.setText('value;\n'.repeat(100));
			await a.sleep(100);
			const read = Buffer.prototype.getText;
			const measure = Range.prototype.getBoundingClientRect;
			Buffer.prototype.getText = () => { throw new Error('viewport queries must not read text'); };
			Range.prototype.getBoundingClientRect = () => { throw new Error('viewport queries must not measure text'); };
			try {
				a.equal(source.cursorY.getVisibleFirst(), 0);
				a.equal(source.cursorY.getVisibleMiddle(), 2);
				a.equal(source.cursorY.getVisibleLast(), 4);
				a.equal(source.cursor.getVisibleFirst(), 0);
				a.equal(source.cursor.getVisibleMiddle(), 14);
				a.equal(source.cursor.getVisibleLast(), 34);
				a.equal(source.cursorX.getVisibleFirst(), 0);
				a.equal(source.cursorX.getVisibleLast(), 6);
				a.equal(source.cursorToken.getVisibleFirst(), 0);
				a.ok((source.cursorToken.getVisibleMiddle() ?? 0) > 0);
			} finally {
				Buffer.prototype.getText = read;
				Range.prototype.getBoundingClientRect = measure;
			}
			source.scrollY.go(0.5);
			a.equal(source.cursorY.getVisibleFirst(), undefined, 'a pending scroll invalidates text targets');
			await a.sleep(75);
			a.equal(source.cursorY.getVisibleFirst(), 1);
			a.equal(source.cursorY.getVisibleLast(), 4);
			a.equal(source.cursor.index, 0);
		});

		it.testElement('handles unavailable geometry empty documents and font invalidation', async (a: TestApi) => {
			const detached = new Source();
			for (const cursor of [detached.cursor, detached.cursorX, detached.cursorY, detached.cursorToken, detached.scrollX, detached.scrollY]) {
				a.equal(cursor.getVisibleFirst(), undefined);
				a.equal(cursor.getVisibleMiddle(), undefined);
				a.equal(cursor.getVisibleLast(), undefined);
			}
			const { source } = await createSourceEditor(a, '');
			a.equal(source.cursorY.getVisibleFirst(), 0);
			a.equal(source.cursorY.getVisibleMiddle(), 0);
			a.equal(source.cursorY.getVisibleLast(), 0);
			source.setText('line\n'.repeat(100));
			await a.sleep(75);
			const before = (source.cursorY.getVisibleLast() ?? 0) - (source.cursorY.getVisibleFirst() ?? 0);
			source.style.font = '24px/32px monospace';
			a.equal(source.cursorY.getVisibleLast(), undefined);
			await a.sleep(100);
			const after = (source.cursorY.getVisibleLast() ?? 100) - (source.cursorY.getVisibleFirst() ?? 0);
			a.ok(after < before, `larger fonts fit fewer logical lines: ${before} -> ${after}`);
			source.remove();
			a.equal(source.cursorY.getVisibleFirst(), undefined);
		});

		it.testElement('targets visible logical lines through wrapping and collapsed folds', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nhidden\nhidden\n}\n' + 'visible\n'.repeat(30));
			source.fold.close(0);
			await a.sleep(75);
			a.equal(source.cursorY.getVisibleFirst(), 0);
			a.ok((source.cursorY.getVisibleMiddle() ?? 0) >= 4);
			a.equal(source.fold.range(0)?.closed, true);
			source.setText('wrapped '.repeat(200));
			await a.sleep(75);
			source.scrollY.go(2);
			await a.sleep(75);
			a.equal(source.cursorY.getVisibleFirst(), 0);
			a.equal(source.cursorY.getVisibleLast(), 0);
			a.ok((source.cursor.getVisibleFirst() ?? 0) > 0, 'oversized lines use their measured visible screen rows');
			a.ok((source.cursor.getVisibleLast() ?? 0) > (source.cursor.getVisibleFirst() ?? 0));
		});

		it.testElement('public navigation leaves the viewport unchanged', async a => {
			const { source } = await createSourceEditor(a, 'value\n'.repeat(300));
			source.cursorY.go(150);
			await a.sleep(100);
			a.equal(source.cursorY.index, 150);
			a.equal(source.scrollY.index, 0);
		});

		it.testElement('reveals unrendered rows at the nearest viewport edge by default', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'value\n'.repeat(300));
			source.style.lineHeight = '50px';
			await a.sleep(75);
			for (const line of [150, 25]) {
				source.cursorY.go(line);
				source.cursor.reveal();
				await a.sleep(150);
				const caret = source.geometry.caret(source.cursor.index);
				a.assert(caret.status === 'visible');
				const top = caret.bounds.y - source.getBoundingClientRect().y;
				a.ok(line === 150 ? top >= source.clientHeight - 50 : top < 50, 'reveals at the nearest edge');
				const scroll = source.scrollTop;
				source.cursor.reveal();
				await a.sleep(75);
				a.equal(source.scrollTop, scroll, 'visible cursors do not scroll');
			}
		});

		it.testElement('supports explicit reveal alignment and suppresses automatic revealing', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'value\n'.repeat(300));
			source.cursorY.go(150);
			await a.sleep(75);
			a.equal(source.scrollY.index, 0);
			a.equal(source.cursorY.index, 150);
			for (const reveal of ['start', 'middle', 'end'] as const) {
				source.cursorY.go(150);
				source.cursor.reveal(reveal);
				await a.sleep(150);
				const caret = source.geometry.caret(source.cursor.index);
				a.assert(caret.status === 'visible');
				const top = caret.bounds.y - source.getBoundingClientRect().y;
				const expected = reveal === 'start' ? 0 : (source.clientHeight - caret.bounds.height) * (reveal === 'middle' ? 0.5 : 1);
				a.ok(Math.abs(top - expected) < 2, `${reveal} alignment is measured`);
			}
			source.cursorY.go(200);
			source.cursor.reveal('middle');
			source.cursorY.go(25);
			source.cursor.reveal('middle');
			await a.sleep(150);
			a.equal(source.cursorY.index, 25);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible');
			const scroll = source.scrollY.index;
			source.cursorX.go(2);
			source.cursor.reveal();
			await a.sleep(75);
			a.equal(source.scrollY.index, scroll, 'horizontal alignment does not realign the vertical viewport');
		});

		it.testElement('scrolling never relocates the cursor or changes history', async a => {
			const { source } = await createSourceEditor(a, 'value\n'.repeat(300));
			source.scrollY.nextPage();
			await a.sleep(100);
			a.equal(source.cursor.index, 0);
			source.history.undo();
			a.equal(source.getText(), 'value\n'.repeat(300));
		});

		it.testElement('detached cursor methods are safe and reveal does not move or focus the cursor', async a => {
			const detached = new Source();
			detached.setText('longer\nx\nlongest');
			detached.cursor.go(5);
			detached.cursorY.nextLogical();
			detached.cursor.go(7);
			for (const cursor of [detached.cursor, detached.cursorX, detached.cursorY, detached.cursorToken, detached.scrollX, detached.scrollY])
				cursor.reveal();
			detached.cursorY.previousLogical();
			a.equal(detached.cursor.index, 5);
			const { source } = await createSourceEditor(a, 'value\n'.repeat(300));
			const button = a.element('button');
			button.focus();
			source.cursorY.go(150);
			const selection = source.selection.ranges();
			source.cursor.reveal();
			a.equal(document.activeElement, button);
			await a.sleep(150);
			a.equalValues(source.selection.ranges(), selection);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible');
		});

		it.testElement('accumulates native held-key scroll bindings', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'value\n'.repeat(300));
			let repeated = false;
			const key = (event: KeyboardEvent) => {
				if (event.key !== 'j') return;
				event.preventDefault();
				event.stopImmediatePropagation();
				repeated ||= event.repeat;
				source.scrollY.nextPage(0.5);
			};
			source.addEventListener('keydown', key, true);
			try {
				target.focus();
				for (let i = 0; i < 4; i++) await editorAction(a, target, 'keyDown', 'j');
				await editorAction(a, target, 'keyUp', 'j');
				await a.sleep(100);
				a.ok(repeated, 'native repeat events reach the binding');
				a.ok(source.scrollTop > source.clientHeight);
				a.equal(source.cursor.index, 0);
				a.equal(source.getText(), 'value\n'.repeat(300));
			} finally {
				source.removeEventListener('keydown', key, true);
			}
		});

		it.testElement('can reveal after a public selection listener throws', async a => {
			const { source } = await createSourceEditor(a, 'value\n'.repeat(300));
			const subscription = source.selection.onChange.subscribe(() => { throw new Error('listener failure'); });
			a.throws(() => source.cursorY.go(150));
			subscription.unsubscribe();
			source.cursor.reveal();
			await a.sleep(150);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible');
		});

		it.testElement('new movement and scrolling cancel pending reveals', async a => {
			const { source } = await createSourceEditor(a, 'value\n'.repeat(300));
			source.cursorY.go(150);
			source.cursor.reveal('middle');
			source.cursorY.go(0);
			source.scrollY.goStart();
			await a.sleep(150);
			a.equal(source.cursor.index, 0);
			a.equal(source.scrollY.index, 0);
		});

		it.testElement('reveals a distant document offset inside one wrapped logical line', async (a: TestApi) => {
			const value = 'wrapped '.repeat(1000);
			const { source } = await createSourceEditor(a, value);
			source.cursor.go(value.length - 80);
			source.cursor.reveal('middle');
			await a.sleep(150);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible');
		});

		const figure = it.figure('viewport-cursors',
			'<div style="display:grid;gap:16px;padding:16px;background:#fff;color:#111">' +
			['wrapped', 'folded', 'variable'].map(kind => `<div><strong>${kind}</strong><c-source-viewport-${kind}></c-source-viewport-${kind}></div>`).join('') + '</div>',
			() => {
				for (const kind of ['wrapped', 'folded', 'variable']) {
					const tag = `c-source-viewport-${kind}`;
					if (customElements.get(tag)) continue;
					customElements.define(tag, class extends Source {
						constructor() {
							super();
							this.style.cssText = 'display:block;width:240px;height:180px;font:14px/20px monospace;background:#fff;color:#111';
							this.gutters = [lineNumbers()];
							if (kind === 'folded') {
								this.highlighter = foldHighlighter;
								this.fold.onChange.filter(() => !!this.fold.range(0)).take(1).subscribe(() => this.fold.close(0));
								this.setText('{\n hidden\n hidden\n}\n' + 'visible\n'.repeat(20));
							} else this.setText(kind === 'wrapped' ? 'wrapped content '.repeat(80)
								: Array.from({ length: 30 }, (_, line) => `${line + 1} ${'variable '.repeat(line % 5)}`).join('\n'));
						}
					});
				}
			});
		it.afterAll(() => figure);
	});

	a.test('geometry', it => {
		it.testElement('exposes viewport anchors and wrapped tab fragments without side effects', async (a: TestApi) => {
			const value = `a\tb ${'wrapped '.repeat(18)}\nlast`;
			const { source } = await createSourceEditor(a, value);
			const start = source.geometry.caret(0);
			const tab = source.geometry.fragments({ start: 1, end: 2 });
			const character = source.geometry.fragments({ start: 0, end: 1 });
			a.assert(start.status === 'visible');
			a.equal(start.bounds.width, 0);
			a.equal(start.bounds.x, character[0]?.x);
			a.equal(start.bounds.y, character[0]?.y);
			const mirror = a.element('div');
			mirror.style.cssText = `width:${source.clientWidth}px;font:${getComputedStyle(source).font};white-space:pre-wrap;word-break:break-word`;
			mirror.textContent = value;
			const native = document.createRange();
			a.assert(mirror.firstChild);
			native.setStart(mirror.firstChild, 0);
			native.setEnd(mirror.firstChild, 1);
			const reference = native.getBoundingClientRect();
			const editorBounds = source.getBoundingClientRect();
			const mirrorBounds = mirror.getBoundingClientRect();
			a.ok(Math.abs(start.bounds.x - editorBounds.x - reference.x + mirrorBounds.x) < 1);
			a.ok(Math.abs(start.bounds.y - editorBounds.y - reference.y + mirrorBounds.y) < 1);
			a.equal(start.bounds.height, reference.height);
			a.equal(character[0]?.width, reference.width);

			a.ok((tab[0]?.width ?? 0) > (character[0]?.width ?? 0));
			const fragments = source.geometry.fragments({ start: 0, end: value.length });
			a.ok(fragments.length > 2);
			for (const fragment of fragments) {
				const caret = source.geometry.caret(fragment.start);
				a.assert(caret.status === 'visible');
				a.equal(caret.bounds.x, fragment.x);
				a.equal(caret.bounds.y, fragment.y);
			}
			const selection = source.selection.ranges();
			const scroll = source.scrollTop;
			const originalGetText = Buffer.prototype.getText;
			const originalMeasure = Range.prototype.getBoundingClientRect;
			Buffer.prototype.getText = () => { throw new Error('geometry must not read document text'); };
			Range.prototype.getBoundingClientRect = () => { throw new Error('geometry must not measure text'); };
			try {
				for (let i = 0; i < 20; i++) {
					a.equalValues(source.geometry.fragments({ start: value.length, end: 0 }), fragments);
					a.equalValues(source.geometry.caret(0), start);
				}
			} finally {
				Buffer.prototype.getText = originalGetText;
				Range.prototype.getBoundingClientRect = originalMeasure;
			}
			a.equalValues(source.selection.ranges(), selection);
			a.equal(source.scrollTop, scroll);
		});

		it.testElement('rejects invalid and stale inputs and recovers after painting', async (a: TestApi) => {
			const source = new Source();
			source.setText('before');
			a.equal(source.geometry.caret(0).status, 'unmeasured');
			for (const index of [-1, NaN, Infinity, 0.5, 7]) {
				a.equal(source.geometry.caret(index).status, 'invalid');
				a.equalValues(source.geometry.fragments({ start: 0, end: index }), []);
			}
			a.equalValues(source.geometry.fragments({ start: 0, end: 0 }), []);
			const { source: editor } = await createSourceEditor(a, 'before');
			editor.edit.replace('after', { start: 0, end: 6 });
			a.equal(editor.geometry.caret(0).status, 'unmeasured');
			a.equalValues(editor.geometry.fragments({ start: 0, end: 5 }), []);
			await a.sleep(50);
			a.equal(editor.geometry.caret(5).status, 'visible');
			editor.remove();
			a.equal(editor.geometry.caret(0).status, 'unmeasured');
		});

		it.testElement('tracks gutters resizing fonts and page scrolling', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'hello world '.repeat(12));
			const before = source.geometry.caret(0);
			a.assert(before.status === 'visible');
			source.gutters = [lineNumbers()];
			await a.sleep(75);
			const gutter = source.geometry.caret(0);
			a.assert(gutter.status === 'visible');
			a.ok(gutter.bounds.x > before.bounds.x);
			const initial = source.geometry.fragments({ start: 0, end: 80 });
			source.style.width = '220px';
			source.style.fontSize = '18px';
			await a.sleep(75);
			const resized = source.geometry.caret(0);
			a.assert(resized.status === 'visible');
			a.ok(resized.bounds.height > gutter.bounds.height);
			source.style.fontSize = '24px';
			a.equal(source.geometry.caret(0).status, 'unmeasured');
			await a.sleep(75);
			const font = source.geometry.caret(0);
			a.assert(font.status === 'visible');
			a.ok(font.bounds.height > resized.bounds.height);

			a.ok(source.geometry.fragments({ start: 0, end: 80 }).length > initial.length);
			const top = source.getBoundingClientRect().top;
			const oldScroll = window.scrollY;
			try {
				window.scrollBy(0, 30);
				await a.sleep(30);
				const scrolled = source.geometry.caret(0);
				a.assert(scrolled.status === 'visible');
				a.ok(Math.abs(scrolled.bounds.y - font.bounds.y - (source.getBoundingClientRect().top - top)) < 1);
			} finally { window.scrollTo(0, oldScroll); }
		});

		it.testElement('limits large-document and wrapped-line queries to the viewport', async (a: TestApi) => {
			const value = `${'wrapped '.repeat(3000)}\n${'line\n'.repeat(2000)}`;
			const { source } = await createSourceEditor(a, value);
			a.equal(source.geometry.caret(value.length).status, 'offscreen');
			a.ok(source.geometry.fragments({ start: 0, end: value.length }).length < 20);
			source.scrollTop = 500;
			a.equal(source.geometry.caret(0).status, 'unmeasured');
			await a.sleep(75);
			a.equal(source.geometry.caret(0).status, 'offscreen');
			const fragments = source.geometry.fragments({ start: 0, end: value.length });
			a.ok(fragments.length > 0 && fragments.length < 20);
			const viewport = source.getBoundingClientRect();
			for (const fragment of fragments) {
				a.ok(fragment.y >= viewport.top);
				a.ok(fragment.y + fragment.height <= viewport.bottom);
			}
			source.scrollTop = source.scrollHeight;
			await a.sleep(75);
			a.equal(source.geometry.caret(value.length).status, 'visible');
		});

		it.testElement('reports folded interiors and maps visible placeholders', async (a: TestApi) => {
			const source = await createFoldEditor(a, 'prefix {\n hidden\n} suffix');
			const range = source.fold.range(0);
			a.assert(range);
			source.fold.close(0);
			a.equal(source.geometry.caret(range.end).status, 'unmeasured');
			await a.sleep(50);
			a.equal(source.geometry.caret(range.start + 1).status, 'folded');
			a.equal(source.geometry.caret(range.start).status, 'visible');
			a.equal(source.geometry.caret(range.end).status, 'visible');
			const fragments = source.geometry.fragments(range);
			a.equal(fragments.length, 1);
			a.equal(fragments[0]?.start, range.start);
			a.equal(fragments[0]?.end, range.end);
			source.fold.open(0);
			await a.sleep(50);
			a.equal(source.geometry.caret(range.start + 1).status, 'visible');
		});
	});

	a.test('demo', it => {
		let figureStarted = false;
		const figure = it.figure('folding-demo',
			'<iframe title="Source folding demo" src="../../docs/demo/index.html" style="display:block;width:1200px;height:900px;border:0"></iframe>',
			node => {
				figureStarted = true;
				(node as HTMLElement).style.width = '1200px';
			},
		);
		const collapsedFigure = it.figure('folding-demo-collapsed',
			'<iframe title="Collapsed source folding demo" src="../../docs/demo/index.html" onload="setTimeout(() => this.contentDocument.querySelector(\'c-source\').fold.close(17), 40)" style="display:block;width:1200px;height:900px;border:0"></iframe>',
			node => { (node as HTMLElement).style.width = '1200px'; },
		);
		const callbackFigure = it.figure('folding-demo-callback',
			'<iframe title="Collapsed callback in source demo" src="../../docs/demo/index.html" onload="setTimeout(() => this.contentDocument.querySelector(\'c-source\').fold.close(15), 40)" style="display:block;width:1200px;height:900px;border:0"></iframe>',
			node => { (node as HTMLElement).style.width = '1200px'; },
		);
		it.afterAll(async () => { if (figureStarted) await Promise.all([figure, collapsedFigure, callbackFigure]); });
		it.testElement('indicates hidden code in the exact demo fold without editing it', async (a: TestApi) => {
			const frame = a.element('iframe');
			frame.style.cssText = 'display:block;width:1200px;height:900px;border:0';
			const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
			frame.src = '../../docs/demo/index.html';
			await loaded;
			await a.sleep(100);
			const source = frame.contentDocument?.querySelector('c-source') as Source | null;
			a.assert(source);
			const original = source.getText();
			frame.scrollIntoView({ block: 'center' });
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]');
			const context = canvas?.getContext('2d');
			a.assert(context);
			const painted: { text: string; y: number }[] = [];
			const fillText = context.fillText;
			const clearRect = context.clearRect;
			context.clearRect = function (x, y, width, height) { painted.length = 0; clearRect.call(this, x, y, width, height); };
			context.fillText = function (text, x, y, maxWidth) {
				painted.push({ text, y });
				fillText.call(this, text, x, y, maxWidth);
			};
			try {
				for (const header of ['if (activeFile)', 'source.changes.subscribe(() => {']) {
					const line = original.split('\n').findIndex(value => value.includes(header));
					const range = source.fold.range(line);
					a.assert(range);
					const from = original.lastIndexOf('\n', range.start - 1) + 1;
					const newline = original.indexOf('\n', range.end);
					const expected = original.slice(from, range.start) + '…' + original.slice(range.end, newline < 0 ? original.length : newline);
					painted.length = 0;
					source.fold.close(line);
					await a.sleep(40);
					const indicator = source.shadowRoot?.querySelector('[part="fold-placeholder"]');
					a.assert(indicator, 'collapsed demo block shows an inline indication');
					a.equal(indicator.textContent, '…');
					const bounds = indicator.getBoundingClientRect();
					const top = canvas?.getBoundingClientRect().top ?? 0;
					a.equal(painted.filter(call => call.y > bounds.top - top && call.y <= bounds.bottom - top).map(call => call.text).join(''), expected, 'demo paints exactly the selected range as an ellipsis');
					a.equal(source.getText(), original);
					source.fold.open(line);
					await a.sleep(40);
					a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]'), null);
				}
			} finally {
				context.fillText = fillText;
				context.clearRect = clearRect;
			}
		});
		it.testElement('renders the complete sample on load when it fits the viewport', async (a: TestApi) => {
			const frame = a.element('iframe');
			frame.style.cssText = 'display:block;width:1200px;height:900px;border:0';
			const loaded = new Promise<void>(resolve =>
				frame.addEventListener('load', () => resolve(), { once: true }),
			);
			frame.src = '../../docs/demo/index.html';
			await loaded;
			await a.sleep(100);
			const source = frame.contentDocument?.querySelector('c-source') as
				| (HTMLElement & Pick<Source, 'getText'>)
				| null;
			a.assert(source, 'demo editor exists');
			const lineCount = source.getText().split('\n').length;
			a.equal(lineCount, 30);
			a.equal(source.scrollTop, 0);
			a.ok(source.clientHeight >= lineCount * 21 + 24, 'sample fits without scrolling');
			const rows = source.shadowRoot?.querySelectorAll('[part~=line-number]');
			a.equal(rows?.length, lineCount, 'every document line is rendered on load');
			a.equal(rows?.[lineCount - 1]?.textContent, String(lineCount));
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]');
			a.assert(canvas, 'demo canvas exists');
			const bounds = paintedBounds(canvas);
			a.assert(bounds, 'demo sample is painted');
			a.ok(bounds.bottom >= (lineCount - 1) * 21, 'final sample line is painted on load');
		});
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
				Pick<Source, 'getText' | 'selection' | 'mode' | 'fold' | 'getTokenAt'>;
			frame.scrollIntoView({ block: 'center' });
			source.scrollIntoView({ block: 'center' });
			await a.sleep(75);
			a.equal(source.mode, 'javascript');
			a.equal(highlightKind(source.getTokenAt(0)), 'keyword');
			a.ok(source.fold.ranges.length > 1, 'sample contains nested language folds');
			const original = source.getText();
			const toggle = source.shadowRoot?.querySelector<HTMLButtonElement>('[part~=fold-toggle] button');
			a.assert(toggle, 'demo exposes fold controls');
			toggle.click();
			await a.sleep(40);
			a.equal(toggle.getAttribute('aria-expanded'), 'false');
			a.equal(source.getText(), original);
			toggle.click();
			a.equal(source.getText(), original);
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]');
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

	a.test('built-in modes', it => {
		it.should('loads named scanners and shares imports', async (a: TestApi) => {
			for (const [mode, value, kind] of [
				['javascript', 'const value = 1;', 'keyword'],
				['typescript', 'interface Value {}', 'keyword'],
				['jsx', 'const view = <Box />;', 'keyword'],
				['tsx', 'const view: unknown = <Box />;', 'keyword'],
				['html', '<main title="hello">text</main>', 'punctuation'],
				['json', '{"value": 1}', 'punctuation'],
			] as const) {
				const first = loadSourceHighlighter(mode);
				const second = loadSourceHighlighter(mode);
				a.equal(first, second);
				const scanner = await first;
				a.assert(scanner);
				a.equal(highlightKind([...fullScan(scanner, value)][0]), kind);
			}
			a.equal(await loadSourceHighlighter('text'), undefined);
			a.equal(await loadSourceHighlighter('unknown'), undefined);
			a.equal(await loadSourceHighlighter('text/javascript'), undefined);
			a.equal(await loadSourceHighlighter('cmd'), undefined);
			for (const [mode, value] of Object.entries(ModeExamples)) {
				const first = loadSourceHighlighter(mode);
				a.equal(first, loadSourceHighlighter(mode));
				const scanner = await first;
				a.assert(scanner);
				a.equal(highlightKind([...fullScan(scanner, value)][0]), mode === 'markdown' ? 'heading' : 'keyword');
			}
		});

		it.testElement('highlights JSX and TSX in both components and preserves edits and mode switching', async (a: TestApi) => {
			const code = await createCode(a, '');
			const { source } = await createSourceEditor(a, '');
			source.setAttribute('aria-label', 'JSX source');
			for (const mode of ['jsx', 'tsx']) {
				const value = mode === 'tsx' ? 'const view: unknown = <Box title="hi">\n{name as string}\n</Box>;' : 'const view = <Box title="hi">\n{name}\n</Box>;';
				for (const element of [code, source]) {
					element.setAttribute('mode', mode);
					element.setText(value);
				}
				await loadSourceHighlighter(mode);
				await a.sleep(40);
				for (const element of [code, source]) {
					a.equal(highlightKind(element.getTokenAt(value.indexOf('Box') + 1)), 'tag');
					a.equal(highlightKind(element.getTokenAt(value.indexOf('title') + 1)), 'attribute');
					a.equal(element.getText(), value);
					if (mode === 'tsx') a.equal(highlightKind(element.getTokenAt(value.indexOf('string') + 1)), 'type');
				}
				a.equal(source.fold.ranges.length, 1);
				const spans = [...(code.shadowRoot?.querySelectorAll('span') ?? [])];
				const tag = spans.find(span => span.textContent === 'Box');
				const attribute = spans.find(span => span.textContent === 'title');
				a.assert(tag && attribute);
				a.equal(getComputedStyle(tag).color, 'rgb(109, 76, 65)');
				a.equal(getComputedStyle(attribute).color, 'rgb(13, 71, 161)');
				a.equal(code.shadowRoot?.querySelector('code')?.textContent, value);
				const start = value.indexOf('name');
				source.edit.replace('42', { start, end: start + 4 });
				code.setText(source.getText());
				await a.sleep(40);
				for (const element of [code, source]) {
					a.equal(highlightKind(element.getTokenAt(start + 1)), 'number');
					element.mode = mode === 'jsx' ? 'javascript' : 'typescript';
				}
				await a.sleep(40);
				for (const element of [code, source])
					a.ok(highlightKind(element.getTokenAt(value.indexOf('Box') + 1)) !== 'tag');
			}
			code.mode = source.mode = 'tsx';
			await a.sleep(40);
			await a.a11y(code);
			await a.a11y(source);
		});

		it.should('highlights JSON values and nested fold boundaries', async (a: TestApi) => {
			const scanner = await loadSourceHighlighter('json');
			a.assert(scanner);
			const value = '{\n "items": [\n "hello", -1.5e2, true, false, null\n ]\n}';
			const tokens = [...fullScan(scanner, value)];
			a.equalValues(tokens.filter(token => ['string', 'number', 'true', 'false', 'null'].includes(token.kind)).map(highlightKind),
				['attribute', 'string', 'number', 'literal', 'literal', 'literal']);
			a.equalValues(tokens.filter(token => token.foldStart).map(token => token.kind), ['{', '[']);
			a.equalValues(tokens.filter(token => token.foldEnd).map(token => token.kind), [']', '}']);
			for (const input of [value, '', '{"items": [', '{"value": "open']) {
				let end = 0;
				for (const token of fullScan(scanner, input)) {
					a.ok(token.start >= end && token.end >= token.start && token.end <= input.length);
					a.equal(token.source, input);
					end = token.end;
				}
			}
		});

		it.testElement('highlights JSON in both components and folds nested values', async a => {
			const value = '{\n "items": [\n "hello", 1, true, null\n ]\n}';
			const code = await createCode(a, value);
			const { source } = await createSourceEditor(a, value);
			code.mode = source.mode = 'json';
			await loadSourceHighlighter('json');
			await a.sleep(40);
			for (const element of [code, source]) {
				a.equal(highlightKind(element.getTokenAt(value.indexOf('"items"'))), 'attribute');
				a.equal(highlightKind(element.getTokenAt(value.indexOf('"hello"'))), 'string');
				a.equal(highlightKind(element.getTokenAt(value.indexOf('true'))), 'literal');
			}
			a.equal(code.shadowRoot?.querySelector('code')?.textContent, value);
			a.equal(source.getText(), value);
			a.equal(source.fold.ranges.length, 2);
			source.fold.close(1);
			a.equal(source.fold.range(1)?.closed, true);
			source.fold.open(1);
			a.equal(source.fold.range(1)?.closed, false);
			code.mode = source.mode = 'text';
			await a.sleep(20);
			a.equal(code.getTokenAt(0), undefined);
			a.equal(source.getTokenAt(0), undefined);
			a.equal(source.fold.ranges.length, 0);
		});

		it.should('highlights Python tokens', async (a: TestApi) => {
			const scanner = await loadSourceHighlighter('python');
			a.assert(scanner);
			const value = 'import json\nvalue = True\nprint("hello", 42) # comment';
			const tokens = [...fullScan(scanner, value)];
			for (const [text, kind] of [['import', 'keyword'], ['True', 'literal'], ['"hello"', 'string'], ['42', 'number'], ['# comment', 'comment']] as const)
				a.equal(highlightKind(tokens.find(token => token.start === value.indexOf(text))), kind);
		});

		it.should('highlights Python heredocs and resumes shell highlighting', async (a: TestApi) => {
			const scanner = await loadSourceHighlighter('shell');
			a.assert(scanner);
			for (const delimiter of ['PY', 'PYTHON']) {
				const value = `python3 - <<'${delimiter}'\nimport json\nfrom pathlib import Path\nnew=json.load(open('dist/source/benchmark-report.json'));old=json.load(open('dist/source/baseline-benchmarks.json'))\nprint(str(new['benchmark'])[:700])\n${delimiter}\nif true; then echo 42; fi\n`;
				const tokens = [...fullScan(scanner, value)];
				a.equalValues(tokens.filter(token => highlightKind(token) === 'keyword').map(token => value.slice(token.start, token.end)),
					['import', 'from', 'import', 'if', 'then', 'fi']);
				a.equal(highlightKind(tokens.find(token => token.start === value.indexOf('700'))), 'number');
				a.equalValues(tokens.filter(token => token.kind === 'heredoc').map(token => value.slice(token.start, token.end)), [`${delimiter}\n`]);
				let end = 0;
				for (const token of tokens) {
					a.ok(token.start >= end && token.end > token.start && token.end <= value.length);
					a.equal(token.source, value);
					a.equal(token.line, value.slice(0, token.start).split('\n').length - 1);
					end = token.end;
				}
			}
		});

		it.should('reports shell token positions across lines and quoted newlines', async (a: TestApi) => {
			const scanner = await loadSourceHighlighter('shell');
			a.assert(scanner);
			const value = 'echo "one\ntwo"\n# comment\nif true; then\necho end\nfi';
			const tokens = [...fullScan(scanner, value)];
			a.equal(tokens.find(token => highlightKind(token) === 'comment')?.line, 2);
			a.equal(tokens.find(token => highlightKind(token) === 'keyword')?.line, 3);
			a.equal(tokens[tokens.length - 1]?.line, 5);
		});

		it.should('highlights embedded Markdown fence languages and preserves positions', async (a: TestApi) => {
			const scanner = await loadSourceHighlighter('markdown');
			a.assert(scanner);
			for (const [tag, body, kind] of [
				['js', 'const value = 1;', 'keyword'],
				['mjs', 'const value = 1;', 'keyword'],
				['cjs', 'const value = 1;', 'keyword'],
				['typescript', 'interface Value {}', 'keyword'],
				['ts', 'interface Value {}', 'keyword'],
				['jsx', 'const view = <Box title="hi">{name}</Box>;', 'keyword'],
				['tsx', 'const view: unknown = <Box title="hi">{name as string}</Box>;', 'keyword'],
				['json', '{"value": true}', 'punctuation'],
				['html', '<main>value</main>', 'punctuation'],
				['gb', 'main { value = 1 }', 'keyword'],
				['basic', 'IF value THEN', 'keyword'],
				['sh', 'if true; then', 'keyword'],
				['py', 'import json', 'keyword'],
				['python', 'import json', 'keyword'],
				['markdown', '# Nested', 'heading'],
			] as const) {
				for (const marker of ['```', '~~~~']) {
					const value = '# Heading\n\n  ' + marker + tag + ' extra\n' + body + '\n  ' + marker + '\n';
					const tokens = [...fullScan(scanner, value)];
					const start = value.indexOf(body);
					const embedded = tokens.find(token => token.start === start);
					a.equal(highlightKind(embedded), kind, tag);
					a.equal(embedded?.line, 3, tag);
					if (tag === 'jsx' || tag === 'tsx') {
						a.equalValues(tokens.filter(token => highlightKind(token) === 'tag').map(token => value.slice(token.start, token.end)), ['Box', 'Box']);
						a.equalValues(tokens.filter(token => highlightKind(token) === 'attribute').map(token => value.slice(token.start, token.end)), ['title']);
					}
					let end = 0;
					for (const token of tokens) {
						a.ok(token.start >= end && token.end > token.start && token.end <= value.length, tag);
						a.equal(token.source, value);
						end = token.end;
					}
				}
			}
			for (const tag of ['', 'unknown', 'text']) {
				const value = '```' + tag + '\nconst value = 1;\n```';
				a.equalValues([...fullScan(scanner, value)].map(highlightKind), ['code']);
			}
			for (const value of ['```js\nconst value = 1;', '```js\n', '```js\n   ', '```js']) {
				const tokens = [...fullScan(scanner, value)];
				a.ok(tokens.every(token => token.start >= 0 && token.end > token.start && token.end <= value.length));
				if (value.includes('const')) a.ok(tokens.some(token => highlightKind(token) === 'keyword'));
				if (value.includes('\n')) a.equal(tokens.reduce((sum, token) => sum + (token.foldStart ?? 0) - (token.foldEnd ?? 0), 0), 0);
			}
		});

		it.should('recursively highlights Markdown fences and shifts embedded errors', async (a: TestApi) => {
			const scanner = await loadSourceHighlighter('markdown');
			a.assert(scanner);
			const value = '# Heading\n\n````md\n```js\nconst value = 1;\n```\n````';
			const tokens = [...fullScan(scanner, value)];
			const keyword = tokens.find(token => highlightKind(token) === 'keyword');
			a.equal(keyword?.start, value.indexOf('const'));
			a.equal(keyword?.line, 4);
			a.equal(keyword?.source, value);
			const invalid = '# Heading\n\n```json\n{"value": ?}\n```';
			const errors = [...fullScan(scanner, invalid)].filter(token => token.error);
			a.ok(errors.length > 0);
			for (const token of errors) {
				a.equal(token.error?.position.source, invalid);
				a.equal(token.error?.position.start, token.start);
				a.equal(token.error?.position.line, token.line);
			}
		});

		it.testElement('renders embedded fences in both components and updates edited bodies', async a => {
			const value = '```js\nconst value = {\n text: "hello"\n};\n```';
			const code = await createCode(a, value);
			const { source } = await createSourceEditor(a, value);
			code.mode = source.mode = 'markdown';
			await loadSourceHighlighter('markdown');
			await a.sleep(40);
			for (const element of [code, source]) {
				a.equal(highlightKind(element.getTokenAt(value.indexOf('const') + 1)), 'keyword');
				a.equal(highlightKind(element.getTokenAt(value.indexOf('hello'))), 'string');
			}
			a.equal(source.fold.ranges.length, 2);
			a.equal(code.shadowRoot?.querySelector('code')?.textContent, value);
			const start = value.indexOf('"hello"');
			source.edit.replace('42', { start, end: start + 7 });
			code.setText(source.getText());
			await a.sleep(40);
			for (const element of [code, source])
				a.equal(highlightKind(element.getTokenAt(start + 1)), 'number');
		});

		it.should('combines Markdown blocks and inline spans without overlapping ranges', async (a: TestApi) => {
			const scanner = await loadSourceHighlighter('markdown');
			a.assert(scanner);
			const value = '# Heading\n**bold** and `code`\n[label](https://example.test)\n> quote\n\n```js\nconst value = 1;\n```\n';
			const tokens = [...fullScan(scanner, value)];
			const code = tokens.filter(token => highlightKind(token) === 'code');
			a.equal(code.length, 3);
			a.equal(value.slice(code[0]?.start, code[0]?.end), '`code`');
			a.equal(value.slice(code[1]?.start, code[1]?.end), '```js\n');
			a.equal(value.slice(code[2]?.start, code[2]?.end), '```\n');
			a.ok(tokens.some(token => highlightKind(token) === 'keyword'));
			a.equal(code[1]?.line, 5);
			const link = tokens.find(token => highlightKind(token) === 'link');
			a.assert(link);
			a.equal(link.line, 2);
			a.equal(value.slice(link.start, link.end), '[label](https://example.test)');
			let end = 0;
			for (const token of tokens) {
				a.ok(token.start >= end && token.end <= value.length && token.end > token.start);
				a.equal(token.source, value);
				end = token.end;
			}
		});

		it.should('keeps incomplete Markdown token ranges valid', async (a: TestApi) => {
			const scanner = await loadSourceHighlighter('markdown');
			a.assert(scanner);
			for (const value of ['# ', '# ###\n', 'Title\n---\n', '`', '*', '[open', '   ', '```js\nconst x =']) {
				let end = 0;
				for (const token of fullScan(scanner, value)) {
					a.ok(token.start >= end && token.end <= value.length && token.end > token.start, value);
					end = token.end;
				}
			}
		});

		it.testElement('highlights GB, Markdown, BASIC and shell in both components', async a => {
			const code = await createCode(a, '');
			const { source } = await createSourceEditor(a, '');
			for (const [mode, value] of Object.entries(ModeExamples)) {
				code.mode = source.mode = mode;
				code.setText(value);
				source.setText(value);
				await loadSourceHighlighter(mode);
				await a.sleep(40);
				const kind = mode === 'markdown' ? 'heading' : 'keyword';
				a.equal(highlightKind(code.getTokenAt(0)), kind);
				a.equal(highlightKind(source.getTokenAt(0)), kind);
				a.equal(code.shadowRoot?.querySelector('code')?.textContent, value);
				a.equal(source.getText(), value);
				source.cursorToken.next();
				a.ok(source.cursor.index > 0);
				const selection = source.selection.range();
				source.mode = 'text';
				await a.sleep(20);
				a.equal(source.getTokenAt(0), undefined);
				a.equalValues(source.selection.range(), selection);
			}
		});

		it.testElement('observes declarative mode attributes in both components', (a: TestApi) => {
			const host = a.element('div');
			host.innerHTML = '<c-code mode="javascript">const value = 1;</c-code><c-source mode="javascript">const value = 1;</c-source>';
			for (const element of host.children) {
				a.assert(element instanceof Code);
				a.equal(element.mode, 'javascript');
				element.setAttribute('mode', 'text');
				a.equal(element.mode, 'text');
			}
		});

		it.testElement('reads initial HTML content and highlights it', async (a: TestApi) => {
			const host = a.element('div');
			host.innerHTML = '<c-code>\n  const value = &quot;&lt;main&gt; &amp; text&quot;;\n</c-code>';
			const code = host.querySelector('c-code');
			a.assert(code instanceof Code);
			code.mode = 'javascript';
			await loadSourceHighlighter(code.mode);
			await a.sleep(40);
			const value = '\n  const value = "<main> & text";\n';
			a.equal(code.getText(), value);
			a.equal(code.shadowRoot?.querySelector('code')?.textContent, value);
			a.equal(highlightKind(code.getTokenAt(3)), 'keyword');
			code.textContent = 'pending';
			code.setText('explicit');
			await a.sleep(20);
			a.equal(code.getText(), 'explicit');
			a.equal(code.shadowRoot?.querySelector('code')?.textContent, 'explicit');
		});

		it.testElement('reads children mounted after connection and resumes on reconnect', async (a: TestApi) => {
			const code = a.element(Code);
			const host = code.parentElement;
			a.assert(host);
			code.innerHTML = '<span>first</span>';
			await a.sleep(20);
			a.equal(code.getText(), 'first');
			const text = code.firstChild?.firstChild;
			a.assert(text instanceof Text);
			text.data = 'second';
			await a.sleep(20);
			a.equal(code.getText(), 'second');
			code.remove();
			text.data = 'third';
			await a.sleep(20);
			a.equal(code.getText(), 'second');
			host.append(code);
			await a.sleep(20);
			a.equal(code.getText(), 'third');
			code.replaceChildren();
			await a.sleep(20);
			a.equal(code.getText(), '');
			a.equal(code.shadowRoot?.querySelector('code')?.textContent, '');
		});

		it.testElement('preserves explicit text over children and pending mutations', async (a: TestApi) => {
			const host = a.element('div');
			for (const value of ['', 'explicit']) {
				const code = new Code();
				code.textContent = 'initial';
				code.setText(value);
				host.append(code);
				await a.sleep(20);
				a.equal(code.getText(), value);
				code.textContent = 'pending';
				code.setText('latest');
				await a.sleep(20);
				a.equal(code.getText(), 'latest');
				code.remove();
				code.textContent = 'stale';
				host.append(code);
				await a.sleep(20);
				a.equal(code.getText(), 'latest');
				a.equal(code.shadowRoot?.querySelector('code')?.textContent, 'latest');
			}
		});

		it.testElement('preserves editor replacements over mounted children', async (a: TestApi) => {
			const source = a.element(Source);
			source.style.cssText = 'width:320px;height:160px;font:12px monospace';
			source.textContent = 'initial';
			await a.sleep(20);
			a.equal(source.getText(), 'initial');
			source.edit.replace('edited', { start: 0, end: 7 });
			source.textContent = 'stale';
			await a.sleep(20);
			a.equal(source.getText(), 'edited');
		});

		it.testElement('keeps a short snippet pre sized to its content', async (a: TestApi) => {
			const code = await createCode(a, 'one line');
			code.style.lineHeight = '20px';
			const pre = code.shadowRoot?.querySelector('pre');
			a.assert(pre);
			a.equal(pre.getBoundingClientRect().height, 20);
		});

		it.testElement('defaults to plain text and highlights only a selected mode', async (a: TestApi) => {
			const code = await createCode(a, 'const value: number = 12;');
			a.equal(code.mode, 'text');
			a.equal(code.getTokenAt(0), undefined);
			a.equal(code.shadowRoot?.querySelectorAll('span').length, 0);
			code.mode = 'typescript';
			await loadSourceHighlighter(code.mode);
			await a.sleep(40);
			a.equal(highlightKind(code.getTokenAt(0)), 'keyword');
			a.equal(highlightKind(code.getTokenAt(13)), 'type');
			a.ok(code.shadowRoot?.querySelectorAll('span').length);
			await a.a11y(code);
			code.mode = 'unknown';
			await a.sleep(40);
			a.equal(code.getTokenAt(0), undefined);
			a.equal(code.shadowRoot?.querySelectorAll('span').length, 0);
		});

		it.testElement('keeps the latest mode and text', async (a: TestApi) => {
			const code = await createCode(a, 'const value = 12;');
			code.mode = 'html';
			code.mode = 'javascript';
			code.setText('let value = 34;');
			await loadSourceHighlighter(code.mode);
			await a.sleep(40);
			a.equal(highlightKind(code.getTokenAt(0)), 'keyword');
			a.equal(code.getText(), 'let value = 34;');
			code.mode = 'html';
			code.setText('<main>value</main>');
			await loadSourceHighlighter(code.mode);
			await a.sleep(40);
			a.equal(highlightKind(code.getTokenAt(1)), 'tag');
			code.mode = 'text';
			await a.sleep(40);
			a.equal(code.getTokenAt(1), undefined);
		});

		it.testElement('loads preconnection modes and reconnects safely', async (a: TestApi) => {
			const code = new Code();
			code.mode = 'typescript';
			code.setText('interface Value {}');
			const host = a.element('div');
			host.append(code);
			code.remove();
			await loadSourceHighlighter(code.mode);
			code.mode = 'javascript';
			code.setText('const value = 1;');
			host.append(code);
			await loadSourceHighlighter(code.mode);
			await a.sleep(40);
			a.equal(highlightKind(code.getTokenAt(0)), 'keyword');
			a.equal(code.getText(), 'const value = 1;');
		});

		it.testElement('uses CSS theme colors and explicit HTML overrides', async (a: TestApi) => {
			const code = await createCode(a, 'const value = "hello";');
			code.style.setProperty('--cxl-source-keyword', 'rgb(11, 22, 33)');
			code.style.setProperty('--cxl-source-string', 'rgb(44, 55, 66)');
			code.mode = 'javascript';
			await loadSourceHighlighter(code.mode);
			await a.sleep(40);
			const keyword = code.shadowRoot?.querySelector('span');
			a.assert(keyword);
			a.equal(getComputedStyle(keyword).color, 'rgb(11, 22, 33)');
			code.style.setProperty('--cxl-source-keyword', 'rgb(77, 88, 99)');
			a.equal(getComputedStyle(keyword).color, 'rgb(77, 88, 99)');
			code.tokenColors = { keyword: '#010203' };
			const override = code.shadowRoot?.querySelector('span');
			a.assert(override);
			a.equal(getComputedStyle(override).color, 'rgb(1, 2, 3)');
			a.equal(
				getComputedStyle(code.shadowRoot?.querySelector('span:last-child') ?? keyword).color,
				'rgb(44, 55, 66)',
			);
		});

		it.testElement('default syntax colors meet contrast on a light surface', async (a: TestApi) => {
			const code = await createCode(a,
				'const value: number = 12; /* comment */ const match = /value/; const text = "hello"; const template = `value`; const flag = true;',
			);
			code.style.backgroundColor = '#fff';
			code.style.color = '#000';
			code.mode = 'typescript';
			await loadSourceHighlighter(code.mode);
			await a.sleep(40);
			const spans = code.shadowRoot?.querySelectorAll('span');
			a.assert(spans?.length);
			for (const span of spans) {
				const channels = getComputedStyle(span).color.match(/\d+/g)?.slice(0, 3);
				a.assert(channels?.length === 3);
				const luminance = channels.reduce((sum, channel, index) => {
					const value = Number(channel) / 255;
					const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
					return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
				}, 0);
				a.ok(1.05 / (luminance + 0.05) >= 4.5, `contrast for ${span.textContent}`);
			}
		});

		it.testElement('shares modes and theme colors with the canvas editor', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'const');
			source.setAttribute('aria-label', 'Source code');
			a.equal(source.mode, 'text');
			a.equal(source.getTokenAt(0), undefined);
			source.style.setProperty('--cxl-source-keyword', 'rgb(255, 0, 0)');
			source.mode = 'javascript';
			await loadSourceHighlighter(source.mode);
			await a.sleep(40);
			a.equal(highlightKind(source.getTokenAt(0)), 'keyword');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]');
			const context = canvas?.getContext('2d');
			a.assert(canvas && context);
			const hasColor = (r: number, g: number, b: number) => {
				const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
				return pixels.some((_, index) =>
					index % 4 === 0 && pixels[index] === r &&
					pixels[index + 1] === g && pixels[index + 2] === b &&
					(pixels[index + 3] ?? 0) > 128,
				);
			};
			a.ok(hasColor(255, 0, 0), 'default canvas color follows CSS');
			source.style.setProperty('--cxl-source-keyword', 'rgb(0, 255, 0)');
			loadThemeDefinition({ name: 'source-test' });
			await a.sleep(40);
			a.ok(hasColor(0, 255, 0), 'theme notification refreshes canvas colors');
			source.tokenColors = { keyword: 'rgb(0, 0, 255)' };
			await a.sleep(40);
			a.ok(hasColor(0, 0, 255), 'explicit token colors override CSS');
			await a.a11y(source);
		});

		const value = 'const value: number = 12;\nconst text = "hello";\n// comment\nconst match = /value/;\nconst template = `value`;\nconst flag = true;';
		for (const { name, examples, width, height, rowHeight, columns } of [
			{ name: 'syntax-highlighting', examples: { typescript: value }, width: 320, height: 296, rowHeight: 144, columns: 1 },
			{ name: 'markdown-fences', examples: { markdown: '# Embedded code\n```mjs\nconst value = 42;\n// highlighted body\n```' }, width: 648, height: 160, rowHeight: 160, columns: 2 },
			{ name: 'additional-modes', examples: ModeExamples, width: 648, height: 408, rowHeight: 96, columns: 2 },
			{ name: 'jsx-tsx-modes', examples: { jsx: 'const view = <Box title="hi">\n  {name}\n</Box>;', tsx: 'const view: unknown = <Box>\n  {name as string}\n</Box>;' }, width: 648, height: 200, rowHeight: 96, columns: 2 },
			{ name: 'incremental-highlighting', examples: { javascript: 'const value = 1;\n/* note\n * details\n */\nvalue;\n' }, width: 648, height: 160, rowHeight: 160, columns: 2 },
		]) {
			let started = false;
			const fixture = `<style>body{margin:0;display:grid;grid-template-columns:repeat(${columns},320px);gap:8px;background:#fff;color:#000}c-code,c-source{display:block;width:320px;height:${rowHeight}px;font:16px/24px monospace;color:#000}</style>
<script type="importmap">${document.querySelector('script[type="importmap"]')?.textContent}</script>
<script type="module">
import { loadSourceHighlighter } from ${JSON.stringify(new URL('./index.js', import.meta.url).href)};
const examples = ${JSON.stringify(examples)};
if (${JSON.stringify(name)} !== 'markdown-fences') await Promise.all(Object.keys(examples).map(loadSourceHighlighter));
for (const [mode, value] of Object.entries(examples)) for (const tag of ['c-code', 'c-source']) {
 const element = document.createElement(tag);
 element.setAttribute('aria-label', mode + ' source');
 element.mode = mode;
 element.setText(value);
 document.body.append(element);
}
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
if (${JSON.stringify(name)} === 'incremental-highlighting') {
 const editor = document.querySelector('c-source');
 const code = document.querySelector('c-code');
 const start = editor.getText().indexOf('1');
 editor.edit.replace('42', { start, end: start + 1 });
 code.setText(editor.getText());
 await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
 editor.fold.closeAll();
} else for (const element of document.querySelectorAll('c-source')) element.setText(element.getText());
</script>`;
			const figure = it.figure(
				name,
				`<iframe title="Syntax highlighting" style="display:block;width:${width}px;height:${height}px;border:0;pointer-events:none" srcdoc="${fixture.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe>`,
				node => {
					(node as HTMLElement).style.width = `${width}px`;
					started = true;
				},
			);
			it.afterAll(async () => {
				if (started) await figure;
			});
		}
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
			code.mode = 'javascript';
			await loadSourceHighlighter(code.mode);
			code.tokenColors = {
				identifier: '#0d47a1',
				number: '#e64a19',
			};
			await a.sleep(20);

			a.equal(code.getText(), 'alpha 12');
			a.equal(highlightKind(code.getTokenAt(7)), 'number');
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
			a.ok(Boolean(content?.textContent.includes('99999')));
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

	let blockSelectionFigureStarted = false;
	const blockSelectionFigure = a.figure(
		'block-selection',
		'<c-source-block-selection style="display:block;width:320px;height:96px;pointer-events:none;font:16px/20px monospace;color:#111;--cxl-source-selection:rgba(0,120,215,.35)"></c-source-block-selection>',
		node => {
			blockSelectionFigureStarted = true;
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
							this.cursorY.position(0).start + 1,
							this.cursorY.position(2).start + 4,
						);
					}
				},
			);
		},
	);
	a.afterAll(async () => {
		if (blockSelectionFigureStarted) await blockSelectionFigure;
	});

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
			source.mode = 'javascript';
			await loadSourceHighlighter(source.mode);
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

		it.testElement('round trips directional selection snapshots', async a => {
			const { source } = await createSourceEditor(a, 'alpha beta gamma');
			const selections = [{ anchor: 0, head: 5 }, { anchor: 15, head: 11 }] as const;
			let changes = 0;
			const subscription = source.selection.onChange.subscribe(() => changes++);

			source.selection.setSelections(selections);
			a.equalValues(source.selection.selections(), [...selections]);
			a.equalValues(source.selection.ranges(), [{ start: 0, end: 5 }, { start: 11, end: 15 }]);
			a.equal(source.cursor.index, 11);
			a.equal(changes, 1);
			const snapshot = source.selection.selections();
			source.selection.setSelections(snapshot);
			a.equal(changes, 1);
			source.selection.set(2);
			source.selection.setSelections(snapshot);
			a.equalValues(source.selection.selections(), [...selections]);
			a.equal(source.cursor.index, 11);
			a.equal(changes, 3);
			source.selection.begin();
			source.cursor.go(10);
			source.selection.end();
			a.equalValues(source.selection.selections(), [{ anchor: 0, head: 5 }, { anchor: 15, head: 10 }]);
			subscription.unsubscribe();
		});

		it.testElement('isolates selection snapshot ownership', async a => {
			const { source } = await createSourceEditor(a, 'alpha');
			const selection = { anchor: 4, head: 1 };
			const input = [selection];
			source.selection.setSelections(input);
			selection.anchor = 0;
			input.push({ anchor: 2, head: 3 });
			a.equalValues(source.selection.selections(), [{ anchor: 4, head: 1 }]);
			const snapshot = source.selection.selections();
			a.ok(snapshot[0] !== source.selection.selections()[0]);
			snapshot.pop();
			a.equalValues(source.selection.selections(), [{ anchor: 4, head: 1 }]);
			source.selection.set(0);
			a.equalValues(input, [{ anchor: 0, head: 1 }, { anchor: 2, head: 3 }]);
		});

		it.testElement('normalizes bulk selection endpoints and empty input', async a => {
			const { source } = await createSourceEditor(a, 'alpha');
			source.selection.setSelections([{ anchor: Infinity, head: -1 }, { anchor: NaN, head: 2 }]);
			a.equalValues(source.selection.selections(), [{ anchor: 5, head: 0 }, { anchor: 0, head: 2 }]);
			source.selection.setSelections([]);
			a.equalValues(source.selection.selections(), [{ anchor: 0, head: 0 }]);
			a.equal(source.cursor.index, 0);
			a.ok(!source.selection.somethingSelected());
		});

		it.testElement('resets block anchors when replacing selections during extension', async a => {
			const { source, target } = await createSourceEditor(a, 'abcd\nefgh\nijkl');
			source.selection.block(1, 8);
			source.selection.begin();
			source.selection.setSelections([{ anchor: 7, head: 8 }]);
			source.selection.end();
			target.dispatchEvent(new KeyboardEvent('keydown', {
				key: 'ArrowDown', altKey: true, shiftKey: true, cancelable: true,
			}));
			a.equalValues(source.selection.selections(), [{ anchor: 7, head: 8 }, { anchor: 12, head: 13 }]);
		});

		it.testElement('creates rectangular block selections', async a => {
			const { source } = await createSourceEditor(a, 'abcd\nx\n\nwxyz');
			const end = source.cursorY.position(3).start + 3;

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
				source.cursorY.position(0).start + 1,
				source.cursorY.position(1).start + 1,
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

		it.testElement('registers unified viewport cursors through the public Source API', async (a: TestApi) => {
			const source = a.element('c-source');
			a.assert(source instanceof Source);
			a.ok(Reflect.has(source, 'scrollX'), 'horizontal scroll cursor is available');
			a.ok(Reflect.has(source, 'scrollY'), 'vertical scroll cursor is available');
			for (const cursor of [source.cursor, source.cursorX, source.cursorY, source.cursorToken, source.scrollX, source.scrollY]) {
				a.ok(Reflect.has(cursor, 'getVisibleFirst'));
				a.ok(Reflect.has(cursor, 'getVisibleMiddle'));
				a.ok(Reflect.has(cursor, 'getVisibleLast'));
				for (const method of ['position', 'indexAt', 'reveal', 'nextLogical', 'previousLogical'])
					a.ok(Reflect.has(cursor, method), `${method} is available on every cursor`);
			}
		});

		it.testElement('maps column ranges into document offsets without moving the cursor', async a => {
			const source = a.element(Source);
			source.setText('one\nthree');
			source.cursor.go(6);
			a.equalValues(source.cursorX.range(1, 3), { start: 5, end: 7 });
			a.equalValues(source.cursorX.range(3, 1), { start: 5, end: 7 });
			a.equalValues(source.cursorX.range(-Infinity, Infinity), { start: 4, end: 9 });
			a.equalValues(source.cursorX.range(NaN), { start: 4, end: 4 });
			a.equal(source.cursor.index, 6);
		});

		it.testElement('maps display columns independently of attachment and layout', async a => {
			for (const source of [new Source(), a.element('c-source') as Source]) {
				source.setText('\t界e\u0301😀👩‍💻Ａ\t!\r\n');
				const boundaries = [[0, 0], [1, 4], [2, 6], [4, 7], [6, 9], [11, 11], [12, 13], [13, 16], [14, 17]];
				for (const [offset = 0, column = 0] of boundaries) {
					source.cursor.go(offset);
					a.equal(source.cursorX.index, column);
					a.equal(source.cursorX.indexAt(offset), column);
					a.equalValues(source.cursorX.position(), { start: offset, end: offset });
					source.cursorX.go(column);
					a.equal(source.cursor.index, offset);
				}
				for (const [column, offset] of [[2, 0], [5, 1], [8, 4], [10, 6], [NaN, 0], [-Infinity, 0], [Infinity, 14], [6.9, 2]] as const) {
					a.equalValues(source.cursorX.position(column), { start: offset, end: offset });
				}
				a.equal(source.cursorX.indexAt(3), 6);
				a.equal(source.cursorX.indexAt(5), 7);
				a.equalValues(source.cursorX.range(16, 4), { start: 1, end: 13 });
				source.cursorX.goStart();
				source.cursorX.nextPage();
				a.equal(source.cursor.index, 6);
				source.cursorX.previousPage();
				a.equal(source.cursor.index, 0);
				source.cursorX.next(4);
				a.equal(source.cursor.index, 6);
				source.cursorX.previous(2);
				a.equal(source.cursor.index, 2);
				source.tabSize = 8;
				a.equal(source.cursorX.index, 10);
				source.edit.replace('a');
				a.equal(source.cursorX.index, 11);
				source.cursorY.goEnd();
				a.equal(source.cursorX.index, 0);
				a.equalValues(source.cursorX.range(0, Infinity), { start: 17, end: 17 });
			}
		});

		it.testElement('maps every text cursor between its index and document ranges', async a => {
			const { source } = await createSourceEditor(a, 'alpha 12\nbeta');
			source.mode = 'javascript';
			await loadSourceHighlighter(source.mode);
			await a.sleep(20);
			source.cursor.go(10);
			const cases: { cursor: SourceCursorFeature; index: number; start: number; end: number }[] = [
				{ cursor: source.cursor, index: 10, start: 10, end: 10 },
				{ cursor: source.cursorX, index: 1, start: 10, end: 10 },
				{ cursor: source.cursorY, index: 1, start: 9, end: 13 },
				{ cursor: source.cursorToken, index: 2, start: 9, end: 13 },
			];
			for (const { cursor, index, start, end } of cases) {
				a.equal(cursor.index, index);
				a.equalValues(cursor.position(), { start, end });
				a.equalValues(cursor.position(index), { start, end });
				a.equal(cursor.indexAt(start), index);
				a.equal(cursor.position(Infinity).end, 13);
				a.equal(cursor.indexAt(NaN), 0);
				a.equalValues(cursor.position(NaN), cursor.position(-Infinity));
			}
			a.equal(source.cursor.index, 10);
			source.cursorToken.goStart();
			source.cursorToken.nextLogical(2);
			a.equal(source.cursor.index, 9);
			source.cursorToken.previousLogical(2);
			a.equal(source.cursor.index, 0);
		});

		it.testElement('reports viewport targets in display columns', async a => {
			const { source } = await createSourceEditor(a, '\t界e\u0301😀');
			a.equal(source.cursorX.getVisibleFirst(), 0);
			a.equal(source.cursorX.getVisibleMiddle(), 9);
			a.equal(source.cursorX.getVisibleLast(), 9);
		});

		it.testElement('counts Unicode display cells without splitting graphemes', async a => {
			const source = a.element(Source);
			for (const [value, width] of [['a\u3099', 1], ['\u0301', 0], ['\u200b', 0], ['\u200d', 0], ['\u{1d11e}', 1], ['한', 2], ['ｱ', 1], ['🇺🇸', 2], ['1️⃣', 2], ['☺️', 2], ['👨‍👩‍👧‍👦', 2]] as const) {
				source.setText(`${value}x`);
				source.cursor.go(value.length);
				a.equal(source.cursorX.index, width, value);
				source.cursorX.goStart();
				a.equal(source.cursor.index, 0);
				source.cursorX.next();
				a.equal(source.cursor.index, value.length);
				source.cursorX.previous();
				a.equal(source.cursor.index, 0);
			}
			for (const size of [0, -1, NaN, Infinity, 1.5, 257]) {
				source.tabSize = size;
				source.setText('\t!');
				source.cursor.go(1);
				a.equal(source.cursorX.index, 4);
			}
		});

		it.testElement('shares counted logical horizontal navigation across newlines', async a => {
			const source = a.element(Source);
			source.setText('a\r\nbc');
			for (const cursor of [source.cursor, source.cursorX]) {
				source.selection.set(1);
				cursor.nextLogical(2);
				a.equal(source.cursor.index, 4);
				cursor.previousLogical(2);
				a.equal(source.cursor.index, 1);
				for (const count of [0, -1, 0.5, NaN, Infinity]) {
					cursor.nextLogical(count);
					cursor.previousLogical(count);
					a.equal(source.cursor.index, 1);
				}
			}
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
			a.equalValues(source.cursor.position(), { start: 6, end: 6 });
			a.equal(source.cursor.indexAt(11), 11);

			cursor.go(Infinity);
			a.equal(cursor.index, source.getText().length);
		});

		it.testElement('navigates horizontal and line cursors', async a => {
			const { source } = await createSourceEditor(a, 'one\n\nthree');

			source.cursor.go(2);
			a.equal(source.cursorX.index, 2);
			source.cursorX.next();
			source.cursorX.next();
			a.equalValues(cursorCoordinates(source), { line: 1, ch: 0 });
			source.cursorX.previous();
			a.equalValues(cursorCoordinates(source), { line: 0, ch: 3 });
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
			a.equalValues(cursorCoordinates(source), { line: 1, ch: 0 });
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

			source.mode = 'javascript';
			await loadSourceHighlighter(source.mode);
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
			source.mode = 'text';
			await a.sleep(20);
			const index = source.cursor.index;
			tokenCursor.previousPage();
			a.equal(source.cursor.index, index);
			a.equalValues(tokenCursor.range(), { start: index, end: index });
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

		it.testElement('bounds literal highlight work after large-document edits', async a => {
			const { source } = await createSourceEditor(a, 'alpha beta\n'.repeat(100_000));
			source.search.highlight('alpha');
			const read = Buffer.prototype.getText;
			const exec = RegExp.prototype.exec;
			let fullReads = 0;
			let scanned = 0;
			let matches = 0;
			a.mock(RegExp.prototype, 'exec', function (this: RegExp, value: string) {
				if (this.source === 'alpha') matches++;
				return exec.call(this, value);
			});
			Buffer.prototype.getText = function (start, end) {
				if (start === undefined && end === undefined) fullReads++;
				const value = read.call(this, start, end);
				scanned += value.length;
				return value;
			};
			try {
				source.edit.replace('x', { start: 3, end: 3 });
				a.equal(fullReads, 0, 'no synchronous full-document snapshot');
				a.ok(scanned < 16_384, `literal scan and viewport reads are bounded: ${scanned}`);
				a.ok(matches < 100, `unaffected matches are reused: ${matches}`);
			} finally {
				Buffer.prototype.getText = read;
			}
		});

		it.testElement('coalesces regex highlight snapshots outside edits', async a => {
			const { source } = await createSourceEditor(a, 'alpha beta\n'.repeat(10_000));
			source.search.highlight(/alpha.*beta/);
			const read = Buffer.prototype.getText;
			let fullReads = 0;
			Buffer.prototype.getText = function (start, end) {
				if (start === undefined && end === undefined) fullReads++;
				return read.call(this, start, end);
			};
			try {
				source.edit.replace('x', { start: 2, end: 2 });
				source.edit.replace('y', { start: 3, end: 3 });
				a.equal(fullReads, 0, 'edits do not snapshot regex input');
				await a.sleep(30);
				a.equal(fullReads, 1, 'rapid edits share one regex scan');
			} finally {
				Buffer.prototype.getText = read;
			}
		});

		const searchCases: [string, string | RegExp, boolean?][] = [
			['Alpha alpha ALPHA\nalpha beta', 'alpha'],
			['Alpha alpha ALPHA\nalpha beta', 'alpha', true],
			['alpha\r\nbeta alpha\r\nbeta', 'ha\r\nbe'],
			['aaaaaaa aaa aaa', 'aaa'],
			['a'.repeat(9000) + '\naaa', 'aaa'],
			['😀alpha 😀alpha\n😀alpha', '😀alpha'],
			['alpha\nbeta\nalpha\nBETA', /^alpha.*\nbeta/gim],
			['alpha\nbeta alpha\nbeta', /(?<=alpha)[\s\S]*beta/],
			['alpha alpha\nbeta', /alpha/y, false],
		];
		for (const [index, [value, query, caseSensitive]] of searchCases.entries())
			it.testElement(`keeps edited search highlights equivalent to a fresh scan ${index}`, async (a: TestApi) => {
				const { source } = await createSourceEditor(a, value);
				const { source: reference } = await createSourceEditor(a, value);
				const options = { caseSensitive };
				if (query instanceof RegExp) query.lastIndex = 3;
				source.search.highlight(query, options);
				const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="decorations-behind"]');
				const expected = reference.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="decorations-behind"]');
				a.assert(canvas);
				a.assert(expected);
				let checks = 0;
				const check = async () => {
					reference.setText(source.getText());
					reference.search.highlight(query, options);
					await a.sleep(25);
					a.ok(canvas.toDataURL() === expected.toDataURL(), `incremental paint matches full scan ${checks++}`);
				};
				source.edit.replace('a', { start: 2, end: 2 });
				await check();
				source.edit.replace('x', { start: 2, end: 3 });
				await check();
				source.edit.replace('', { start: 1, end: 4 });
				await check();
				source.edit.replace('alpha\r\nbeta', { start: 0, end: 2 });
				await check();
				source.history.undo();
				await check();
				source.history.redo();
				await check();
				source.scrollTop = reference.scrollTop = source.scrollHeight;
				await check();
				source.edit.replace('', { start: 0, end: source.getText().length });
				await check();
				source.setText(value);
				await check();
			});

		it.testElement('cancels stale regex scans on clear, query change and reset', async a => {
			const { source } = await createSourceEditor(a, 'alpha beta');
			const read = source.getText.bind(source);
			let fullReads = 0;
			source.getText = (start, end) => {
				if (start === undefined && end === undefined) fullReads++;
				return read(start, end);
			};
			try {
				for (const action of [
					() => source.search.highlight(),
					() => source.search.highlight('beta'),
					() => source.setText('alpha beta'),
				]) {
					source.search.highlight(/alpha/);
					source.edit.replace('x', { start: 2, end: 2 });
					action();
					fullReads = 0;
					await a.sleep(25);
					a.equal(fullReads, 0, 'superseded regex scan does not run');
				}
			} finally {
				source.getText = read;
			}
		});

		it.testElement('rescans Unicode zero-length regex matches after coalesced edits', async a => {
			const { source } = await createSourceEditor(a, '😀a\n😀b');
			source.search.highlight(/(?=.)/gu);
			const exec = RegExp.prototype.exec;
			const positions: number[] = [];
			a.mock(RegExp.prototype, 'exec', function (this: RegExp, value: string) {
				const match = exec.call(this, value);
				if (this.source === '(?=.)' && match) positions.push(match.index);
				return match;
			});
			source.edit.replace('x', { start: 2, end: 2 });
			source.edit.replace('\n', { start: 0, end: 0 });
			a.equalValues(positions, []);
			await a.sleep(25);
			a.equalValues(positions, [1, 3, 4, 6, 8]);
		});

		it.testElement('updates literal highlights through every mode lookup', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'alpha beta\nalpha beta');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="decorations-behind"]');
			a.assert(canvas);
			const read = source.getText.bind(source);
			let fullReads = 0;
			source.getText = (start, end) => {
				if (start === undefined && end === undefined) fullReads++;
				return read(start, end);
			};
			for (const mode of ['text', 'javascript', 'typescript', 'html', 'json', 'gb', 'markdown', 'basic', 'shell']) {
				await loadSourceHighlighter(mode);
				source.mode = mode;
				await a.sleep(20);
				source.search.highlight('alpha');
				fullReads = 0;
				source.edit.replace('x', { start: 2, end: 2 });
				a.equal(fullReads, 0, `${mode} uses the incremental search path`);
				await a.sleep(20);
				const actual = canvas.toDataURL();
				source.search.highlight('alpha');
				a.ok(actual === canvas.toDataURL(), `${mode} matches a fresh scan`);
				source.history.undo();
			}
			source.getText = read;
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

		it.should('tracks exact checkpoint content through edits and history', a => {
			const source = new Source();
			const checkpoint: SourceCheckpointFeature = source.checkpoint;
			a.equal(checkpoint.dirty(), false);
			source.setText('alpha\r\n😀');
			checkpoint.mark();
			source.selection.set(1, 3);
			a.equal(checkpoint.dirty(), false);
			source.edit.replace('X', { start: 1, end: 2 });
			a.equal(checkpoint.dirty(), true);
			source.history.undo();
			a.equal(checkpoint.dirty(), false);
			source.history.redo();
			a.equal(checkpoint.dirty(), true);
			source.edit.replace('l', { start: 1, end: 2 });
			a.equal(checkpoint.dirty(), false);
			source.edit.replace('!', { start: 0, end: 0 });
			checkpoint.mark();
			source.history.undo();
			a.equal(checkpoint.dirty(), true);
			source.history.redo();
			a.equal(checkpoint.dirty(), false);
		});

		it.testElement('preserves checkpoints across setText until marked again', async a => {
			const { source } = await createSourceEditor(a, 'alpha');
			source.checkpoint.mark();
			source.setText('bravo');
			a.equal(source.checkpoint.dirty(), true);
			source.setText('alpha');
			a.equal(source.checkpoint.dirty(), false);
			source.setText('');
			a.equal(source.checkpoint.dirty(), true);
			source.checkpoint.mark();
			a.equal(source.checkpoint.dirty(), false);
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

		it.testElement('defer and coalesce highlighting snapshots', async (a: TestApi) => {
			const highlighter = await loadSourceHighlighter('javascript');
			a.assert(highlighter);
			let source = 'alpha';
			let snapshots = 0;
			const highlight = new SourceHighlight(() => undefined);
			const readSource = () => {
				snapshots++;
				return source;
			};

			highlight.reset(readSource, highlighter);
			source = 'alpha 12';
			highlight.reset(readSource, highlighter, 5, 0);
			a.equal(snapshots, 0, 'snapshot is not built in the edit path');

			await a.sleep(20);
			a.equal(snapshots, 1, 'rapid edits share the scheduled snapshot');
			a.equal(highlightKind(highlight.getTokenAt(7)), 'number');
		});

		it.testElement('exposes SDK tokenizer results publicly', async a => {
			const { source } = await createSourceEditor(a, 'alpha 12');
			source.mode = 'javascript';
			await loadSourceHighlighter(source.mode);
			source.tokenColors = {
				identifier: '#0d47a1',
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
				{ kind: 'identifier', start: 0, end: 5 },
			);
			a.equalValues(
				number && {
					kind: number.kind,
					start: number.start,
					end: number.end,
				},
				{ kind: 'number', start: 6, end: 8 },
			);

			source.mode = 'text';
			await a.sleep(20);
			a.equal(source.getTokenAt(2), undefined);
		});

		it.testElement('keeps rendering after pasting incomplete JavaScript', async a => {
			const { source, target } = await createSourceEditor(a, 'alpha\nbeta');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>(
				'canvas[part="text"]',
			);
			const pasted = new DataTransfer();
			pasted.setData('text/plain', '"pasted\nsecond');
			let error = '';
			const onError = (event: ErrorEvent) => {
				error = event.error instanceof Error ? event.error.message : event.message;
				event.preventDefault();
			};
			window.addEventListener('error', onError);
			try {
				source.mode = 'javascript';
				await loadSourceHighlighter(source.mode);
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

			a.equal(error, '', 'incomplete JavaScript does not interrupt rendering');
			a.ok(Boolean(canvas && paintedBounds(canvas)), 'text remains painted');
			a.equal(source.getText(), '"pasted\nsecondalpha\nbeta');
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
			source.search.highlight('one');
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
				source.cursorY.position(0).start,
				source.cursorY.position(1).start + 1,
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
				source.cursorY.position(80).start + 2,
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
				source.cursorY.position(0).start + 1,
				source.cursorY.position(1).start + 1,
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

		it.testElement('keeps canvas content unscaled when closing a side-by-side editor', async (a: TestApi) => {
			const row = a.element('div');
			row.style.cssText = 'display:flex;width:800px;height:160px;background:white;color:black';
			const source = document.createElement('c-source');
			const sibling = document.createElement('c-source');
			a.assert(source instanceof Source && sibling instanceof Source);
			for (const editor of [source, sibling]) {
				editor.style.cssText = 'flex:1;min-width:0;height:160px;font:16px/20px monospace';
				editor.setText('                    CONTENT\nsecond line');
				row.append(editor);
			}
			source.selection.set(20, 27);
			await a.sleep(75);
			for (const layer of ['behind-text', 'above-text'] as const)
				source.decorations.create({
					layer,
					paint: ({ context, fragments }) => {
						context.fillStyle = layer === 'behind-text' ? '#def' : '#246';
						for (const rect of fragments)
							context.fillRect(rect.x, rect.y + (layer === 'above-text' ? rect.height - 2 : 0), rect.width, layer === 'above-text' ? 2 : rect.height);
					},
				}).add({ range: { start: 28, end: 39 }, value: undefined });
			const canvases = [...(source.shadowRoot?.querySelectorAll('canvas') ?? [])];
			a.equal(canvases.length, 4, 'checks text, cursor, and both decoration layers');
			const checkScale = () => {
				for (const canvas of canvases) {
					const rect = canvas.getBoundingClientRect();
					a.ok(Math.abs(rect.width * devicePixelRatio - canvas.width) < 1, `${canvas.part.value} width is unscaled`);
					a.ok(Math.abs(rect.height * devicePixelRatio - canvas.height) < 1, `${canvas.part.value} height is unscaled`);
				}
			};
			for (let cycle = 0; cycle < 2; cycle++) {
				checkScale();
				sibling.remove();
				a.equal(source.clientWidth, 800, 'remaining editor fills the row');
				checkScale();
				if (!cycle) {
					const snapshot = document.createElement('canvas');
					snapshot.width = 800 * devicePixelRatio;
					snapshot.height = 160 * devicePixelRatio;
					const context = snapshot.getContext('2d');
					a.assert(context);
					context.scale(devicePixelRatio, devicePixelRatio);
					for (const canvas of canvases) {
						const rect = canvas.getBoundingClientRect();
						context.drawImage(canvas, 0, 0, rect.width, rect.height);
					}
					a.figure('side-by-side-close', `<img alt="Editor content immediately after closing its sibling" width="800" height="160" src="${snapshot.toDataURL()}">`, node => {
						(node as HTMLElement).style.width = '800px';
					})?.catch(error => a.ok(false, String(error)));
				}
				await a.sleep(75);
				checkScale();
				row.append(sibling);
				a.equal(source.clientWidth, 400, 'reopened editor halves the row');
				checkScale();
				await a.sleep(75);
			}
			checkScale();
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

		it.testElement('aligns empty-line carets with the text origin', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, '');
			source.style.padding = '8px 16px';
			source.gutters = [lineNumbers()];
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="cursor"]');
			a.assert(canvas);
			for (const value of ['', 'alpha\n']) {
				source.setText(value);
				await a.sleep(50);
				for (const fat of [false, true]) {
					source.fatCursor = fat;
					await editorAction(a, target, 'press', 'End');
					source.cursor.go(value.length);
					await a.sleep(20);
					const caret = source.geometry.caret(value.length);
					a.assert(caret.status === 'visible');
					const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
					a.assert(pixels);
					let left = canvas.width;
					for (let i = 3; i < pixels.length; i += 4)
						if (pixels[i]) left = Math.min(left, ((i - 3) / 4) % canvas.width);
					a.equal(left, Math.trunc(caret.bounds.x - canvas.getBoundingClientRect().x) * (window.devicePixelRatio || 1));
				}
			}
		});

		it.testElement('uses caret-color with a text color fallback', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'alpha');
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="cursor"]');
			a.assert(canvas);
			for (const [color, expected] of [
				['rgb(240, 20, 30)', '#f0141e'],
				['auto', '#010203'],
				['currentColor', '#010203'],
			] as const) {
				source.style.color = 'rgb(1, 2, 3)';
				source.style.caretColor = color;
				source.style.width = `${320 + color.length}px`;
				await a.sleep(50);
				await editorAction(a, target, 'press', 'ArrowRight');
				a.equal(canvas.getContext('2d')?.fillStyle, expected);
			}
		});

		it.testElement('keeps glyphs visible beneath multiple fat carets', async (a: TestApi) => {
			const { source, target } = await createSourceEditor(a, 'M\nM');
			source.style.color = 'black';
			source.fatCursor = true;
			const text = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]');
			const cursor = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="cursor"]');
			a.assert(text && cursor);
			for (const [color, expected] of [['black', 255], ['white', 0]] as const) {
				source.style.caretColor = color;
				source.style.width = color === 'black' ? '321px' : '320px';
				await a.sleep(50);
				await editorAction(a, target, 'press', 'Home');
				source.selection.block(0, 2);
				await a.sleep(20);
				const glyphs = text.getContext('2d')?.getImageData(0, 0, text.width, text.height).data;
				const overlay = cursor.getContext('2d')?.getImageData(0, 0, cursor.width, cursor.height).data;
				a.assert(glyphs && overlay);
				const rows = new Set<number>();
				let legible = true;
				for (let i = 0; i < glyphs.length; i += 4) {
					if (glyphs[i + 3] !== 255) continue;
					rows.add(Math.floor(i / 4 / text.width));
					if (overlay[i] !== expected || overlay[i + 3] !== 255) legible = false;
				}
				a.ok(rows.size > 1, 'checks painted glyphs on both rows');
				a.ok(legible, 'covered glyphs contrast with the block cursor');
			}
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

		for (const ready of [false, true]) for (const paint of [false, true])
			it.testElement(`preserves vertical preference with ready=${ready}, paint=${paint}`, async a => {
				const source = a.element(Source);
				source.style.cssText = 'display:block;width:600px;height:240px;font:12px monospace';
				source.setText('  one.two  three!\n  four five\n\nsix');
				if (ready) await a.sleep(75);
				source.cursor.go(15);
				source.cursorY.next();
				a.equal(source.cursor.index, 29);
				if (paint) await a.sleep(40);
				source.cursorY.previous();
				a.equal(source.cursor.index, 15, 'short-line roundtrip');
				for (let i = 0; i < 3; i++) source.cursorY.next();
				a.equal(source.cursorY.index, 3);
				for (let i = 0; i < 3; i++) source.cursorY.previous();
				a.equal(source.cursor.index, 15, 'empty-line roundtrip');
				source.cursorY.next();
				source.cursorX.previous();
				source.cursorY.previous();
				a.equal(source.cursor.index, 10, 'horizontal motion resets preference');
				source.selection.set(2);
				source.cursorY.next();
				a.equal(source.cursor.index, 20, 'explicit selection resets preference');
				source.edit.replace('!');
				await a.sleep(40);
				source.cursorY.previous();
				a.equal(source.cursor.index, 3, 'editing resets preference');
			});

		it.testElement('establishes the vertical goal at a fresh cursor destination', async a => {
			const source = a.element(Source);
			source.setText('longer\nx\nlongest');
			source.cursor.go(5);
			source.cursor.go(3);
			source.cursorY.nextLogical(2);
			a.equal(source.cursorX.index, 3);
		});

		it.testElement('preserves visual goals through cursor endpoint corrections', async a => {
			const { source } = await createSourceEditor(a, 'longer\nx\nlongest');
			source.cursor.go(5);
			source.cursorY.next();
			source.cursor.go(7);
			source.cursorY.previous();
			a.equal(source.cursor.index, 5);
		});

		for (const ready of [false, true]) for (const paint of [false, true])
			it.testElement(`preserves logical goals with ready=${ready}, paint=${paint}`, async a => {
				const source = a.element(Source);
				source.style.cssText = 'display:block;width:320px;height:160px;font:12px monospace';
				source.setText('longer\nx\n\nlongest');
				if (ready) await a.sleep(75);
				source.cursor.go(5);
				source.cursorY.nextLogical();
				a.equal(source.cursor.index, 8, 'Source keeps insertion endpoints');
				source.cursor.go(7);
				if (paint) await a.sleep(40);
				source.cursorY.previousLogical();
				a.equal(source.cursor.index, 5, 'endpoint correction preserves the original goal');
				source.cursorY.nextLogical(3);
				a.equalValues(cursorCoordinates(source), { line: 3, ch: 5 });
				source.cursorY.previousLogical(3);
				a.equal(source.cursor.index, 5, 'empty-line roundtrip');
				source.cursorY.nextLogical();
				source.cursorX.previous();
				source.cursorY.previousLogical();
				a.equal(source.cursor.index, 0, 'ordinary horizontal movement resets the goal');
			});

		it.testElement('logical movement bypasses wraps without changing visual movement', async a => {
			const { source } = await createSourceEditor(a, `${'word '.repeat(60)}\nnext`);
			const start = 5;
			source.cursor.go(start);
			source.cursorY.next();
			a.equal(source.cursorY.index, 0);
			a.ok(source.cursorX.index > start);
			source.cursor.go(start);
			source.cursorY.nextLogical();
			a.equalValues(cursorCoordinates(source), { line: 1, ch: 4 });
			source.cursorY.previousLogical();
			a.equal(source.cursor.index, start);
			a.equal(source.scrollY.index, 0);
		});

		it.testElement('logical movement respects graphemes, tabs, counts and document bounds', async a => {
			const { source } = await createSourceEditor(a, 'abcdef\n\t😀e\u0301z\nabcdef');
			for (const [goal, expected] of [[2, 1], [4, 3], [5, 5]] as const) {
				source.selection.set(goal);
				source.cursorY.nextLogical();
				a.equal(source.cursor.index - source.cursorY.range().start, expected, 'never lands within a grapheme');
				source.cursorY.nextLogical();
				a.equal(source.cursorX.index, goal);
				source.cursorY.previousLogical(2);
				a.equal(source.cursor.index, goal);
			}
			for (const count of [0, -1, 0.5, NaN, Infinity]) {
				source.cursorY.nextLogical(count);
				source.cursorY.previousLogical(count);
				a.equal(source.cursor.index, 5);
			}
			source.cursorY.previousLogical(100);
			a.equal(source.cursor.index, 5);
			source.cursorY.nextLogical(100);
			a.equalValues(cursorCoordinates(source), { line: 2, ch: 5 });
			source.cursor.go(Infinity);
			a.equal(source.cursor.index, source.getText().length);
			source.cursor.go(NaN);
			a.equal(source.cursor.index, 0);
			source.cursorY.nextLogical(2);
			a.equal(source.cursorX.index, 5);
			source.selection.set(2);
			source.cursorY.nextLogical(2);
			a.equal(source.cursorX.index, 2, 'selection resets the goal');
			source.edit.replace('!');
			source.cursorY.previousLogical(2);
			a.equal(source.cursorX.index, 3, 'editing resets the goal');
		});

		it.testElement('a thin normal-mode binding owns endpoint policy without tracking a goal', async a => {
			const { source, target } = await createSourceEditor(a, 'longer\nx\nlongest');
			const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
			const key = (event: KeyboardEvent) => {
				if (event.key !== 'j' && event.key !== 'k') return;
				event.preventDefault();
				event.stopImmediatePropagation();
				if (event.key === 'j') source.cursorY.nextLogical();
				else source.cursorY.previousLogical();
				const range = source.cursorY.range();
				if (range.end > range.start && source.cursor.index === range.end) {
					const last = graphemes.segment(source.getText(range.start, range.end)).containing(range.end - range.start - 1);
					if (last) source.cursor.go(range.start + last.index);
				}
				source.cursor.reveal();
			};
			source.addEventListener('keydown', key, true);
			try {
				source.cursor.go(5);
				await editorAction(a, target, 'press', 'j');
				a.equal(source.cursor.index, 7);
				await editorAction(a, target, 'press', 'k');
				a.equal(source.cursor.index, 5);
			} finally {
				source.removeEventListener('keydown', key, true);
			}
		});

		it.testElement('preserves vertical preference through repeated keyboard input', async a => {
			const { source, target } = await createSourceEditor(a, '  one.two  three!\n  four five\n\nsix');
			source.cursor.go(15);
			await editorAction(a, target, 'press', 'ArrowDown');
			await editorAction(a, target, 'press', 'ArrowDown');
			await editorAction(a, target, 'press', 'ArrowUp');
			await editorAction(a, target, 'press', 'ArrowUp');
			a.equal(source.cursor.index, 15);
			for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp'])
				target.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true, composed: true, cancelable: true }));
			a.equal(source.cursor.index, 15, 'rapid repeated keydown roundtrip');
		});

		for (const value of ['\talpha e\u0301 😀 omega', 'alpha\tbeta'])
			it.testElement(`preserves measured vertical preference for ${value}`, async a => {
				const { source } = await createSourceEditor(a, `${value}\nx\n\n${value}`);
				const start = value.length;
				source.cursor.go(start);
				const column = source.cursorX.index;
				const before = source.geometry.caret(start);
				for (let i = 0; i < 3; i++) source.cursorY.next();
				a.equal(source.cursorX.index, column);
				for (let i = 0; i < 3; i++) source.cursorY.previous();
				a.equal(source.cursor.index, start);
				a.equalValues(source.geometry.caret(start), before, 'caret geometry is unchanged');
			});

		it.testElement('moves the line cursor across wrapped visual rows', async a => {
			const { source } = await createSourceEditor(
				a,
				`${'wrapped '.repeat(12)}\nsecond`,
			);

			source.cursor.goStart();
			source.cursorY.next();
			const wrapped = cursorCoordinates(source);
			a.equal(wrapped.line, 0);
			a.ok(wrapped.ch > 0, 'cursor advances within the wrapped line');
			source.cursorY.previous();
			a.equal(source.cursor.index, 0);
			source.cursor.go(5);
			source.cursorY.next();
			a.equal(source.cursorY.index, 0);
			source.cursorY.previous();
			a.equal(source.cursor.index, 0, 'go preserves the existing visual goal');
			source.cursorX.go(5);
			source.cursorY.next();
			source.cursorY.previous();
			a.equal(source.cursor.index, 5);
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
				source.cursorY.position(0).start + 8,
				source.cursorY.position(1).start + 60,
			);
			await a.sleep(20);
			const bounds = paintedBounds(canvas);
			a.assert(bounds, 'block selection is painted');
			a.ok(
				bounds.bottom - bounds.top > measure.offsetHeight * 2,
				'selection spans wrapped visual rows',
			);
		});

		it.testElement('reveals distant public cursor navigation after mount and resize', async (a: TestApi) => {
			const value = Array.from({ length: 200 }, (_, line) => `line ${line + 1}`).join('\n');
			const source = a.element(Source);
			source.style.cssText = 'display:block;width:600px;height:240px;font:12px monospace';
			source.setText(value);
			await a.sleep(100);
			source.cursorY.go(149);
			source.cursorX.go(2);
			source.cursor.reveal();
			await a.sleep(100);
			a.equalValues(cursorCoordinates(source), { line: 149, ch: 2 });
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible', 'distant navigation reveals the caret');
			const caret = source.geometry.caret(source.cursor.index);
			a.assert(caret.status === 'visible');
			a.ok(caret.bounds.height >= 12, 'the caret is not clipped at the viewport edge');
			source.style.cssText = 'display:block;width:320px;height:160px;font:20px monospace';
			await a.sleep(100);
			source.cursorY.go(29);
			source.cursorX.go(3);
			source.cursor.reveal();
			await a.sleep(100);
			a.equalValues(cursorCoordinates(source), { line: 29, ch: 3 });
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible', 'reverse navigation after resize reveals the caret');
			const head = source.cursorY.range(179).start + 2;
			source.selection.set(head - 2, head);
			await a.sleep(100);
			a.equalValues(source.selection.range(), { start: head - 2, end: head });
			a.equal(source.geometry.caret(head).status, 'visible', 'selection reveals its head');
			source.edit.replace('edited');
			await a.sleep(100);
			a.equal(source.getText(head - 2, head + 4), 'edited');
			source.cursorY.go(179);
			source.cursor.reveal();
			await a.sleep(100);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible', 'navigation after editing reveals the caret');
			source.cursorY.go(19);
			source.cursorY.go(199);
			source.cursorY.go(79);
			source.cursor.reveal();
			await a.sleep(100);
			a.equal(source.cursorY.index, 79);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible', 'the latest navigation wins');
			const parent = source.parentElement;
			a.assert(parent);
			source.remove();
			parent.append(source);
			await a.sleep(100);
			source.cursorY.go(49);
			source.cursor.reveal();
			await a.sleep(100);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible', 'navigation works after remount');
		});

		it.testElement('reveals distant wrapped and folded rows with viewport bounded rendering', async (a: TestApi) => {
			const source = a.element(Source);
			let renderedLines = 0;
			source.style.cssText = 'display:block;width:200px;height:160px;padding:8px 12px;font:12px monospace';
			source.gutters = [{
				element: document.createElement('div'),
				render: ({ lines }) => { renderedLines = lines.length; },
			}];
			source.highlighter = foldHighlighter;
			source.setText(Array.from({ length: 250 }, (_, line) =>
				line === 10 ? '{' : line === 60 ? '}' : `line ${line + 1} ${'wrapped '.repeat(line % 7)}`,
			).join('\n'));
			await a.sleep(100);
			source.fold.close(10);
			await a.sleep(100);
			for (const line of [149, 229, 0, 249, 149]) {
				source.cursorY.go(line);
				source.cursorX.go(2);
				source.cursor.reveal();
				await a.sleep(100);
				a.equalValues(cursorCoordinates(source), { line, ch: 2 });
				a.equal(source.geometry.caret(source.cursor.index).status, 'visible', `line ${line + 1} is revealed`);
				a.ok(renderedLines > 0 && renderedLines < 50, 'rendering remains viewport bounded');
				a.equal(source.fold.range(10)?.closed, true);
			}
			source.cursorY.go(30);
			source.cursor.reveal();
			await a.sleep(100);
			a.equal(source.fold.range(10)?.closed, false);
			a.equal(source.geometry.caret(source.cursor.index).status, 'visible', 'navigation reveals hidden text');
			source.style.cssText = 'display:block;width:260px;height:180px;font:12px monospace';
			source.gutters = [lineNumbers()];
			source.setText(Array.from({ length: 1000 }, (_, line) => `line ${line + 1} ${'variable wrapped text '.repeat(line % 8)}`).join('\n'));
			await a.sleep(100);
			for (const line of [749, 50, 999, 0, 500, 150, 990, 100, 800, 10, 400, 700]) {
				source.cursorY.go(line);
				source.cursorX.go(2);
				source.cursor.reveal();
				await a.sleep(150);
				a.equal(source.geometry.caret(source.cursor.index).status, 'visible', `wrapped line ${line + 1} is revealed`);
			}
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
			a.ok((source.cursorY.getVisibleFirst() ?? 0) > 0, 'visible first line updates');
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

	a.test('folding', it => {
		it.testElement('maps display columns across folded spans and tab stops', async a => {
			const source = await createFoldEditor(a, '\t界{\nhidden\n}\t😀');
			source.fold.closeAll();
			await a.sleep(20);
			const end = source.getText().length;
			const close = source.getText().indexOf('}');
			a.equal(source.cursorX.indexAt(close), 8);
			a.equal(source.cursorX.indexAt(close + 1), 9);
			a.equal(source.cursorX.indexAt(close + 2), 12);
			a.equal(source.cursorX.indexAt(end), 14);
			source.cursorX.go(12);
			a.equal(source.cursor.index, close + 2);
			a.equalValues(source.cursorX.range(7, 12), { start: 3, end: close + 2 });
			source.cursorX.previous();
			a.equal(source.cursor.index, close + 1);
			source.cursorX.previous(2);
			a.equal(source.cursor.index, 3);
			source.cursorX.next();
			a.equal(source.cursor.index, close);
			a.ok(source.fold.range(0)?.closed);
			source.fold.openAll();
			a.equal(source.cursorX.indexAt(close + 2), 4);
			source.fold.closeAll();
			a.equal(source.cursorX.indexAt(close + 2), 12);
		});

		it.testElement('roundtrips column mappings through a collapsed projection', async a => {
			const source = await createFoldEditor(a, 'ab{\nhidden\n}cd\ntail');
			source.fold.closeAll();
			await a.sleep(20);
			source.cursorX.goEnd();
			const end = source.getText().indexOf('\ntail');
			a.equal(source.cursor.index, end);
			a.equalValues(source.cursorX.position(), { start: end, end });
			a.equal(source.cursorX.indexAt(end), source.cursorX.index);
			a.equalValues(source.cursorX.range(0, Infinity), { start: 0, end });
			source.cursorX.goStart();
			const column = source.cursorX.indexAt(end);
			source.cursorX.go(column);
			a.equal(source.cursor.index, end);
			a.ok(source.fold.ranges[0]?.closed);
		});

		it.testElement('keeps open fold indicators through pending edits', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'function example() {\n  const value = 12;\n}\nafter();');
			source.mode = 'javascript';
			source.gutters = [lineNumbers(), foldGutter(source.fold)];
			await a.sleep(80);
			const button = source.shadowRoot?.querySelector('[part~=fold-toggle] button');
			a.assert(button);
			for (const [removed, inserted] of [['12', '123'], ['123', '1'], ['1', '1\n  extra();'], ['1\n  extra();', '42']] as const) {
				const start = source.getText().indexOf(removed);
				source.edit.replace(inserted, { start, end: start + removed.length });
				a.ok(source.fold.range(0), 'pending parsing retains the open fold');
				await a.sleep(60);
				a.equal(source.shadowRoot?.querySelector('[part~=fold-toggle] button'), button, 'redrawing preserves the gutter button');
				a.equal(source.fold.range(0)?.end, source.getText().indexOf('}'));
			}
			const end = source.getText().indexOf('}');
			source.edit.replace('', { start: end, end: end + 1 });
			await a.sleep(60);
			a.equal(source.fold.range(0), undefined, 'parsing removes a fold whose closing token was deleted');
		});
		const foldEditFigure = it.figure('fold-indicator-edit',
			'<c-source-fold-edit style="display:block;width:320px;height:160px;font:12px monospace;background:#fff;color:#111"></c-source-fold-edit>',
			() => {
				if (customElements.get('c-source-fold-edit')) return;
				customElements.define('c-source-fold-edit', class extends Source {
					constructor() {
						super();
						this.mode = 'javascript';
						this.gutters = [lineNumbers(), foldGutter(this.fold)];
						this.setText('function example() {\n  const value = 12;\n}\nafter();');
						this.fold.onChange.filter(() => !!this.fold.range(0)).take(1).subscribe(() => {
							const start = this.getText().indexOf('12');
							this.edit.replace('42', { start, end: start + 2 });
						});
					}
				});
			});
		it.afterAll(() => foldEditFigure);
		it.testElement('does not fold parentheses without fold metadata', async (a: TestApi) => {
			for (const value of ['invoke(\n  hidden\n);', 'invoke(\n  hidden']) {
				const { source } = await createSourceEditor(a, value);
				source.mode = 'javascript';
				await loadSourceHighlighter(source.mode);
				await a.sleep(80);
				a.equalValues(source.fold.ranges, []);
				source.fold.close(0);
				a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]'), null);
				a.equal(source.getText(), value);
			}
		});
		it.testElement('replaces only the exact fold range and preserves highlighted suffixes', async (a: TestApi) => {
			const value = 'invoke({\n  run: () => { hidden(); }\n}).next(42);';
			const { source } = await createSourceEditor(a, value);
			source.mode = 'javascript';
			source.tokenColors = { number: '#123456', punctuation: '#654321', identifier: '#abcdef' };
			await a.sleep(80);
			const range = source.fold.range(0);
			a.assert(range);
			a.equal(range.start, value.indexOf('{') + 1);
			a.equal(range.end, value.indexOf('}).next'));
			const context = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]')?.getContext('2d');
			a.assert(context);
			const painted: { text: string; color: string | CanvasGradient | CanvasPattern }[] = [];
			const fillText = context.fillText;
			const clearRect = context.clearRect;
			context.clearRect = function (x, y, width, height) { painted.length = 0; clearRect.call(this, x, y, width, height); };
			context.fillText = function (text, x, y, maxWidth) {
				painted.push({ text, color: this.fillStyle });
				fillText.call(this, text, x, y, maxWidth);
			};
			try {
				source.fold.close(0);
				await a.sleep(40);
				a.equal(painted.map(call => call.text).join(''), 'invoke({…}).next(42);', 'canvas preserves the matched tokens and highlighted suffix');
				a.ok(painted.some(call => call.text === '{' && call.color === '#654321'), 'opening token keeps punctuation highlighting');
				a.ok(painted.some(call => call.text === '}' && call.color === '#654321'), 'closing token keeps punctuation highlighting');
				a.ok(painted.some(call => call.text === '42' && call.color === '#123456'), 'suffix keeps number highlighting');
				a.ok(painted.some(call => call.text === 'next' && call.color === '#abcdef'), 'suffix keeps identifier highlighting');
				a.equal(source.getText(), value);
			} finally {
				context.fillText = fillText;
				context.clearRect = clearRect;
			}
		});
		it.testElement('paints folded syntax on the text canvas without a visible overlay', async (a: TestApi) => {
			const value = 'if (activeFile) {\n  hidden\n}';
			const source = await createFoldEditor(a, value);
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]');
			const context = canvas?.getContext('2d');
			a.assert(context);
			const painted: string[] = [];
			const fillText = context.fillText;
			context.fillText = function (text, x, y, maxWidth) {
				painted.push(text);
				fillText.call(this, text, x, y, maxWidth);
			};
			try {
				source.fold.close(0);
				await a.sleep(40);
				a.ok(painted.some(text => text.includes('…')), 'canvas paints only the ellipsis for the fold');
				const marker = source.shadowRoot?.querySelector('[part="fold-placeholder"]');
				a.assert(marker);
				a.equal(getComputedStyle(marker).opacity, '0', 'HTML marker provides only accessibility semantics');
				a.equal(source.getText(), value);
				painted.length = 0;
				source.fold.open(0);
				await a.sleep(40);
				a.ok(!painted.some(text => text.includes('…')), 'expansion restores ordinary canvas text');
			} finally {
				context.fillText = fillText;
			}
		});
		it.testElement('replaces selected ranges independently of other folds', async (a: TestApi) => {
			for (const [value, expected] of [
				['invoke([{\n  hidden\n}]);', '…'],
				['invoke(() => {\n  if (ready) {\n    hidden\n  }});', '…'],
				['invoke({\n  run: () => {\n    hidden\n  }});', '…'],
			] as const) {
				const { source } = await createSourceEditor(a, value);
				source.mode = 'javascript';
				await a.sleep(80);
				source.fold.close(0);
				await a.sleep(40);
				a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]')?.textContent, expected);
				a.equal(source.getText(), value);
			}
		});
		it.testElement('paints wrapped folded content once per frame', async (a: TestApi) => {
			const { source } = await createSourceEditor(a, 'invoke({\n  hidden\n}).next(42);');
			source.mode = 'javascript';
			source.style.width = '80px';
			await a.sleep(80);
			const context = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]')?.getContext('2d');
			a.assert(context);
			const frames: string[][] = [];
			let painted: string[] = [];
			const fillText = context.fillText;
			const clearRect = context.clearRect;
			context.clearRect = function (x, y, width, height) { painted = []; frames.push(painted); clearRect.call(this, x, y, width, height); };
			context.fillText = function (text, x, y, maxWidth) { painted.push(text); fillText.call(this, text, x, y, maxWidth); };
			try {
				source.fold.close(0);
				await a.sleep(40);
				a.ok(frames.length > 0);
				for (const frame of frames) a.equal(frame.join(''), 'invoke({…}).next(42);', 'each frame paints every visible character once');
			} finally {
				context.fillText = fillText;
				context.clearRect = clearRect;
			}
		});
		it.testElement('uses declared multi-character token boundaries including newlines', async (a: TestApi) => {
			for (const newline of [false, true]) {
				const value = `prefix BEGIN\n  hidden\nEND IF${newline ? '\n' : ' '}tail`;
				const { source } = await createSourceEditor(a, value);
				source.gutters = [lineNumbers()];
				source.highlighter = function* (source) {
					yield { source, start: source.indexOf('BEGIN'), end: source.indexOf('BEGIN') + 5, line: 0, kind: 'keyword', foldStart: 1 };
					yield { source, start: source.indexOf('END IF'), end: source.indexOf('END IF') + 6 + Number(newline), line: 2, kind: 'keyword', foldEnd: 1 };
				};
				await a.sleep(40);
				const range = source.fold.range(0);
				a.assert(range);
				source.fold.close(0);
				await a.sleep(40);
				a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]')?.textContent, '…');
				a.equalValues(visibleLineNumbers(source), newline ? [0, 3] : [0]);
				source.cursor.go(value.indexOf('tail'));
				a.equal(source.fold.range(0)?.closed, true);
				source.cursor.go(range.end);
				source.cursor.previous();
				a.equal(source.cursor.index, range.start, 'navigation crosses only the declared range');
				a.equal(source.getText(), value);
			}
		});
		it.testElement('keeps suffix interactions and decorations in document coordinates', async (a: TestApi) => {
			const value = 'invoke({\n  hidden\n}).next(42);';
			const { source } = await createSourceEditor(a, value);
			source.mode = 'javascript';
			await a.sleep(80);
			source.fold.close(0);
			await a.sleep(40);
			const canvas = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]');
			const context = canvas?.getContext('2d');
			const marker = source.shadowRoot?.querySelector('[part="fold-placeholder"]');
			a.assert(canvas && context && marker);
			const bounds = marker.getBoundingClientRect();
			const number = value.indexOf('42');
			const x = canvas.getBoundingClientRect().left + context.measureText('invoke({…}).next(').width + context.measureText('4').width / 4;
			source.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, pointerId: 1, clientX: x, clientY: bounds.top + bounds.height / 2 }));
			source.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
			a.equal(source.cursor.index, number, 'suffix pointer hit maps to its original offset');
			a.equal(source.fold.range(0)?.closed, true, 'visible suffix does not expand the fold');
			let fragments: readonly SourceDecorationFragment[] = [];
			const decorations = source.decorations.create({ layer: 'above-text', paint: context => { fragments = context.fragments; } });
			decorations.add({ range: { start: number, end: number + 2 }, value: 0 });
			a.equal(fragments[0]?.start, number);
			a.equal(fragments[0]?.end, number + 2);
			a.equal(fragments[0]?.line, 2);
			source.selection.set(0, value.length);
			a.equal(clipboardSelection(source), value);
			a.equal(source.fold.range(0)?.closed, true);
			source.edit.replace('99', { start: number, end: number + 2 });
			await a.sleep(40);
			a.equal(source.getText(), value.replace('42', '99'));
			a.equal(source.fold.range(0)?.closed, true);
			source.history.undo();
			await a.sleep(40);
			a.equal(source.getText(), value);
			source.history.redo();
			await a.sleep(40);
			a.equal(source.getText(), value.replace('42', '99'));
			decorations.dispose();
		});
		it.testElement('projects consecutive folded ranges and preserves their intervening text', async (a: TestApi) => {
			const value = 'one({\n  first\n}) + two({\n  second\n}).next(42);';
			const { source } = await createSourceEditor(a, value);
			source.mode = 'javascript';
			await a.sleep(80);
			const context = source.shadowRoot?.querySelector<HTMLCanvasElement>('canvas[part="text"]')?.getContext('2d');
			a.assert(context);
			const painted: string[] = [];
			const fillText = context.fillText;
			const clearRect = context.clearRect;
			context.clearRect = function (x, y, width, height) { painted.length = 0; clearRect.call(this, x, y, width, height); };
			context.fillText = function (text, x, y, maxWidth) { painted.push(text); fillText.call(this, text, x, y, maxWidth); };
			try {
				source.fold.close(0);
				source.fold.close(2);
				await a.sleep(40);
				a.equal(painted.join(''), 'one({…}) + two({…}).next(42);');
				a.equal(source.shadowRoot?.querySelectorAll('[part="fold-placeholder"]').length, 2);
				a.equal(source.getText(), value);
				source.fold.open(0);
				await a.sleep(40);
				a.equal(source.fold.range(2)?.closed, true);
				source.fold.openAll();
				await a.sleep(40);
				a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]'), null);
			} finally {
				context.fillText = fillText;
				context.clearRect = clearRect;
			}
		});
		it.testElement('indicates nested folds and preserves copy and history', async (a: TestApi) => {
			const value = 'if (outer) {\n  if (inner) {\n    hidden\n  }\n}\nafter';
			const source = await createFoldEditor(a, value);
			source.scrollIntoView({ block: 'center' });
			source.fold.close(1);
			await a.sleep(40);
			a.equal(source.fold.range(1)?.closed, true);
			const indicator = source.shadowRoot?.querySelector('[part="fold-placeholder"]');
			a.ok(indicator, 'nested collapsed block shows an inline indication');
			a.assert(indicator);
			a.equal(indicator.getAttribute('aria-label'), 'Collapsed code at line 2');
			await a.a11y(source);
			source.fold.close(0);
			await a.sleep(40);
			a.equal(source.shadowRoot?.querySelectorAll('[part="fold-placeholder"]').length, 1);
			source.fold.open(0);
			await a.sleep(40);
			a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]')?.getAttribute('aria-label'), 'Collapsed code at line 2');
			source.selection.set(0, value.length);
			a.equal(clipboardSelection(source), value);
			source.history.undo();
			a.equal(source.getText(), value, 'folding does not add history entries');
			source.fold.openAll();
			await a.sleep(40);
			a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]'), null);
		});
		it.testElement('wraps indicators and maps pointer hits to the document boundary', async (a: TestApi) => {
			const header = 'if (activeFileWithALongName) {';
			const value = `${header}\n  hidden\n}\n${'after\n'.repeat(30)}`;
			const source = await createFoldEditor(a, value);
			source.gutters = [];
			source.style.width = '16ch';
			source.scrollIntoView({ block: 'center' });
			source.fold.close(0);
			await a.sleep(75);
			const indicator = source.shadowRoot?.querySelector('[part="fold-placeholder"]');
			a.ok(indicator, 'wrapped fold has an indication');
			a.assert(indicator);
			const bounds = indicator.getBoundingClientRect();
			const canvas = source.shadowRoot?.querySelector('canvas[part="text"]');
			a.assert(canvas);
			const viewport = canvas.getBoundingClientRect();
			a.ok(bounds.left >= viewport.left && bounds.right <= viewport.right, 'indicator fits the viewport');
			a.ok(bounds.top > viewport.top, 'long header wraps');
			source.dispatchEvent(new PointerEvent('pointerdown', {
				bubbles: true, composed: true, button: 0, pointerId: 1,
				clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
			}));
			source.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1 }));
			a.equal(source.cursor.index, source.fold.range(0)?.end);
			source.cursor.next();
			a.equal(source.cursor.index, value.indexOf('}') + 1, 'closing token remains navigable');
			source.cursor.next();
			a.equal(source.cursorY.index, 3, 'navigation skips hidden lines');
			source.scrollTop = source.scrollHeight;
			await a.sleep(40);
			a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]'), null);
			source.scrollTop = 0;
			await a.sleep(40);
			a.ok(source.shadowRoot?.querySelector('[part="fold-placeholder"]'), 'indicator returns when scrolled into view');
			for (const color of ['rgb(17, 17, 17)', 'rgb(238, 238, 238)']) {
				source.style.color = color;
				const marker = source.shadowRoot?.querySelector('[part="fold-placeholder"]');
				a.assert(marker);
				a.equal(getComputedStyle(marker).borderTopColor, color, 'accessibility marker inherits theme text color');
			}
			source.setText('replacement');
			await a.sleep(40);
			a.equal(source.shadowRoot?.querySelector('[part="fold-placeholder"]'), null);
			a.equal(source.getText(), 'replacement');
		});
		let figureStarted = false;
		const figure = it.figure('fold-gutter',
			'<div style="display:flex;gap:8px;width:976px;height:216px;background:#fff;color:#111">' +
			['open', 'nested', 'outer'].map(state =>
				`<div>${state}<c-source-fold-${state} style="display:block;width:320px;height:192px;font:16px/24px monospace;color:#111"></c-source-fold-${state}></div>`,
			).join('') + '</div>',
			(node) => {
				figureStarted = true;
				(node as HTMLElement).style.width = '976px';
				for (const [state, line] of [['open', -1], ['nested', 2], ['outer', 0]] as const) {
					const name = `c-source-fold-${state}`;
					if (customElements.get(name)) continue;
					customElements.define(name, class extends Source {
						constructor() {
							super();
							this.highlighter = foldHighlighter;
							this.gutters = [lineNumbers(), foldGutter(this.fold)];
							this.setText('{\n  outer\n  {\n    inner\n  }\n}\nafter');
							if (line >= 0) this.fold.onChange
								.filter(() => this.fold.range(line) !== undefined)
								.take(1)
								.subscribe(() => this.fold.close(line));
						}
					});
				}
			});
		it.afterAll(async () => { if (figureStarted) await figure; });
		let canvasFigureStarted = false;
		const canvasFigure = it.figure('fold-canvas',
			'<div style="display:flex;gap:8px;width:976px;height:240px;background:#fff;color:#111">' +
			['light', 'dark', 'wrapped', 'multiple'].map(state =>
				`<div>${state}<c-source-fold-canvas-${state} style="display:block;width:238px;height:216px;font:16px/24px monospace;background:${state === 'dark' ? '#111' : '#fff'};color:${state === 'dark' ? '#eee' : '#111'}"></c-source-fold-canvas-${state}></div>`,
			).join('') + '</div>',
			node => {
				canvasFigureStarted = true;
				(node as HTMLElement).style.width = '976px';
				for (const state of ['light', 'dark', 'wrapped', 'multiple']) {
					const name = `c-source-fold-canvas-${state}`;
					if (customElements.get(name)) continue;
					customElements.define(name, class extends Source {
						constructor() {
							super();
							this.tokenColors = { identifier: state === 'dark' ? '#eeeeee' : '#111111', punctuation: state === 'dark' ? '#ffccbc' : '#1976d2', number: '#e64a19' };
							if (state === 'multiple') {
								this.mode = 'javascript';
								this.setText('one({\n  first\n}) + two({\n  second\n}).next(42);');
							} else {
								this.highlighter = function* (source) {
									yield { source, start: source.indexOf('BEGIN'), end: source.indexOf('BEGIN') + 5, line: 0, kind: 'keyword', foldStart: 1 };
									yield { source, start: source.indexOf('END IF'), end: source.indexOf('END IF') + 6, line: 2, kind: 'keyword', foldEnd: 1 };
									yield { source, start: source.indexOf('END IF') + 6, end: source.length, line: 2, kind: 'identifier' };
								};
								this.setText(`${state === 'wrapped' ? 'before a long header BEGIN' : 'before BEGIN'}\n  hidden\nEND IF ${state === 'wrapped' ? 'after with a long suffix' : 'after'}`);
							}
							this.fold.onChange.filter(() => this.fold.range(0) !== undefined).take(1).subscribe(() => this.fold.closeAll());
						}
					});
				}
			});
		it.afterAll(async () => { if (canvasFigureStarted) await canvasFigure; });

		it.testElement('paints highlight kinds and preserves syntax kinds', async (a: TestApi) => {
			const code = await createCode(a, '{');
			code.highlighter = foldHighlighter;
			code.tokenColors = { punctuation: '#123456' };
			const highlight = new SourceHighlight(() => undefined);
			highlight.reset('{', foldHighlighter);
			await a.sleep(40);
			a.equal(code.getTokenAt(0)?.kind, '{');
			a.equal(code.getTokenAt(0)?.highlight, 'punctuation');
			a.equal(code.shadowRoot?.querySelector('span')?.style.color, 'rgb(18, 52, 86)');
			a.equal(highlight.getTokenAt(0)?.kind, '{');
			a.equal(highlight.getLine(0)[0]?.kind, 'punctuation');
		});

		it.testElement('discovers nested folds and implements every command', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nouter\n{\ninner\n}\n}\nafter');
			a.equal(source.fold.ranges.length, 2);
			a.equal(source.fold.range(0)?.endLine, 5);
			a.equal(source.fold.range(1), undefined);
			a.equal(source.fold.range(NaN), undefined);
			source.cursorY.go(2);
			source.fold.close();
			source.fold.close();
			await a.sleep(20);
			a.equalValues(visibleLineNumbers(source), [0, 1, 2, 5, 6]);
			source.cursorY.go(0);
			source.fold.toggle();
			await a.sleep(20);
			a.equalValues(visibleLineNumbers(source), [0, 6]);
			source.fold.open();
			await a.sleep(20);
			a.equalValues(visibleLineNumbers(source), [0, 1, 2, 5, 6]);
			source.fold.openAll();
			source.fold.openAll();
			a.ok(source.fold.ranges.every(range => !range.closed));
			source.fold.closeAll();
			source.fold.closeAll();
			await a.sleep(20);
			a.equalValues(visibleLineNumbers(source), [0, 6]);
			source.fold.toggle(NaN);
			source.fold.close(-1);
			source.fold.open(99);
			a.ok(source.fold.ranges.every(range => range.closed));
		});

		it.testElement('logical navigation preserves goals through collapsed projections', async a => {
			const source = await createFoldEditor(a, 'longer {\n hidden\n}\nx\nlongest');
			source.fold.close(0);
			await a.sleep(40);
			source.cursor.go(5);
			source.cursorY.nextLogical();
			a.equalValues(cursorCoordinates(source), { line: 3, ch: 1 });
			source.cursor.go(source.cursorY.range().start);
			source.cursorY.nextLogical();
			a.equalValues(cursorCoordinates(source), { line: 4, ch: 5 });
			source.cursorY.previousLogical(2);
			a.equal(source.cursor.index, 5);
			a.equal(source.fold.range(0)?.closed, true);
		});

		it.testElement('preserves preferred position across a closed fold and short line', async a => {
			const source = await createFoldEditor(a, 'long first line\n{\nhidden\n}\nlong last line');
			source.fold.close(1);
			await a.sleep(40);
			source.cursor.go(12);
			source.cursorY.next();
			a.equal(source.cursorY.index, 3);
			source.cursorY.next();
			a.equal(source.cursorX.index, 12);
			source.cursorY.previous();
			source.cursorY.previous();
			a.equal(source.cursor.index, 12);
			a.ok(source.fold.ranges[0]?.closed, 'navigation keeps the fold closed');
		});

		it.testElement('keeps navigation and selections in document coordinates', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nhidden\n}\nafter');
			source.fold.close();
			await a.sleep(20);
			source.cursorY.next();
			a.equal(source.cursorY.index, 3);
			source.cursorY.previous();
			a.equal(source.cursorY.index, 0);
			source.cursorX.goEnd();
			source.cursor.next();
			a.equal(source.cursor.index, 11);
			source.cursor.previous();
			a.equal(source.cursor.index, 10);
			source.cursorY.nextPage();
			a.equal(source.cursorY.index, 3);
			source.cursorY.previousPage();
			a.equal(source.cursorY.index, 2, 'page navigation preserves the original closing boundary');
			source.selection.set(0, source.getText().length);
			a.ok(source.fold.ranges[0]?.closed);
			a.equal(source.selection.range().end, source.getText().length);
			source.selection.block(0, source.getText().length);
			a.equal(source.selection.ranges().length, 2);
			source.cursor.go(3);
			a.equal(source.cursor.index, 3);
			a.equal(source.fold.ranges[0]?.closed, false);
			await a.sleep(20);
			a.equalValues(visibleLineNumbers(source), [0, 1, 2, 3]);
			source.fold.closeAll();
			a.equal(source.cursor.index, 1, 'closing relocates a hidden caret to the content start');
		});

		it.testElement('stops horizontal and token navigation at a folded document end', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nhidden\n}');
			source.fold.closeAll();
			await a.sleep(20);
			source.cursorX.goEnd();
			source.cursor.next();
			a.equal(source.cursor.index, 10);
			source.cursor.nextPage();
			a.equal(source.cursor.index, 10);
			a.ok(source.fold.ranges[0]?.closed);
			source.cursor.go(0);
			source.cursorToken.next();
			a.equal(source.cursor.index, 9, 'token navigation reaches the preserved closing token');
			a.ok(source.fold.ranges[0]?.closed);
		});

		it.testElement('synchronizes accessible gutter toggles without losing focus', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nhidden\n}\nafter');
			const button = source.shadowRoot?.querySelector<HTMLButtonElement>('[part~="fold-toggle"] button');
			a.assert(button);
			a.equal(button.getAttribute('aria-expanded'), 'true');
			const cell = button.parentElement;
			a.assert(cell);
			const style = getComputedStyle(cell);
			const available = cell.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
			a.ok(button.getBoundingClientRect().width <= available, 'fold control fits inside its gutter cell');
			button.focus();
			button.click();
			await a.sleep(20);
			a.equal(button.getAttribute('aria-expanded'), 'false');
			a.equal(button.getAttribute('aria-label'), 'Expand fold at line 1');
			a.equal(source.shadowRoot?.activeElement, button);
			button.click();
			await a.sleep(20);
			a.equal(button.getAttribute('aria-expanded'), 'true');
			source.gutters = [];
			await a.sleep(20);
			a.equal(button.isConnected, false);
		});

		it.testElement('activates fold controls with the keyboard without editing text', async (a: TestApi) => {
			const value = '{\nhidden\n}\nafter';
			const source = await createFoldEditor(a, value);
			const button = source.shadowRoot?.querySelector<HTMLButtonElement>('[part~="fold-toggle"] button');
			a.assert(button);
			button.focus();
			const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true });
			button.dispatchEvent(enter);
			a.equal(enter.defaultPrevented, false, 'button activation is not handled as editor input');
			button.click();
			await a.sleep(20);
			a.equal(source.getText(), value);
			a.equal(button.getAttribute('aria-expanded'), 'false');
			button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true }));
			button.click();
			await a.sleep(20);
			a.equal(source.getText(), value);
			a.equal(button.getAttribute('aria-expanded'), 'true');
			await a.a11y(source);
		});

		it.testElement('toggles the focused gutter button with native browser keys', async (a: TestApi) => {
			const value = '{\nhidden\n}\nafter';
			const source = await createFoldEditor(a, value);
			const button = source.shadowRoot?.querySelector<HTMLButtonElement>('[part~="fold-toggle"] button');
			a.assert(button);
			button.focus();
			await editorAction(a, document.body, 'press', 'Enter');
			await a.sleep(20);
			a.equal(source.getText(), value);
			a.equal(button.getAttribute('aria-expanded'), 'false');
			await editorAction(a, document.body, 'press', 'Space');
			await a.sleep(20);
			a.equal(source.getText(), value);
			a.equal(button.getAttribute('aria-expanded'), 'true');
		});

		it.testElement('rebases unaffected folds and rediscovers touched folds', async (a: TestApi) => {
			const source = await createFoldEditor(a, 'before\n{\nhidden\n}\nafter');
			source.fold.close(1);
			source.edit.replace('prefix\n', { start: 0, end: 0 });
			await a.sleep(40);
			a.equal(source.fold.ranges[0]?.line, 2);
			a.equal(source.fold.ranges[0]?.closed, true);
			a.equalValues(visibleLineNumbers(source), [0, 1, 2, 5]);
			const index = source.getText().indexOf('hidden');
			source.edit.replace('changed', { start: index, end: index + 6 });
			a.equal(source.fold.ranges.length, 0, 'touching a fold invalidates it immediately');
			await a.sleep(40);
			a.equal(source.fold.ranges[0]?.closed, false);
			source.history.undo();
			await a.sleep(40);
			a.ok(source.getText().includes('hidden'));
			a.equal(source.fold.ranges.length, 1);
			source.history.redo();
			await a.sleep(40);
			a.ok(source.getText().includes('changed'));
			source.setText('plain');
			a.equal(source.fold.ranges.length, 0);
		});

		it.testElement('resets a collapsed document before projecting shorter replacement text', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nhidden\n}');
			source.fold.closeAll();
			await a.sleep(20);
			source.setText('plain');
			await a.sleep(20);
			a.equal(source.fold.ranges.length, 0);
			a.equalValues(visibleLineNumbers(source), [0]);
			a.equal(source.shadowRoot?.querySelector('[part~="fold-toggle"]'), null);
			source.edit.replace('\nsecond', { start: 5, end: 5 });
			await a.sleep(20);
			a.equalValues(visibleLineNumbers(source), [0, 1]);
		});

		it.testElement('discards stale streams, absent metadata, and changed modes', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nhidden\n}');
			source.fold.closeAll();
			source.highlighter = undefined;
			a.equal(source.fold.ranges.length, 0);
			source.mode = 'javascript';
			await loadSourceHighlighter('javascript');
			await a.sleep(40);
			source.mode = 'text';
			a.equal(source.fold.ranges.length, 0);
			source.highlighter = foldHighlighter;
			source.setText('{\nstale\n}');
			source.setText('plain');
			await a.sleep(40);
			a.equal(source.fold.ranges.length, 0);
			source.highlighter = function* (value) {
				yield { source: value, kind: 'text', line: 0, start: 0, end: value.length };
			};
			await a.sleep(20);
			a.equal(source.fold.ranges.length, 0);
			source.fold.toggle();
			source.fold.openAll();
			source.fold.closeAll();
		});

		it.testElement('keeps incomplete streams open and discards failed discovery', async (a: TestApi) => {
			const source = await createFoldEditor(a, '{\nhidden\n}');
			source.highlighter = function* (value) {
				yield* foldHighlighter(value);
				throw new Error('failed stream');
			};
			await a.sleep(40);
			a.equal(source.fold.ranges.length, 0);
			a.equal(source.getText(), '{\nhidden\n}');
			source.highlighter = foldHighlighter;
			source.setText('{\nincomplete');
			await a.sleep(40);
			a.equal(source.fold.ranges.length, 0);
			source.edit.replace('\n}', { start: source.getText().length, end: source.getText().length });
			await a.sleep(40);
			a.equal(source.fold.ranges.length, 1);
		});

		it.should('rejects malformed boundaries and retains only complete multiline folds', (a: TestApi) => {
			const buffer = new Buffer();
			buffer.reset('}\n{\n}\n{');
			const fold = new SourceFolding(buffer, () => 1, () => undefined);
			const tokens = [...foldHighlighter(buffer.getText())];
			fold.update(tokens);
			a.equal(fold.ranges.length, 1);
			fold.close();
			a.equal(fold.visibleCount, 3);
			a.equal(fold.lineAt(2), 3);
			a.equal(fold.rowAt(2), 1);
			fold.update(tokens.map(token => ({ ...token, foldStart: NaN })));
			a.equal(fold.ranges.length, 0);
			buffer.reset('{}');
			fold.update([...foldHighlighter('{}')]);
			a.equal(fold.ranges.length, 0);
			fold.reset();
			a.equal(fold.visibleCount, 1);
		});

		it.testElement('hit tests visible rows across gaps and excludes hidden geometry', (a: TestApi) => {
			const text = createTextCanvas(a, 80);
			text.begin(0);
			text.renderLine(0, '{');
			text.renderLine(1, 'cached hidden');
			text.commit(0);
			text.begin(0);
			text.renderLine(0, '{');
			text.renderLine(4, 'wrapped '.repeat(4));
			text.commit(0);
			a.equal(text.getCaret({ line: 1, ch: 0 }), undefined);
			const caret = text.getCaret({ line: 4, ch: 12 });
			a.assert(caret);
			const hit = new HitTest(text).getCaretAtPosition(caret.x, caret.y + caret.height / 2);
			a.equal(hit?.position.line, 4);
			a.equalValues(text.getSelectionRects({ line: 0, ch: 0 }, { line: 4, ch: 32 }).map(rect => rect.line).filter((line, index, lines) => lines.indexOf(line) === index), [0, 4]);
		});

		it.testElement('keeps folded large documents viewport bounded while scrolling', async (a: TestApi) => {
			const value = `{\n${createLargeSource()}\n}\nafter`;
			const source = await createFoldEditor(a, value);
			source.fold.closeAll();
			await a.sleep(40);
			a.equalValues(visibleLineNumbers(source), [0, LargeLineCount + 2]);
			source.fold.openAll();
			await a.sleep(40);
			source.scrollTop = source.scrollHeight;
			await a.sleep(40);
			const lines = visibleLineNumbers(source);
			a.ok(lines.length > 0 && lines.length < 100);
			a.equal(lines.at(-1), LargeLineCount + 2);
			source.scrollTop = 0;
			await a.sleep(40);
			a.equal(visibleLineNumbers(source)[0], 0);
			a.equal(source.shadowRoot?.querySelector('[part~="fold-toggle"] button')?.getAttribute('aria-expanded'), 'true');
		});
	});

	a.test('gutters', it => {
		it.testElement('aligns every text paint with the current gutters', async (a: TestApi) => {
			const source = a.element(Source);
			source.style.cssText = 'display:block;width:320px;height:160px;font:12px monospace';
			source.setText('{\nhello\n}');
			const canvas = source.shadowRoot?.querySelector('canvas[part="text"]');
			a.assert(canvas instanceof HTMLCanvasElement);
			const context = canvas.getContext('2d');
			a.assert(context);
			const paints: { x: number; width: number }[] = [];
			const fillText = context.fillText;
			context.fillText = function (text, x, y, maxWidth) {
				const width = source.shadowRoot?.querySelector('[part="gutters"]')?.getBoundingClientRect().width ?? 0;
				paints.push({ x, width });
				fillText.call(this, text, x, y, maxWidth);
			};
			try {
				source.gutters = [lineNumbers(), foldGutter(source.fold)];
				await a.sleep(75);
				a.ok(paints.some(paint => paint.width > 0), 'paints with gutters');
				source.highlighter = foldHighlighter;
				source.style.fontSize = '18px';
				await a.sleep(40);
				a.ok(source.shadowRoot?.querySelector('[part~="fold-toggle"]'), 'renders parsed fold controls');
				source.gutters = [lineNumbers()];
				await a.sleep(40);
				source.gutters = [];
				await a.sleep(40);
				a.ok(paints.some(paint => paint.width === 0), 'paints without gutters');
				a.ok(paints.every(paint => Math.abs(paint.x - Math.round(paint.width)) < 1), 'text never paints at a stale gutter offset');
			} finally { context.fillText = fillText; }
		});

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
		it.should('isolates checkpoint pieces and backing text across edits and resets', a => {
			const buffer = new Buffer();
			buffer.reset('tail');
			buffer.insert(0, 'a');
			buffer.mark();
			buffer.insert(1, 'b');
			a.equal(buffer.dirty(), true);
			buffer.delete(1, 2);
			a.equal(buffer.dirty(), false);
			buffer.reset('tail');
			buffer.insert(0, 'z');
			a.equal(buffer.dirty(), true);
			buffer.replace(0, 1, 'a');
			a.equal(buffer.dirty(), false);
			buffer.mark();
			buffer.replace(0, buffer.length, 'atail');
			a.equal(buffer.dirty(), false);
		});

		it.should('matches exact checkpoint equality through varied edit sequences', a => {
			const buffer = new Buffer();
			let value = 'alpha\r\n😀\nbeta';
			let marked = '';
			buffer.reset(value);
			for (let edit = 0; edit < 500; edit++) {
				if (edit % 17 === 0) {
					buffer.mark();
					marked = value;
				}
				const start = edit * 7 % (value.length + 1);
				const end = Math.min(value.length, start + edit % 4);
				const text = edit % 3 === 0 ? '😀\n' : '';
				buffer.replace(start, end, text);
				value = value.slice(0, start) + text + value.slice(end);
				a.equal(buffer.dirty(), value !== marked);
				if (edit % 11 === 0) {
					buffer.reset(marked);
					value = marked;
					a.equal(buffer.dirty(), false);
				}
			}
		});

		it.should('skips unchanged checkpoint ranges and caches large-document checks', a => {
			const buffer = new Buffer();
			buffer.reset(createLargeSource());
			const read = buffer.getText.bind(buffer);
			buffer.getText = (start, end) => {
				a.ok(start !== undefined && end !== undefined, 'does not read the full document');
				return read(start, end);
			};
			buffer.mark();
			const index = buffer.indexAt({ line: 50_000, ch: 4 });
			const original = buffer.charAt(index);
			buffer.replace(index, index + 1, 'X');
			const slice = String.prototype.slice;
			let compared = 0;
			a.mock(String.prototype, 'slice', function (this: string, start = 0, end = this.length) {
				compared += end - start;
				return slice.call(this, start, end);
			});
			a.equal(buffer.dirty(), true);
			a.equal(compared, 2, 'compares only the replaced character');
			a.equal(buffer.dirty(), true);
			a.equal(compared, 2, 'reuses the cached result');
			buffer.replace(index, index + 1, original);
			compared = 0;
			a.equal(buffer.dirty(), false);
			a.equal(compared, 2, 'restoration compares only the replaced character');
			a.equal(buffer.dirty(), false);
			a.equal(compared, 2, 'reuses a cached clean result');
			buffer.insert(index, 'added');
			compared = 0;
			a.equal(buffer.dirty(), true);
			a.equal(compared, 0, 'rejects different lengths without comparing content');
			buffer.delete(index, index + 5);
			a.equal(buffer.dirty(), false);
		});

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
