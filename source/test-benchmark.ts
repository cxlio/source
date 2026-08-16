import { spec, type TestApi } from '@cxl/spec';
import { Buffer } from './buffer.js';
import { textCanvas } from './text.js';

const LineCount = 100_000;
const ViewportLineCount = 60;
const benchmarkOptions = { warmup: 250, sampleTime: 50, samples: 30 };

function createLargeSource() {
	return Array.from(
		{ length: LineCount },
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

export default spec('Source line rendering benchmarks', s => {
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
});
