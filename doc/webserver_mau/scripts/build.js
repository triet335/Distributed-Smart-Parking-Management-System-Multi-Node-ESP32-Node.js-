const esbuild = require('esbuild');
const path = require('node:path');
const watching = process.argv.includes('--watch');
const config = {
    entryPoints: [path.join(__dirname, '..', 'client', 'App.jsx')], bundle: true,
    outfile: path.join(__dirname, '..', 'public', 'assets', 'app.js'), jsx: 'automatic',
    minify: !watching, sourcemap: watching,
    define: { 'process.env.NODE_ENV': JSON.stringify(watching ? 'development' : 'production') },
    target: ['es2020'], logLevel: 'info'
};
async function main() {
    if (watching) {
        const context = await esbuild.context(config);
        await context.watch();
        console.log('Đang theo dõi JSX/CSS. Tải lại trình duyệt sau khi sửa.');
    } else await esbuild.build(config);
}
main().catch(() => process.exit(1));
