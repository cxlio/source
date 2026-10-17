# Source geometry

`source.geometry.caret(index)` accepts a UTF-16 document offset, including the
end of the document. A visible result contains `{ status: 'visible', bounds }`.
Bounds use viewport CSS pixels (`x`, `y`, `width`, `height`), like
`getBoundingClientRect()`. Carets have zero width and use the following visual
row at a wrap boundary. Bounds are clipped to the editor viewport, not the page
viewport; page scrolling can therefore produce negative coordinates.

Unavailable caret results contain only `status`:

- `invalid`: the offset is not a safe integer within the document.
- `folded`: the offset lies strictly inside a collapsed range.
- `unmeasured`: the editor is detached, has no layout, or awaits a render after
  invalidation. Query again after rendering; queries never force measurement.
- `offscreen`: the position has no visible measured caret.

`source.geometry.fragments({ start, end })` returns visible measured fragments
with viewport bounds and UTF-16 document `start`/`end` offsets. Reversed ranges
are normalized. Empty, invalid, detached, unmeasured and wholly offscreen ranges
return `[]`. A collapsed range maps to its visible ellipsis, retaining the
requested document range. Partially visible rectangles are clipped; their
source offsets are not adjusted by pixel clipping. Results are snapshots.

Both queries reuse cached geometry without changing selection, revealing folds,
scrolling, measuring text or reading the full document. Query after layout has
rendered when changing editor dimensions, gutters or fonts.
