export interface Piece {
	source: 'original' | 'add';
	start: number;
	length: number;
}

export class Buffer {
	#table: Piece[] = [];
	#addBuffer = '';
	#prefixSums: number[] = [];
	#source = '';

	getLineCount(): number {
		// always up‐to‐date after rebuildLineCounts()
		return this.#prefixSums[this.#prefixSums.length - 1];
	}

	/**
	 * Retrieves the content of a specific line from the composite text buffer,
	 * enabling random-access line reading for virtual scrolling.
	 * The function traverses the Piece table to stitch together original
	 * and added buffer segments as one continuous text source.
	 */
	getLine(lineNumber: number): string {
		const prefixSums = this.#prefixSums;
		const totalLines = prefixSums[prefixSums.length - 1];
		if (lineNumber < 0 || lineNumber >= totalLines) return '';
		const table = this.#table;

		// binary search for piece i so that
		// prefixSums[i] <= lineNumber < prefixSums[i+1]
		let lo = 0,
			hi = table.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (prefixSums[mid + 1] > lineNumber) hi = mid;
			else lo = mid + 1;
		}
		const piece = table[lo];
		const text =
			piece.source === 'original' ? this.#source : this.#addBuffer;
		const end = piece.start + piece.length;

		// how many lines we skip inside this piece
		const skipLines = lineNumber - prefixSums[lo];

		// find byte‐offset in [start..end) where our line starts
		let pos = piece.start;
		for (let i = 0; i < skipLines; i++) {
			const nl = text.indexOf('\n', pos);
			// should always find one, because skipLines < lineCounts[pieceIndex]
			pos = nl + 1;
		}

		// now pos is the start of our line. find its end.
		const firstNL = text.indexOf('\n', pos);
		let line = '';
		if (firstNL >= 0 && firstNL < end) {
			// newline is inside this piece
			line = text.slice(pos, firstNL);
		} else {
			// no newline in this piece to end the line —
			// take rest of piece, then carry on into subsequent pieces
			line = text.slice(pos, end);
			let pi = lo + 1;
			while (pi < this.#table.length) {
				const p2 = this.#table[pi];
				const t2 =
					p2.source === 'original' ? this.#source : this.#addBuffer;
				const s2 = p2.start;
				const e2 = s2 + p2.length;
				const segment = t2.slice(s2, e2);
				const nl2 = segment.indexOf('\n');
				if (nl2 >= 0) {
					line += segment.slice(0, nl2);
					break;
				} else {
					line += segment;
					pi++;
				}
			}
		}

		return line;
	}

	reset(newSource: string) {
		this.#source = newSource;
		this.#table = [
			{ source: 'original', start: 0, length: newSource.length },
		];
		this.#addBuffer = '';
		this.#rebuildLineCounts();
	}

	#rebuildLineCounts() {
		const counts: number[] = [];
		for (const p of this.#table) {
			const text =
				p.source === 'original' ? this.#source : this.#addBuffer;
			let cnt = 0;
			// count '\n' in [p.start, p.start+p.length)
			let idx = text.indexOf('\n', p.start - 1);
			while (idx >= 0 && idx < p.start + p.length - 1) {
				cnt++;
				idx = text.indexOf('\n', idx + 1);
			}
			// if the piece isn’t empty, it has at least 1 line
			counts.push(p.length > 0 ? cnt + 1 : 0);
		}
		const ps = (this.#prefixSums = [0]);
		for (const c of counts) {
			ps.push(ps[ps.length - 1] + c);
		}
	}
}
