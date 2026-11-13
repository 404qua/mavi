import { build } from 'esbuild';
import { minify } from 'html-minifier-terser';
import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';

const OUT = 'build';

// Your own runtime files (fetched at runtime)
const COPY_DIRS = ['data', 'icons'];

// Cesium runtime folders. Skipped paths are things a Mars app shouldn't need;
// if the Network tab shows a 404 under cesium/, remove that entry from CESIUM_SKIP.
const CESIUM = 'node_modules/cesium/Build/Cesium';
const CESIUM_DIRS = ['Workers', 'ThirdParty', 'Assets'];
const CESIUM_SKIP = [
	'Assets/Textures/maki',
	'Assets/Textures/NaturalEarthII',
	'Assets/Textures/LensFlare',
	'Assets/Textures/waterNormals',
	'ThirdParty/google-earth-dbroot-parser.js',
	'ThirdParty/wasm_splats_bg.wasm',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// JS + CSS
const result = await build({
	entryPoints: ['script.js', 'style.css'],
	outdir: OUT,
	bundle: true,
	minify: true,
	format: 'esm',
	target: 'es2022',
	legalComments: 'none',
	metafile: true,
	define: { CESIUM_BASE_URL: '"./cesium"' }, // relative: works under /repo/
	loader: { '.png': 'dataurl', '.svg': 'dataurl', '.gif': 'dataurl', '.jpg': 'dataurl' },
});

// The app creates this worker relative to the bundled script.js at the build root.
await build({
	entryPoints: ['scripts/lib/pathfinder/pathfinder.worker.js'],
	outfile: `${OUT}/pathfinder.worker.js`,
	bundle: true,
	minify: true,
	format: 'esm',
	target: 'es2022',
	legalComments: 'none',
});

// Cesium runtime assets
for (const dir of CESIUM_DIRS) {
	await cp(`${CESIUM}/${dir}`, `${OUT}/cesium/${dir}`, {
		recursive: true,
		filter: (src) => !CESIUM_SKIP.some((s) => src.replaceAll('\\', '/').includes(s)),
	});
}

// Your own runtime files
for (const dir of COPY_DIRS) await cp(dir, `${OUT}/${dir}`, { recursive: true });

// HTML: link Cesium's widget CSS if index.html doesn't, then minify
let html = await readFile('index.html', 'utf8');
const hasWidgetCss = Object.keys(result.metafile.outputs).some((f) => f.endsWith('script.css'));
if (hasWidgetCss && !html.includes('script.css')) {
	html = html.replace('</head>', '<link rel="stylesheet" href="script.css"></head>');
}
await writeFile(
	`${OUT}/index.html`,
	await minify(html, {
		collapseWhitespace: true,
		removeComments: true,
		removeAttributeQuotes: true,
		minifyCSS: true,
		minifyJS: true,
	})
);

// Size report
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
for (const [file, out] of Object.entries(result.metafile.outputs)) {
	console.log(file.padEnd(28), kb(out.bytes));
}
let total = 0;
for (const f of await readdir(OUT, { recursive: true })) {
	const s = await stat(`${OUT}/${f}`);
	if (s.isFile()) total += s.size;
}
console.log(`\ntotal: ${(total / 1024 / 1024).toFixed(2)} MB`);
