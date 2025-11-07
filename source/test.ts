import { spec } from '@cxl/spec';
import { textCanvas, SourceLine } from './text.js';

export default spec('@cxl/ui.source', a => {
	a.test('textCanvas', it => {
		it.should('begin resets firstVisibleLine and offsetY', a => {
			const host = a.element('div');
			const tc = textCanvas(host);
			tc.begin(5);
			a.equal(tc.firstVisibleLine, 5, 'firstVisibleLine set to argument');
			a.equal(tc.offsetY, 0, 'offsetY reset to 0');
		});

		it.should('renderLine populates cache and returns measurements', a => {
			const host = a.dom;
			host.style.cssText = 'height:160px';
			const tc = textCanvas(host);

			a.ok(tc.canvas.height);
			a.ok(+tc.measureElement.clientHeight);

			const out = tc.renderLine(0, 'hello');
			a.equal(out.offsetLeft, 0, 'offsetLeft is zero');
			a.equal(out.offsetWidth, 34, 'width from measureElement');
			a.equal(out.offsetHeight, 12, 'height from measureElement');
			a.equal(out.offsetTop, 0, 'first line top is zero');

			// cache should now have an entry for row 0
			const cached = tc.lineCache.get(0);
			a.ok(cached, 'line cached after renderLine');
			a.equal(
				(cached as SourceLine).text,
				'hello',
				'cached text matches',
			);
		});

		it.should('resize clears the line cache', a => {
			const host = a.element('div');
			const tc = textCanvas(host);
			// stub measureElement so renderLine works
			tc.renderLine(2, 'x');
			a.ok(tc.lineCache.get(2), 'cache populated');
			tc.resize();
			a.equal(
				tc.lineCache.get(2),
				undefined,
				'cache cleared after resize',
			);
		});

		it.should('commit invokes fillText on the canvas context', a => {
			const host = a.element('div');
			const tc = textCanvas(host);
			// spy on fillText
			const ctx = tc.canvas.getContext('2d')!;
			const spy = a.spyFn(ctx, 'fillText');
			a.ok(tc.canvas.width);
			a.ok(tc.canvas.height);

			tc.begin(0);
			tc.renderLine(0, 'A');
			tc.commit(0);

			a.ok(spy.lastEvent?.called, 'fillText was called at least once');
		});
	});
});
