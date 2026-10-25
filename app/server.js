const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;
const PASS = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SECRET || crypto.createHash('sha256').update('s:' + PASS).digest('hex');
const FILE = path.join(__dirname, 'data', 'content.json');
const load = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const save = c => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(c, null, 2)); fs.renameSync(FILE + '.tmp', FILE); };
const pick = a => a[Math.floor(Math.random() * a.length)];
const sign = t => crypto.createHmac('sha256', SECRET).update(t).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- text generators: unlimited combos, emoji always matches the theme ----
const gen = themes => { const t = pick(themes); return { text: pick(t.starts) + ' ' + pick(t.ends), emoji: pick(t.emoji) }; };

// Optional: real AI generation (set ANTHROPIC_API_KEY and tick "Use AI" in admin)
async function ai(kind, n) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 400,
        messages: [{ role: 'user', content: `Write ${n} new, short, sweet ${kind} for a romantic birthday website (Bubu & Dudu bear/panda couple theme). One line each, max 12 words, no emoji inside the text. Reply ONLY with JSON: [{"text":"...","emoji":"ONE emoji that matches the text"}]` }]
      })
    });
    const j = await r.json();
    const arr = JSON.parse(j.content[0].text.replace(/```json|```/g, '').trim());
    return arr.slice(0, n).map(x => ({ text: String(x.text), emoji: String(x.emoji) }));
  } catch { return null; }
}
const make = (key, kind) => async (req, res) => {
  const c = load(), n = Math.min(Math.max(+req.query.n || 1, 1), 6);
  let items = c.useAI ? await ai(kind, n) : null;
  if (!items) items = Array.from({ length: n }, () => gen(c[key]));
  res.json({ items });
};

// ---- public API ----
app.get('/api/content', (req, res) => {
  const { momentThemes, reasonThemes, useAI, ...pub } = load();
  res.json(pub);
});
app.get('/api/moments', make('momentThemes', 'cute couple moment captions'));
app.get('/api/reasons', make('reasonThemes', '"reasons I love you" lines'));

// ---- admin auth (signed, HttpOnly cookie) ----
let fails = 0, lockUntil = 0;
const authed = req => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)tok=([^;]+)/); if (!m) return false;
  const [ts, sig] = decodeURIComponent(m[1]).split('.');
  return !!sig && safeEq(sig, sign(ts)) && Date.now() - +ts < 7 * 864e5;
};
const guard = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'login required' });

app.post('/api/login', (req, res) => {
  if (Date.now() < lockUntil) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  if (!safeEq(String(req.body.password || ''), PASS)) {
    if (++fails >= 5) { lockUntil = Date.now() + 60000; fails = 0; }
    return setTimeout(() => res.status(401).json({ error: 'Wrong password' }), 700);
  }
  fails = 0; const ts = String(Date.now());
  res.cookie('tok', ts + '.' + sign(ts), { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 7 * 864e5 });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('tok'); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => res.json({ authed: authed(req) }));
app.get('/api/admin/content', guard, (req, res) => res.json(load()));
app.put('/api/admin/content', guard, (req, res) => {
  const c = req.body, S = a => Array.isArray(a) && a.every(x => typeof x === 'string');
  const T = a => Array.isArray(a) && a.length && a.every(t => S(t.emoji) && t.emoji.length && S(t.starts) && t.starts.length && S(t.ends) && t.ends.length);
  if (!c || !S(c.letter) || !S(c.promises) || !S(c.hug) || !T(c.momentThemes) || !T(c.reasonThemes) || !Array.isArray(c.chips))
    return res.status(400).json({ error: 'Invalid data' });
  save(c); res.json({ ok: true });
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => console.log(`Site: http://localhost:${PORT}   Admin: http://localhost:${PORT}/admin`));
if (PASS === 'admin123') console.log('WARNING: default admin password in use. Set ADMIN_PASSWORD.');
