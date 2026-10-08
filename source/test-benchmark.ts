import { spec, type TestApi } from '@cxl/spec';
import { Buffer } from './buffer.js';
import { Code } from './code.js';
import { gutterMarkers, Source } from './index.js';
import { textCanvas } from './text.js';
import { loadSourceHighlighter } from './modes.js';

const LineCount = 100_000;
const HtmlLineCount = 10_000;
const HistoryLineCount = 10_000;
const ViewportLineCount = 60;
const MarkerCount = 10_000;
const benchmarkOptions = { warmup: 250, sampleTime: 50, samples: 30 };
const featureBenchmarkOptions = { warmup: 20, sampleTime: 20, samples: 10 };

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
		const anchor = source.cursor.indexAt({ line: 0, ch: 1 });
		let line = HistoryLineCount - 1;

		await a.benchmark(() => {
			source.selection.block(
				anchor,
				source.cursor.indexAt({ line, ch: 5 }),
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
				for (const token of scanner(source)) if (token.end > token.start) count++;
				return count;
			}, benchmarkOptions);
		});
	}

});
