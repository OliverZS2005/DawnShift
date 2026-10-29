// Posts an announcement to news.json, which every player connected to this server sees within minutes
// (the Play tab and the intro screen). On the server's computer:
//   npm run announce -- "Title" "What's new, in a sentence or two."
//   npm run announce -- "Title" "Text" --update     (also tells the apps a new version is out)
// --update raises the version number: apps older than it say "a new version is out" and link to the
// download. Do that once the new version is actually on the download page.
const fs = require('fs');
const path = require('path');
const file = process.env.NEWS_FILE || path.join(__dirname, '..', 'news.json');
const args = process.argv.slice(2), update = args.includes('--update'), [title, body] = args.filter(a => a !== '--update');
if (!title || !body) { console.error('Usage: npm run announce -- "Title" "Text" [--update]'); process.exit(1); }
const news = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 0, download: '', posts: [] };
const date = new Date().toISOString().slice(0, 10);
news.posts.unshift({ id: `${date}-${Date.now().toString(36)}`, date, title, body });
if (update) news.version = (news.version || 0) + 1;
fs.writeFileSync(file, JSON.stringify(news, null, 2) + '\n');
console.log(`Posted "${title}"${update ? `, and the version is now ${news.version}` : ''}.`);
