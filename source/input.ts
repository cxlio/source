import { observable, type Observable } from '@cxl/ui';

export interface TextInputUpdate {
	start: number;
	end: number;
	text: string;
	selectionStart: number;
	selectionEnd: number;
}

export interface TextInput {
	readonly element: HTMLElement;
	readonly kind: 'edit-context' | 'textarea';
	readonly updates: Observable<TextInputUpdate>;
	focus(): void;
	setBounds(rect: DOMRect): void;
	sync(text: string, selectionStart: number, selectionEnd: number, offset: number): void;
}

declare global {
	interface EditContextEventMap {
		textupdate: TextUpdateEvent;
	}

	interface EditContext extends EventTarget {
		addEventListener<K extends keyof EditContextEventMap>(
			type: K,
			listener: (this: EditContext, event: EditContextEventMap[K]) => void,
			options?: AddEventListenerOptions | boolean,
		): void;
		addEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: AddEventListenerOptions | boolean,
		): void;
		removeEventListener<K extends keyof EditContextEventMap>(
			type: K,
			listener: (this: EditContext, event: EditContextEventMap[K]) => void,
			options?: EventListenerOptions | boolean,
		): void;
		removeEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: EventListenerOptions | boolean,
		): void;
		updateControlBounds(rect: DOMRect): void;
		updateSelection(start: number, end: number): void;
		updateSelectionBounds(rect: DOMRect): void;
		updateText(start: number, end: number, text: string): void;
	}

	interface EditContextInit {
		selectionEnd?: number;
		selectionStart?: number;
		text?: string;
	}

	interface HTMLElement {
		editContext: EditContext | null;
	}

	interface TextUpdateEvent extends Event {
		readonly compositionEnd: number;
		readonly compositionStart: number;
		readonly selectionEnd: number;
		readonly selectionStart: number;
		readonly text: string;
		readonly updateRangeEnd: number;
		readonly updateRangeStart: number;
	}

	interface TextUpdateEventInit extends EventInit {
		compositionEnd?: number;
		compositionStart?: number;
		selectionEnd?: number;
		selectionStart?: number;
		text?: string;
		updateRangeEnd?: number;
		updateRangeStart?: number;
	}

	var TextUpdateEvent: {
		prototype: TextUpdateEvent;
		new (type: string, options?: TextUpdateEventInit): TextUpdateEvent;
	};

	interface Window {
		EditContext?: new (options?: EditContextInit) => EditContext;
	}
}

function editContextUpdates(target: EditContext) {
	return observable<TextInputUpdate>(subscriber => {
		const listener = (event: TextUpdateEvent) =>
			subscriber.next({
				start: event.updateRangeStart,
				end: event.updateRangeEnd,
				text: event.text,
				selectionStart: event.selectionStart,
				selectionEnd: event.selectionEnd,
			});
		target.addEventListener('textupdate', listener);
		subscriber.signal.subscribe(() =>
			target.removeEventListener('textupdate', listener),
		);
	});
}

function textareaUpdates(
	target: HTMLTextAreaElement,
	map: () => TextInputUpdate,
) {
	return observable<TextInputUpdate>(subscriber => {
		const listener = () => subscriber.next(map());
		target.addEventListener('input', listener);
		subscriber.signal.subscribe(() =>
			target.removeEventListener('input', listener),
		);
	});
}

function createEditContextInput(
	host: HTMLElement,
	EditContext: NonNullable<Window['EditContext']>,
): TextInput {
	const context = new EditContext();
	let offset = 0;
	let text = '';
	host.editContext = context;

	return {
		element: host,
		kind: 'edit-context',
		updates: editContextUpdates(context).map(event => {
			text =
				text.slice(0, event.start) +
				event.text +
				text.slice(event.end);
			return {
				start: offset + event.start,
				end: offset + event.end,
				text: event.text,
				selectionStart: offset + event.selectionStart,
				selectionEnd: offset + event.selectionEnd,
			};
		}),
		focus: () => host.focus(),
		setBounds(rect) {
			context.updateControlBounds(rect);
			context.updateSelectionBounds(rect);
		},
		sync(nextText, selectionStart, selectionEnd, nextOffset) {
			if (text !== nextText) context.updateText(0, text.length, nextText);
			text = nextText;
			offset = nextOffset;
			context.updateSelection(selectionStart, selectionEnd);
		},
	};
}

export function createTextareaInput(container: HTMLElement): TextInput {
	const element = document.createElement('textarea');
	element.id = 'input';
	element.autocapitalize = 'off';
	element.setAttribute('autocorrect', 'off');
	element.autocomplete = 'off';
	element.setAttribute('aria-label', 'Source editor');
	element.spellcheck = false;
	container.append(element);

	let offset = 0;
	let text = '';

	return {
		element,
		kind: 'textarea',
		updates: textareaUpdates(element, () => {
			const nextText = element.value;
			let start = 0;
			while (
				start < text.length &&
				start < nextText.length &&
				text.charCodeAt(start) === nextText.charCodeAt(start)
			)
				start++;

			let oldEnd = text.length;
			let newEnd = nextText.length;
			while (
				oldEnd > start &&
				newEnd > start &&
				text.charCodeAt(oldEnd - 1) === nextText.charCodeAt(newEnd - 1)
			) {
				oldEnd--;
				newEnd--;
			}

			const update = {
				start: offset + start,
				end: offset + oldEnd,
				text: nextText.slice(start, newEnd),
				selectionStart: offset + element.selectionStart,
				selectionEnd: offset + element.selectionEnd,
			};
			text = nextText;
			return update;
		}),
		focus: () => element.focus({ preventScroll: true }),
		setBounds(rect) {
			element.style.left = `${rect.left}px`;
			element.style.top = `${rect.top}px`;
		},
		sync(nextText, selectionStart, selectionEnd, nextOffset) {
			text = nextText;
			offset = nextOffset;
			if (element.value !== text) element.value = text;
			element.setSelectionRange(selectionStart, selectionEnd);
		},
	};
}

export function createTextInput(
	host: HTMLElement,
	container: HTMLElement,
): TextInput {
	const EditContext = window.EditContext;
	return EditContext
		? createEditContextInput(host, EditContext)
		: createTextareaInput(container);
}
