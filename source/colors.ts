import { type SourceTokenColors } from './highlight.js';

export const defaultTokenColors: SourceTokenColors = {
	keyword: 'var(--cxl-source-keyword, #0d47a1)',
	operator: 'var(--cxl-source-operator, #1976d2)',
	literal: 'var(--cxl-source-literal, #d32f2f)',
	number: 'var(--cxl-source-number, #c2410c)',
	comment: 'var(--cxl-source-comment, #546e7a)',
	string: 'var(--cxl-source-string, #c2410c)',
	template: 'var(--cxl-source-template, var(--cxl-source-string, #c2410c))',
	regex: 'var(--cxl-source-regex, #b33554)',
	type: 'var(--cxl-source-type, #6d4c41)',
	tag: 'var(--cxl-source-tag, #6d4c41)',
	attribute: 'var(--cxl-source-attribute, #0d47a1)',
	heading: 'var(--cxl-source-heading, var(--cxl-source-keyword, #0d47a1))',
	code: 'var(--cxl-source-code, var(--cxl-source-string, #c2410c))',
	link: 'var(--cxl-source-link, var(--cxl-source-keyword, #0d47a1))',
	blockquote: 'var(--cxl-source-blockquote, var(--cxl-source-comment, #546e7a))',
	emphasis: 'var(--cxl-source-emphasis, var(--cxl-source-operator, #1976d2))',
	strong: 'var(--cxl-source-strong, var(--cxl-source-operator, #1976d2))',
	list: 'var(--cxl-source-list, var(--cxl-source-operator, #1976d2))',
	separator: 'var(--cxl-source-separator, var(--cxl-source-operator, #1976d2))',
	directive: 'var(--cxl-source-directive, var(--cxl-source-keyword, #0d47a1))',
};
