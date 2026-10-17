import type { Buffer } from './buffer.js';
import type { SourceRange } from './decoration.js';
import type { SourceFolding } from './fold.js';
import type { TextCanvas, TextRect } from './text.js';

export interface SourceBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export type SourceCaretGeometry =
	| { readonly status: 'visible'; readonly bounds: SourceBounds }
	| { readonly status: 'invalid' | 'unmeasured' | 'offscreen' | 'folded' };

export interface SourceGeometryFragment extends SourceBounds, SourceRange {}

export interface SourceGeometryFeature {
	caret(index: number): SourceCaretGeometry;
	fragments(range: SourceRange): readonly SourceGeometryFragment[];
}

export function sourceGeometry(
	buffer: Buffer,
	text: TextCanvas,
	host: HTMLElement,
	folding: SourceFolding,
): SourceGeometryFeature {
	const valid = (index: number) => Number.isSafeInteger(index) && index >= 0 && index <= buffer.length;
	function bounds(rect: TextRect, viewport: DOMRect, caret = false): SourceBounds | undefined {
		const x = Math.max(rect.x, 0);
		const y = Math.max(rect.y + text.offsetY, 0);
		const right = Math.min(rect.x + (caret ? 0 : rect.width), host.clientWidth);
		const bottom = Math.min(rect.y + text.offsetY + rect.height, host.clientHeight);
		if (bottom <= y || (caret ? right < x : right <= x)) return;
		return { x: viewport.x + x, y: viewport.y + y, width: right - x, height: bottom - y };
	}
	return {
		caret(index) {
			if (!valid(index)) return { status: 'invalid' };
			if (folding.hiddenAt(index)) return { status: 'folded' };
			if (!host.isConnected || !text.measured || !host.clientWidth || !host.clientHeight)
				return { status: 'unmeasured' };
			const rect = text.getVisibleCaret(buffer.positionAt(index));
			const result = rect && bounds(rect, host.getBoundingClientRect(), true);
			return result ? { status: 'visible', bounds: result } : { status: 'offscreen' };
		},
		fragments({ start, end }) {
			if (!valid(start) || !valid(end) || !host.isConnected || !text.measured) return [];
			if (start > end) [start, end] = [end, start];
			const viewport = host.getBoundingClientRect();
			return text.getVisibleSelectionRects(buffer.positionAt(start), buffer.positionAt(end)).flatMap(rect => {
				const result = bounds(rect, viewport);
				return result ? [{ ...result,
					start: buffer.indexAt({ line: rect.line, ch: rect.start }),
					end: buffer.indexAt({ line: rect.endLine ?? rect.line, ch: rect.end }),
				}] : [];
			});
		},
	};
}
