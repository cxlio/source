import { type Highlighter, type LanguageResolver } from '@cxl/gbc.sdk';
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

const pending = new Map<string, Promise<Highlighter | undefined>>();
const aliases: Readonly<Record<string, string>> = {
	js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript', ecmascript: 'javascript',
	ts: 'typescript', md: 'markdown', sh: 'shell', bash: 'shell', cmd: 'shell',
};

export function loadSourceHighlighter(mode: string): Promise<SourceHighlighter | undefined> {
	if (!Object.hasOwn(modules, mode))
		return Promise.resolve(undefined);
	if (!pending.size) {
		const languages = new Map<string, Highlighter>();
		const resolveLanguage: LanguageResolver = language => {
			const tag = language.toLowerCase();
			return languages.get(aliases[tag] ?? tag);
		};
		const ready = Promise.all(Object.entries(modules).map(async ([name, load]) => {
			languages.set(name, (await load()).highlight({ resolveLanguage }));
		}));
		for (const name of Object.keys(modules))
			pending.set(name, ready.then(() => languages.get(name)));
	}
	return pending.get(mode) ?? Promise.resolve(undefined);
}
