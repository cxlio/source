import {
	CompilerError,
	type Token,
	type HighlightToken,
	type Highlighter,
	type HighlightSource,
	type HighlightCheckpoint,
} from '@cxl/gbc.sdk';
import { Buffer, type BufferChange, type BufferSnapshot } from './buffer.js';

export interface SourceToken extends Token<string>, Partial<Pick<HighlightToken, 'highlight' | 'foldStart' | 'foldEnd'>> {
	state?: unknown;
	error?: CompilerError;
}

export interface SourceTokenSpan {
	start: number;
	end: number;
	kind: string;
}

export type SourceHighlighter = Highlighter | ((source: string) => Generator<SourceToken, void>);
export type SourceTokenColors = Readonly<Record<string, string>>;
type SourceReader = Buffer | string | (() => string);
type Checkpoint = HighlightCheckpoint<unknown>;

interface DirtyRange {
	start: number;
	end: number;
	delta: number;
	lines: number;
}

interface BucketState { line: number; start: number; end: number }

function moveToken<Node extends SourceToken>(token: Node, source: HighlightSource, offset = 0, line = 0): SourceToken {
	const fields: Partial<Node> = {};
	for (const key in token) if (key !== 'source' && Object.hasOwn(token, key)) fields[key] = token[key];
	const moved: SourceToken = { ...fields, kind: token.kind, start: token.start + offset,
		end: token.end + offset, line: token.line + line, get source() { return source.text(); } };
	if (token.error) {
		const position = token.error.position;
		const shifted = { start: position.start + offset, end: position.end + offset, line: position.line + line,
			get source() { return source.text(); } };
		moved.error = new CompilerError(token.error.message, shifted);
	}
	return moved;
}

export class SourceHighlight {
	#frame = 0;
	#lines = new Map<number, SourceTokenSpan[]>();
	#navigationTokens: SourceToken[] = [];
	#tokens: SourceToken[] = [];
	#version = 0;
	#id = {};
	#checkpoints: Checkpoint[] = [];
	#highlighter?: SourceHighlighter;
	#ready = false;
	#dirty?: DirtyRange;
	#iterator?: Generator<SourceToken | undefined, void>;

	constructor(
		private readonly changed: (
			done: boolean,
			tokens: readonly SourceToken[],
			failed: boolean,
		) => void,
	) {}

