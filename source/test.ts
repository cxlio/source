import { spec, type TestApi } from '@cxl/spec';
import { Buffer } from './buffer.js';
import { textCanvas, SourceLine } from './text.js';

function createTextCanvas(a: TestApi) {
	const host = a.element('div');
	host.style.cssText =
		'position:relative;width:320px;height:160px;font:12px monospace;color:#000';
	const text = textCanvas(host);
	text.canvas.style.cssText =
		'position:absolute;inset:0;width:100%;height:100%';
	text.measureElement.style.cssText =
		'visibility:hidden;position:absolute;inset:0;width:100%;white-space:pre-wrap;word-break:break-word';
	host.append(text.canvas, text.measureElement);
	return text;
}

export default spec('@cxl/ui.source', a => {
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
			const lineCount = 100_000;
			const source = Array.from(
				{ length: lineCount },
				(_, line) => `${line}\t${'value'.repeat(8)}`,
			).join('\n');
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
			a.equal(buffer.getLineCount(), lineCount);
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
