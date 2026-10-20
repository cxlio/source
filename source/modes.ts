import { type SourceHighlighter } from './highlight.js';

const modules = {
	javascript: () => import('@cxl/gbc.javascript/highlight.js'),
	typescript: () => import('@cxl/gbc.typescript/highlight.js'),
	html: () => import('@cxl/gbc.html/highlight.js'),
	json: () => import('@cxl/gbc.json/highlight.js'),
	gb: () => import('@cxl/gbc.compiler/highlight.js'),
	markdown: () => import('@cxl/gbc.markdown/highlight.js'),
	basic: () => import('@cxl/gbc.basic/highlight.js'),
	shell: () => import('@cxl/gbc.cmd/highlight.js'),
};

type Mode = keyof typeof modules;
const pending = new Map<Mode, Promise<SourceHighlighter>>();

export function loadSourceHighlighter(mode: string): Promise<SourceHighlighter | undefined> {
	if (mode !== 'javascript' && mode !== 'typescript' && mode !== 'html' &&
		mode !== 'json' && mode !== 'gb' && mode !== 'markdown' && mode !== 'basic' && mode !== 'shell')
		return Promise.resolve(undefined);
	let result = pending.get(mode);
	if (!result) {
		result = modules[mode]().then(module => module.highlight);
		pending.set(mode, result);
	}
	return result;
}