	reset(readSource: SourceReader, highlighter?: SourceHighlighter, retain = 0, retainLine = 0) {
		this.#ready = false;
		this.#dirty = undefined;
		this.#checkpoints = [];
		this.#highlighter = highlighter;
		this.#tokens = this.#tokens.filter(token => token.end <= retain);
		this.#navigationTokens = this.#tokens.filter(token => token.start >= 0 && token.end > token.start);
		for (const line of this.#lines.keys())
			if (line >= retainLine) this.#lines.delete(line);
		this.#schedule(readSource, highlighter);
	}

	replace(buffer: Buffer, change: BufferChange, highlighter?: SourceHighlighter) {
		if (!highlighter || typeof highlighter === 'function' || highlighter !== this.#highlighter || !this.#ready) {
			this.reset(buffer, highlighter, change.start, change.lineStart);
			return;
		}
		const previous = this.#dirty;
		const oldIndex = (index: number, end: boolean) => !previous || index <= previous.start ? index :
			index >= previous.end + previous.delta ? index - previous.delta : end ? previous.end : previous.start;
		this.#dirty = {
			start: Math.min(previous?.start ?? change.start, oldIndex(change.start, false)),
			end: Math.max(previous?.end ?? change.end, oldIndex(change.end, true)),
			delta: (previous?.delta ?? 0) + change.text.length - (change.end - change.start),
			lines: (previous?.lines ?? 0) + change.lineDelta,
		};
		this.#navigationTokens = this.#navigationTokens.filter(token => token.end <= (this.#dirty?.start ?? 0));
		for (const line of this.#lines.keys()) if (line >= change.lineStart) this.#lines.delete(line);
		this.#schedule(buffer, highlighter);
	}

	getLine(line: number) {
		return this.#lines.get(line) ?? [];
	}

	getNavigationTokens(): readonly SourceToken[] {
		return this.#navigationTokens;
	}

	getTokenAt(index: number) {
		if (this.#dirty && index >= this.#dirty.start) return;
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

	#close() {
		const iterator = this.#iterator;
		this.#iterator = undefined;
		try { iterator?.return(); } catch { return; }
	}

	#schedule(readSource: SourceReader, highlighter?: SourceHighlighter) {
		const version = ++this.#version;
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		this.#close();
		if (version !== this.#version) return;
		if (!highlighter) {
			this.#tokens = [];
			this.#navigationTokens = [];
			this.#lines.clear();
			this.changed(true, this.#tokens, false);
			return;
		}
		let snapshot: BufferSnapshot | undefined;
		const tokens: SourceToken[] = [];
		const checkpoints: Checkpoint[] = [];
		const incremental = Boolean(this.#dirty);
		const bucket = { line: -1, start: 0, end: 0 };
		const run = () => {
			if (version !== this.#version) return;
			let done: boolean;
			let failed = false;
			try {
				if (!this.#iterator) {
					let buffer: Buffer;
					if (readSource instanceof Buffer) buffer = readSource;
					else {
						buffer = new Buffer();
						buffer.reset(typeof readSource === 'string' ? readSource : readSource());
					}
					const captured = buffer.snapshot();
					snapshot = captured;
					let text: string | undefined;
					const source = { id: this.#id, version, length: captured.length,
						read: (start: number, end: number) => captured.getText(start, end),
						text: () => text ??= captured.getText() };
					this.#iterator = typeof highlighter === 'function' ? highlighter(source.text()) :
						this.#scan(source, highlighter, checkpoints);
					if (!incremental) {
						this.#tokens = tokens;
						this.#navigationTokens = [];
						this.#lines.clear();
					}
				}
				const deadline = performance.now() + 4;
				do {
					const result = this.#iterator.next();
					done = Boolean(result.done);
					if (result.done) break;
					if (result.value) {
						const token = result.value;
						tokens.push(token);
						if (!incremental && snapshot) {
							this.#append(snapshot, token, bucket);
						}
					}
				} while (performance.now() < deadline);
			} catch {
				done = true;
				failed = true;
				this.#close();
			}
			if (version !== this.#version) return;
			if (!done) {
				if (!incremental) this.changed(false, tokens, false);
				this.#frame = requestAnimationFrame(run);
				return;
			}
			this.#frame = 0;
			this.#iterator = undefined;
			this.#ready = !failed;
			this.#dirty = undefined;
			this.#checkpoints = failed ? [] : checkpoints;
			this.#tokens = tokens;
			if (incremental || failed) {
				this.#navigationTokens = [];
				this.#lines.clear();
				bucket.line = -1;
				if (snapshot) for (const token of tokens) this.#append(snapshot, token, bucket);
			}
			this.changed(true, tokens, failed);
		};
		this.#frame = requestAnimationFrame(run);
	}

	#restart(source: HighlightSource, highlighter: Highlighter, checkpoints: Checkpoint[]) {
		const dirty = this.#dirty;
		let checkpoint: Checkpoint | undefined;
		if (dirty) for (const saved of this.#checkpoints) {
			if (saved.offset >= dirty.start) break;
			checkpoint = highlighter.rebase(saved, source, 0, 0);
			checkpoints.push(checkpoint);
		}
		return checkpoint;
	}

	#candidate(checkpoints: Checkpoint[], index: number, offset: number, dirty: DirtyRange) {
		for (; index < checkpoints.length; index++) {
			const saved = checkpoints[index];
			if (saved && saved.offset + dirty.delta > offset && saved.committed >= dirty.end) break;
		}
		return index;
	}

	*#scan(source: HighlightSource, highlighter: Highlighter, checkpoints: Checkpoint[]): Generator<SourceToken | undefined, void> {
		const dirty = this.#dirty;
		const old = this.#checkpoints;
		let checkpoint = this.#restart(source, highlighter, checkpoints);
		if (checkpoint) for (const token of this.#tokens)
			if (token.end <= checkpoint.committed) yield moveToken(token, source);
		let candidate = 0;
		while (true) {
			const offset = checkpoint?.offset ?? 0;
			let end = Math.min(source.length, offset + 4096);
			if (dirty) {
				candidate = this.#candidate(old, candidate, offset, dirty);
				const saved = old[candidate];
				if (saved) end = Math.min(end, saved.offset + dirty.delta);
			}
			checkpoint = yield* highlighter.resume({ source, end }, checkpoint);
			if (checkpoint.done) return;
			checkpoints.push(checkpoint);
			yield undefined;
			const saved = old[candidate];
			if (dirty && saved && checkpoint.offset === saved.offset + dirty.delta &&
				checkpoint.committed >= dirty.end + dirty.delta && highlighter.equivalent(checkpoint, saved)) {
				for (const token of this.#tokens)
					if (token.start >= saved.committed) yield moveToken(token, source, dirty.delta, dirty.lines);
				for (let index = candidate + 1; index < old.length; index++) {
					const suffix = old[index];
					if (suffix) checkpoints.push(highlighter.rebase(suffix, source, dirty.delta, dirty.lines));
				}
				return;
			}
		}
	}

	#append(snapshot: BufferSnapshot, token: SourceToken, bucket: BucketState) {
		if (token.start >= 0 && token.end > token.start && token.end <= snapshot.length) this.#navigationTokens.push(token);
		this.#bucket(snapshot, token, bucket);
	}

	#bucket(snapshot: BufferSnapshot, token: SourceToken, bucket: BucketState) {
		let start = Math.max(0, token.start);
		let line = token.line;
		const tokenEnd = Math.min(snapshot.length, token.end);
		while (start < tokenEnd) {
			if (bucket.line !== line) Object.assign(bucket, { line, ...snapshot.lineRange(line) });
			const range = bucket;
			const end = Math.min(tokenEnd, range.end);
			if (end > start) {
				const spans = this.#lines.get(line) ?? [];
				spans.push({ start: start - range.start, end: end - range.start, kind: token.highlight ?? token.kind });
				this.#lines.set(line, spans);
			}
			if (range.end >= tokenEnd) break;
			const next = snapshot.lineRange(++line).start;
			if (next <= start) break;
			start = next;
		}
	}
}
