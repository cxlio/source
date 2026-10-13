import { buildLibrary, esbuild } from '@cxl/build';

await buildLibrary({
	outputDir: '../docs/demo',
	tasks: [esbuild({
		stdin: {
			contents: "import { theme } from '@cxl/ui'; theme.imports = []; export * from './index.ts';",
			resolveDir: process.cwd(),
		},
		outfile: '../docs/demo/index.bundle.js',
		splitting: false,
	})],
});
