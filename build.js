// Inlines the stylesheet and scripts into one self contained file: node build.js -> dist/petal.html
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="design/petal.css">', () => '<style>\n' + read('design/petal.css') + '</style>');
html = html.replace('<link rel="icon" href="public/favicon-32.png">', () =>
  '<link rel="icon" href="data:image/png;base64,' + fs.readFileSync(path.join(root, 'public/favicon-32.png')).toString('base64') + '">');
const hashes = [];
for (const src of ['src/petal-engine.js', 'src/exercise-catalog.js', 'src/assistant.js', 'src/app.js']) {
  // Browsers turn CRLF into LF before hashing an inline script, so normalise first or the hash will not match.
  const code = '\n' + read(src).replace(/\r\n?/g, '\n').replace(/<\/script/gi, '<\\/script');
  hashes.push("'sha256-" + crypto.createHash('sha256').update(code).digest('base64') + "'");
  html = html.replace('<script src="' + src + '"></script>', () => '<script>' + code + '</script>');
}
// Inline scripts are allowed by hash only, so an injected <script> still cannot run.
if (!html.includes("script-src 'self'")) throw new Error('CSP meta tag not found in index.html');
html = html.replace("script-src 'self'", () => 'script-src ' + hashes.join(' '));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/petal.html'), html);
fs.writeFileSync(path.join(root, 'dist/index.html'), html); // served at / when hosted
console.log('Wrote dist/petal.html (' + Math.round(html.length / 1024) + ' KB)');
