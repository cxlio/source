import { type SourceHighlighter } from './highlight.js';

const modules = {
	javascript: () => import('./javascript.js'),
	typescript: () => import('./typescript.js'),
	html: () => import('./html.js'),
	gb: () => import('./gb.js'),
	markdown: () => import('./markdown.js'),
	basic: () => import('./basic.js'),
	shell: () => import('./shell.js'),
};

type Mode = keyof typeof modules;
const pending = new Map<Mode, Promise<SourceHighlighter>>();

export function loadSourceHighlighter(mode: string): Promise<SourceHighlighter | undefined> {
	if (mode !== 'javascript' && mode !== 'typescript' && mode !== 'html' &&
		mode !== 'gb' && mode !== 'markdown' && mode !== 'basic' && mode !== 'shell')
		return Promise.resolve(undefined);
	let result = pending.get(mode);
	if (!result) {
		result = modules[mode]().then(module => module.default);
		pending.set(mode, result);
	}
	return result;
}
