import {
	tokenize,
	type Scanner,
	type Token,
} from '@cxl/gbc.sdk';

export interface SourceToken extends Token<string> {
	state?: unknown;
}

export interface SourceTokenSpan {
	start: number;
	end: number;
	kind: string;
}

export type SourceTokenizer = Scanner<Token<string>>;
export type SourceTokenColors = Readonly<Record<string, string>>;
type SourceReader = string | (() => string);

interface BucketState {
	line: number;
	start: number;
	end: number;
}

export class SourceHighlight {
	#frame = 0;
	#lines = new Map<number, SourceTokenSpan[]>();
	#navigationTokens: SourceToken[] = [];
	#tokens: SourceToken[] = [];
	#version = 0;

	constructor(
		private readonly changed: (
			done: boolean,
			tokens: readonly SourceToken[],
		) => void,
	) {}

	reset(
		readSource: SourceReader,
		tokenizer?: SourceTokenizer,
		retain = 0,
		retainLine = 0,
	) {
		const version = ++this.#version;
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		this.#tokens = this.#tokens.filter(token => token.end <= retain);
		this.#navigationTokens = this.#tokens.filter(
			token => token.start >= 0 && token.end > token.start,
		);
		for (const line of this.#lines.keys())
			if (line >= retainLine) this.#lines.delete(line);
		if (!tokenizer) {
			this.#tokens = [];
			this.#navigationTokens = [];
			this.#lines.clear();
			this.changed(true, this.#tokens);
			return;
		}

		let iterator: Generator<SourceToken> | undefined;
		const navigationTokens: SourceToken[] = [];
		const tokens: SourceToken[] = [];
		const lines = new Map<number, SourceTokenSpan[]>();
		const bucket = { line: -1, start: 0, end: 0 };
		let committed = retain === 0;
		let source = '';

		const run = () => {
			let done = false;
			try {
				if (!iterator) {
					source =
						typeof readSource === 'string' ? readSource : readSource();
					iterator = tokenize(tokenizer, source);
				}
				const deadline = performance.now() + 4;
				let result: IteratorResult<SourceToken>;
				do {
					result = iterator.next();
					done = Boolean(result.done);
					if (result.done) break;
					const token = result.value;
					tokens.push(token);
					if (
						token.start >= 0 &&
						token.end > token.start &&
						token.end <= source.length
					)
						navigationTokens.push(token);
					this.#bucket(source, lines, token, bucket);
					if (!committed && token.end >= retain) committed = true;
				} while (performance.now() < deadline);
			} catch {
				done = true;
			}

			if (version !== this.#version) return;
			if (committed || done) {
				this.#tokens = tokens;
				this.#navigationTokens = navigationTokens;
				this.#lines = lines;
				this.changed(done, this.#tokens);
			}
			if (!done)
				this.#frame = requestAnimationFrame(run);
			else this.#frame = 0;
		};

		this.#frame = requestAnimationFrame(run);
	}

	getLine(line: number) {
		return this.#lines.get(line) ?? [];
	}

	getNavigationTokens(): readonly SourceToken[] {
		return this.#navigationTokens;
	}

	getTokenAt(index: number) {
		let low = 0;
		let high = this.#tokens.length - 1;
		while (low <= high) {
			const middle = (low + high) >> 1;
			const token = this.#tokens[middle];
			if (!token) return;
			if (index < token.start) high = middle - 1;
			else if (index > token.end) low = middle + 1;
			else return token;
		}
	}

	#bucket(
		source: string,
		lines: Map<number, SourceTokenSpan[]>,
		token: SourceToken,
		bucket: BucketState,
	) {
		if (token.end <= token.start) return;
		let start = token.start;
		let line = token.line;
		if (bucket.line !== line) {
			bucket.line = line;
			bucket.start = source.lastIndexOf('\n', start - 1) + 1;
			const newline = source.indexOf('\n', start);
			bucket.end = newline === -1 ? source.length : newline;
		}
		while (start < token.end) {
			const end = Math.min(token.end, bucket.end);
			if (end > start) {
				const spans = lines.get(line) ?? [];
				spans.push({
					start: start - bucket.start,
					end: end - bucket.start,
					kind: token.kind,
				});
				lines.set(line, spans);
			}
			if (bucket.end >= token.end) break;
			start = bucket.end + 1;
			bucket.start = start;
			bucket.line = ++line;
			const newline = source.indexOf('\n', start);
			bucket.end = newline === -1 ? source.length : newline;
		}
	}
}
