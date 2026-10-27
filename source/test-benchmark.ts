import { spec, type TestApi } from '@cxl/spec';
import type { HighlightCheckpoint } from '@cxl/gbc.sdk';
import { SourceHighlight, type SourceToken } from './highlight.js';
import { Buffer } from './buffer.js';
import { Code } from './code.js';
import { foldGutter, gutterMarkers, Source } from './index.js';
import { SourceFolding } from './fold.js';
import { textCanvas } from './text.js';
import { loadSourceHighlighter } from './modes.js';

const LineCount = 100_000;
const HtmlLineCount = 10_000;
const HistoryLineCount = 10_000;
const ViewportLineCount = 60;
const MarkerCount = 10_000;
const benchmarkOptions = { warmup: 250, sampleTime: 50, samples: 30 };
const featureBenchmarkOptions = { warmup: 20, sampleTime: 20, samples: 10 };

function checkpoint(iterator: Generator<SourceToken, HighlightCheckpoint<unknown>>) {
	for (;;) {
		const next = iterator.next();
		if (next.done) return next.value;
	}
}

function createLargeSource(lineCount = LineCount) {
	return Array.from(
		{ length: lineCount },
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

export default spec('Source line rendering benchmarks', async s => {
	await Promise.all(['javascript', 'gb', 'markdown', 'basic', 'shell'].map(loadSourceHighlighter));
	s.test('javascript checkpoint resume and convergence', async (a: TestApi) => {
		const highlighter = await loadSourceHighlighter('javascript');
		a.assert(highlighter && typeof highlighter !== 'function');
		const value = 'const value = 1;\n'.repeat(3000);
		const source = { id: {}, version: 0, length: value.length, read: (start: number, end: number) => value.slice(start, end), text: () => value };
		const prefix = checkpoint(highlighter.resume({ source, end: 4096 }));
		const old = checkpoint(highlighter.resume({ source, end: 8192 }, prefix));
		const edited = value.slice(0, 6000) + 'x' + value.slice(6001);
		const changed = { ...source, version: 1, read: (start: number, end: number) => edited.slice(start, end), text: () => edited };
		const restart = highlighter.rebase(prefix, changed, 0, 0);
		a.equal(highlighter.equivalent(checkpoint(highlighter.resume({ source: changed, end: 8192 }, restart)), old), true);
		await a.benchmark(() => highlighter.equivalent(checkpoint(highlighter.resume({ source: changed, end: 8192 }, restart)), old), benchmarkOptions);
	});
	s.test('large-document pending highlighting edits', async (a: TestApi) => {
		a.setTimeout(60000);
		const highlighter = await loadSourceHighlighter('javascript');
		a.assert(highlighter);
		const buffer = new Buffer();
		const unit = 'const value = 12;\n';
		buffer.reset(unit.repeat(HistoryLineCount));
		let completed: (() => void) | undefined;
		const highlight = new SourceHighlight(done => { if (done) completed?.(); });
		await new Promise<void>(resolve => {
			completed = resolve;
			highlight.reset(buffer, highlighter);
		});
		const index = unit.length * (HistoryLineCount / 2) + 14;
		let alternate = false;
		await a.benchmark(() => {
			alternate = !alternate;
			highlight.replace(buffer, buffer.replace(index, index + 1, alternate ? '3' : '4'), highlighter);
			return highlight.getLine(HistoryLineCount / 2).length;
		}, { ...featureBenchmarkOptions, maxRegression: 25 });
		highlight.reset('');
	});
	s.test('large-document html', async a => {
		const code = a.element(Code);
		const source = createLargeSource(HtmlLineCount);
		code.style.cssText =
			'display:block;width:320px;height:160px;font:12px monospace';
		code.setText(source);

		await a.benchmark(() => {
			code.setText(source);
			return code.shadowRoot?.querySelector('pre')?.offsetHeight ?? 0;
		}, benchmarkOptions);
	});

	s.test('large-document viewport', async a => {
		const text = createTextCanvas(a);
		const buffer = new Buffer();
		buffer.reset(createLargeSource());
		let firstLine = 0;

		await a.benchmark(() => {
			firstLine = (firstLine + ViewportLineCount) %
				(LineCount - ViewportLineCount);
			text.lineCache.clear();
			text.begin(firstLine);
			for (
				let line = firstLine;
				line < firstLine + ViewportLineCount;
				line++
			)
				text.renderLine(line, buffer.getLine(line));
			text.commit(0);
			return text.lineCache.get(firstLine)?.height ?? 0;
		}, benchmarkOptions);
	});

	s.test('large-document gutter markers', async a => {
		const markers = gutterMarkers();
		a.dom.append(markers.element);
		for (let line = 0; line < MarkerCount; line++)
			markers.setGutterMarker(
				line,
				'diagnostics',
				document.createElement('span'),
			);
		let firstLine = 0;

		await a.benchmark(() => {
			firstLine = (firstLine + ViewportLineCount) %
				(MarkerCount - ViewportLineCount);
			markers.render({
				lines: Array.from({ length: ViewportLineCount }, (_, line) => ({
					row: firstLine + line,
					offsetTop: line * 16,
					height: 16,
				})),
				lineCount: MarkerCount,
				offset: 0,
			});
			return markers.element.firstElementChild?.childElementCount ?? 0;
		}, featureBenchmarkOptions);
	});

	s.test('large-document fold gutter', async a => {
		const buffer = new Buffer();
		const value = Array<string>(MarkerCount).fill('{\nx\n}').join('\n');
		buffer.reset(value);
		const fold = new SourceFolding(buffer, () => 0, () => undefined);
		fold.update(Array.from({ length: MarkerCount }, (_, block) => [
			{ source: value, kind: '{', highlight: 'punctuation' as const, start: block * 6, end: block * 6 + 1, line: block * 3, foldStart: 1, foldEnd: 0 },
			{ source: value, kind: '}', highlight: 'punctuation' as const, start: block * 6 + 4, end: block * 6 + 5, line: block * 3 + 2, foldStart: 0, foldEnd: 1 },
		]).flat());
		fold.closeAll();
		const gutter = foldGutter(fold);
		a.dom.append(gutter.element);
		let firstLine = 0;
		await a.benchmark(() => {
			firstLine = (firstLine + ViewportLineCount) % (MarkerCount - ViewportLineCount);
			gutter.render({
				lines: Array.from({ length: ViewportLineCount }, (_, line) => ({
					row: fold.lineAt(firstLine + line),
					offsetTop: line * 16,
					height: 16,
				})),
				lineCount: buffer.getLineCount(),
				offset: 0,
			});
			return gutter.element.childElementCount;
		}, { ...featureBenchmarkOptions, maxRegression: 25 });
	});

	s.test('large-document edit history', async a => {
		const source = new Source();
		const value = createLargeSource(HistoryLineCount);
		const index = Math.floor(value.length / 2);
		source.setText(value);

		await a.benchmark(() => {
			source.edit.replace('x', { start: index, end: index + 1 });
			source.history.undo();
			return source.selection.range().start;
		}, featureBenchmarkOptions);
	});

	s.test('large-document block selection', async a => {
		const source = a.element(Source);
		source.style.cssText =
			'display:block;width:320px;height:160px;font:12px monospace';
		source.setText(createLargeSource(HistoryLineCount));
		await a.sleep(20);
		const anchor = source.cursorY.position(0).start + 1;
		let line = HistoryLineCount - 1;

		await a.benchmark(() => {
			source.selection.block(
				anchor,
				source.cursorY.position(line).start + 5,
			);
			line = line === HistoryLineCount - 1 ? HistoryLineCount - 2 : HistoryLineCount - 1;
			return source.cursor.index;
		}, featureBenchmarkOptions);
	});

	s.test('large-document search', async a => {
		const source = new Source();
		source.setText(createLargeSource());

		await a.benchmark(
			() => source.search.findAll('missing value').length,
			featureBenchmarkOptions,
		);
	});

	s.test('large-document active search edit', async a => {
		const source = a.element(Source);
		source.style.cssText =
			'display:block;width:320px;height:160px;font:12px monospace';
		source.setText('alpha beta\n'.repeat(LineCount));
		await a.sleep(20);
		source.search.highlight('alpha');
		let matching = true;
		await a.benchmark(() => {
			source.edit.replace(matching ? 'x' : 'h', { start: 3, end: 4 });
			matching = !matching;
			return source.cursor.index;
		}, { ...featureBenchmarkOptions, maxRegression: 30 });
	});

	s.test('vertical cursor roundtrip', async a => {
		const source = a.element(Source);
		source.style.cssText = 'display:block;width:600px;height:240px;font:12px monospace';
		source.setText('  one.two  three!\n  four five\n\nsix');
		await a.sleep(75);
		source.cursor.go(15);
		await a.benchmark(() => {
			source.cursorY.next();
			source.cursorY.previous();
			return source.cursor.index;
		}, { ...featureBenchmarkOptions, maxRegression: 25 });
		a.equal(source.cursor.index, 15);
	});

	s.test('logical cursor roundtrip with endpoint correction', async a => {
		const source = a.element(Source);
		source.style.cssText = 'display:block;width:320px;height:160px;font:12px monospace';
		source.setText('longer\nx\nlongest');
		await a.sleep(75);
		source.cursor.go(5);
		await a.benchmark(() => {
			source.cursorY.nextLogical();
			source.cursor.go(7);
			source.cursorY.previousLogical();
			return source.cursor.index;
		}, { ...featureBenchmarkOptions, maxRegression: 25 });
		a.equal(source.cursor.index, 5);
	});

	s.test('large-document cursor navigation', async a => {
		const source = a.element(Source);
		source.setText(createLargeSource(HistoryLineCount));
		source.mode = 'javascript';
		await loadSourceHighlighter(source.mode);
		await a.sleep(100);
		a.ok(
			Boolean(source.getTokenAt(0)),
			'tokenizer completed a navigation snapshot',
		);
		let token = 0;

		await a.benchmark(() => {
			source.cursorToken.go(token++ % HistoryLineCount);
			return source.cursorToken.index;
		}, featureBenchmarkOptions);
	});

	s.test('large-document decorations', async a => {
		const source = a.element(Source);
		source.style.cssText =
			'display:block;width:320px;height:160px;font:12px monospace';
		source.setText(createLargeSource());
		await a.sleep(20);
		let painted = 0;
		const decorations = source.decorations.create<number>({
			layer: 'behind-text',
			paint: ({ fragments }) => {
				painted += fragments.length;
			},
		});
		const ranges = source.search.findAll('\t');
		decorations.replaceAll(
			ranges.map((range, value) => ({ range, value })),
		);
		const first = decorations.add({
			range: ranges[0] ?? { start: 0, end: 0 },
			value: -1,
		});

		await a.benchmark(() => {
			painted = 0;
			first.invalidate();
			return painted;
		}, featureBenchmarkOptions);
	});

	s.test('wrapped line', async a => {
		const text = createTextCanvas(a, 120);
		const value = `start ${'wrapped content '.repeat(12)}end`;

		text.begin(0);
		text.renderLine(0, value);
		text.commit(0);
		a.ok(
			[...(text.lineCache.get(0)?.lines ?? [])].length > 1,
			'fixture wraps onto multiple visual lines',
		);

		await a.benchmark(() => {
			text.lineCache.clear();
			text.begin(0);
			text.renderLine(0, value);
			text.commit(0);
			return text.lineCache.get(0)?.height ?? 0;
		}, benchmarkOptions);
	});
	for (const [mode, value] of Object.entries({
		gb: "main { value = 'hello'; 12 >> out }",
		markdown: '# Heading\nText **bold** and `code`.\n[label](https://example.test)\n\n```js\nconst value = 1;\n```\n',
		basic: 'IF value = 12 THEN\n PRINT "hello"\nEND IF\nREM comment',
		shell: 'if test -n "$HOME"; then\n echo "hello" | cat\nfi\n# comment',
	})) {
		s.test(`${mode} tokenization`, async (a: TestApi) => {
			const scanner = await loadSourceHighlighter(mode);
			a.assert(scanner);
			const source = Array(200).fill(value).join('\n');
			await a.benchmark(() => {
				let count = 0;
				for (const token of (typeof scanner === 'function' ? scanner(source) : scanner.resume({ source: { id: {}, version: 0, length: source.length, read: (start, end) => source.slice(start, end), text: () => source } }))) if (token.end > token.start) count++;
				return count;
			}, benchmarkOptions);
		});
	}

});
