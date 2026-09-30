// Generates self-hosted GitHub stat cards (no third-party services).
// Output: assets/stats.svg, assets/top-langs.svg, assets/streak.svg, assets/activity.svg
// Env: GH_TOKEN (required), GH_LOGIN (default DJ-Joshi11), OUT_DIR (default assets),
//      MOCK_FILE (optional: path to JSON with pre-fetched data, for local testing)
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const LOGIN = process.env.GH_LOGIN || 'DJ-Joshi11';
const TOKEN = process.env.GH_TOKEN;
const OUT = process.env.OUT_DIR || 'assets';
const MOCK = process.env.MOCK_FILE;
const HIDE_LANGS = new Set(['Jupyter Notebook']); // languages to leave out of the top-langs card
const LANGS_COUNT = 8;
const ACTIVITY_DAYS = 31;

const T = {
  bg: '#1a1510', stroke: '#2a2017', title: '#f5c451', icon: '#d89a2e',
  text: '#cdbb98', num: '#f7ecd6', muted: '#998a6a', grid: '#2a2017',
};
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif";

// ---------------------------------------------------------------- data
async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors || json)}`);
  return json.data;
}

async function fetchData() {
  const { user } = await gql(`query($login:String!){ user(login:$login){
      login createdAt
      pullRequests{ totalCount } issues{ totalCount }
      repositoriesContributedTo(first:1, contributionTypes:[COMMIT,ISSUE,PULL_REQUEST,REPOSITORY]){ totalCount }
    } }`, { login: LOGIN });

  const repos = [];
  let after = null;
  do {
    const d = await gql(`query($login:String!,$after:String){ user(login:$login){
        repositories(first:100, after:$after, ownerAffiliations:OWNER, isFork:false){
          pageInfo{ hasNextPage endCursor }
          nodes{ stargazerCount languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } } }
        } } }`, { login: LOGIN, after });
    const r = d.user.repositories;
    repos.push(...r.nodes);
    after = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null;
  } while (after);

  // contributionsCollection spans at most 1 year, so walk from account creation to now
  const days = {};
  let commits = 0;
  const now = new Date();
  let from = new Date(user.createdAt);
  while (from < now) {
    let to = new Date(from.getTime() + 364 * 86400000);
    if (to > now) to = now;
    const d = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
        contributionsCollection(from:$from, to:$to){
          totalCommitContributions restrictedContributionsCount
          contributionCalendar{ weeks{ contributionDays{ date contributionCount } } }
        } } }`, { login: LOGIN, from: from.toISOString(), to: to.toISOString() });
    const c = d.user.contributionsCollection;
    commits += c.totalCommitContributions + c.restrictedContributionsCount;
    for (const w of c.contributionCalendar.weeks)
      for (const day of w.contributionDays) days[day.date] = day.contributionCount;
    from = new Date(to.getTime() + 1000);
  }

  return {
    login: user.login,
    stars: repos.reduce((s, r) => s + r.stargazerCount, 0),
    commits,
    prs: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    contributedTo: user.repositoriesContributedTo.totalCount,
    repoCount: repos.length,
    repos,
    days,
  };
}

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dparse = (s) => new Date(s + 'T00:00:00Z');
const dshort = (s) => { const d = dparse(s); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const dlong = (s) => `${dshort(s)}, ${dparse(s).getUTCFullYear()}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

function card(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"${title ? ` aria-label="${esc(title)}"` : ''}>
<style>text{font-family:${FONT}}</style>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="${T.bg}" stroke="${T.stroke}"/>
${body}
</svg>
`;
}

// Octicons (16px)
const ICONS = {
  star: 'M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z',
  commit: 'M1.643 3.143L.427 1.927A.25.25 0 000 2.104V5.75c0 .138.112.25.25.25h3.646a.25.25 0 00.177-.427L2.715 4.215a6.5 6.5 0 11-1.18 4.458.75.75 0 10-1.493.154 8.001 8.001 0 101.6-5.684zM7.75 4a.75.75 0 01.75.75v2.992l2.028.812a.75.75 0 01-.557 1.392l-2.5-1A.75.75 0 017 8.25v-3.5A.75.75 0 017.75 4z',
  pr: 'M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z',
  issue: 'M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z',
  repo: 'M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z',
};

// ---------------------------------------------------------------- streak math
function streaks(days) {
  const today = todayISO();
  const dates = Object.keys(days).filter((d) => d <= today).sort();
  let total = 0, longest = { len: 0, start: null, end: null }, run = 0, runStart = null;
  for (const d of dates) {
    const c = days[d];
    total += c;
    if (c > 0) {
      if (run === 0) runStart = d;
      run++;
      if (run > longest.len) longest = { len: run, start: runStart, end: d };
    } else run = 0;
  }
  // current streak: today counts if active; if today is empty, the streak up to yesterday still stands
  let i = dates.length - 1;
  if (i >= 0 && dates[i] === today && days[today] === 0) i--;
  let cur = { len: 0, start: null, end: null };
  while (i >= 0 && days[dates[i]] > 0) {
    cur.len++;
    cur.start = dates[i];
    if (!cur.end) cur.end = dates[i];
    i--;
  }
  return { total, first: dates[0], cur, longest };
}

// ---------------------------------------------------------------- cards
function statsCard(d) {
  const rows = [
    ['star', 'Total Stars Earned', d.stars],
    ['commit', 'Total Commits', d.commits],
    ['pr', 'Total PRs', d.prs],
    ['issue', 'Total Issues', d.issues],
    ['repo', 'Contributed to (last year)', d.contributedTo],
  ];
  const body = rows.map(([ic, label, val], i) => {
    const y = 62 + i * 26;
    return `<g transform="translate(25,${y})">
  <path transform="translate(0,-12)" fill="${T.icon}" d="${ICONS[ic]}"/>
  <text x="25" y="0" fill="${T.text}" font-size="14" font-weight="600">${label}:</text>
  <text x="235" y="0" fill="${T.num}" font-size="14" font-weight="700">${fmt(val)}</text>
</g>`;
  }).join('\n');
  // ring: public repo count
  const cx = 400, cy = 105, r = 42;
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T.icon}" stroke-opacity="0.2" stroke-width="6"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${T.title}" stroke-width="6" stroke-linecap="round"/>
<text x="${cx}" y="${cy + 2}" text-anchor="middle" fill="${T.num}" font-size="24" font-weight="800">${fmt(d.repoCount)}</text>
<text x="${cx}" y="${cy + 20}" text-anchor="middle" fill="${T.muted}" font-size="11">repos</text>`;
  return card(495, 195, `<text x="25" y="35" fill="${T.title}" font-size="18" font-weight="600">${esc(d.login)}'s GitHub Stats</text>
${body}
${ring}`, `${d.login}'s GitHub stats`);
}

function langsCard(d) {
  const totals = {};
  for (const r of d.repos)
    for (const e of r.languages.edges) {
      if (HIDE_LANGS.has(e.node.name)) continue;
      totals[e.node.name] ??= { size: 0, color: e.node.color || '#858585' };
      totals[e.node.name].size += e.size;
    }
  const langs = Object.entries(totals).sort((a, b) => b[1].size - a[1].size).slice(0, LANGS_COUNT);
  const sum = langs.reduce((s, [, v]) => s + v.size, 0) || 1;
  const W = 350, barW = W - 50;
  let x = 0;
  const bar = langs.map(([, v]) => {
    const w = (v.size / sum) * barW;
    const seg = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${v.color}"/>`;
    x += w;
    return seg;
  }).join('');
  const legend = langs.map(([name, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 25 + col * 155, ly = 88 + row * 24;
    return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${v.color}"/>
<text x="${lx + 16}" y="${ly}" fill="${T.text}" font-size="12" font-weight="500">${esc(name)} <tspan fill="${T.muted}">${((v.size / sum) * 100).toFixed(1)}%</tspan></text>`;
  }).join('\n');
  const rows = Math.ceil(langs.length / 2);
  const H = Math.max(195, 88 + rows * 24 + 10);
  return card(W, H, `<text x="25" y="35" fill="${T.title}" font-size="18" font-weight="600">Most Used Languages</text>
<clipPath id="bar"><rect x="25" y="52" width="${barW}" height="8" rx="4"/></clipPath>
<g clip-path="url(#bar)"><g transform="translate(25,52)">${bar || `<rect width="${barW}" height="8" fill="${T.stroke}"/>`}</g></g>
${legend || `<text x="25" y="92" fill="${T.muted}" font-size="12">No language data yet</text>`}`, 'Most used languages');
}

function streakCard(d) {
  const s = streaks(d.days);
  const W = 495, H = 195, colW = W / 3;
  const range = (st) => (st.len ? (st.start === st.end ? dshort(st.start) : `${dshort(st.start)} - ${dshort(st.end)}`) : 'No streak yet');
  const cx = colW * 1.5, cy = 76;
  const side = (x, num, label, sub) => `<text x="${x}" y="84" text-anchor="middle" fill="${T.num}" font-size="28" font-weight="700">${num}</text>
<text x="${x}" y="120" text-anchor="middle" fill="${T.text}" font-size="14">${label}</text>
<text x="${x}" y="145" text-anchor="middle" fill="${T.muted}" font-size="12">${sub}</text>`;
  const body = `${side(colW / 2, s.total.toLocaleString('en-US'), 'Total Contributions', s.first ? `${dlong(s.first)} - Present` : '')}
<line x1="${colW}" y1="28" x2="${colW}" y2="168" stroke="${T.stroke}"/>
<line x1="${colW * 2}" y1="28" x2="${colW * 2}" y2="168" stroke="${T.stroke}"/>
<mask id="ringmask"><rect width="${W}" height="${H}" fill="white"/><circle cx="${cx}" cy="${cy - 40}" r="13" fill="black"/></mask>
<circle cx="${cx}" cy="${cy}" r="40" fill="none" stroke="${T.icon}" stroke-width="5" mask="url(#ringmask)"/>
<path transform="translate(${cx - 8},${cy - 52}) scale(0.6667)" fill="${T.title}" d="M12 2c.5 3.5-1.5 5.5-3 7.5C7.5 11.5 6 13.5 6 16a6 6 0 0012 0c0-2.5-1-4.5-2.5-6 .2 1.6-.3 3-1.5 3.8.3-3.6-.7-8.3-2-11.8z"/>
<text x="${cx}" y="${cy + 10}" text-anchor="middle" fill="${T.num}" font-size="28" font-weight="700">${s.cur.len}</text>
<text x="${cx}" y="140" text-anchor="middle" fill="${T.title}" font-size="14" font-weight="700">Current Streak</text>
<text x="${cx}" y="163" text-anchor="middle" fill="${T.muted}" font-size="12">${range(s.cur)}</text>
${side(colW * 2.5, s.longest.len, 'Longest Streak', range(s.longest))}`;
  return card(W, H, body, 'Contribution streak');
}

function activityCard(d) {
  const today = dparse(todayISO());
  const pts = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const iso = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    pts.push({ iso, c: d.days[iso] ?? 0 });
  }
  const W = 900, H = 300, L = 55, R = 25, Tp = 55, B = 45;
  const pw = W - L - R, ph = H - Tp - B;
  const maxRaw = Math.max(...pts.map((p) => p.c), 1);
  const step = Math.max(1, Math.ceil(maxRaw / 4));
  const yMax = step * 4;
  const X = (i) => L + (i / (pts.length - 1)) * pw;
  const Y = (v) => Tp + ph - (v / yMax) * ph;
  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = k * step, y = Y(v).toFixed(1);
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${T.grid}" stroke-dasharray="${k ? '3 4' : '0'}"/>
<text x="${L - 10}" y="${+y + 4}" text-anchor="end" fill="${T.muted}" font-size="11">${v}</text>\n`;
  }
  const xl = pts.map((p, i) => (i % 5 === 0 || i === pts.length - 1)
    ? `<text x="${X(i).toFixed(1)}" y="${H - B + 20}" text-anchor="middle" fill="${T.muted}" font-size="11">${dshort(p.iso)}</text>` : '').join('');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.c).toFixed(1)}`).join(' ');
  const area = `${line} L${X(pts.length - 1).toFixed(1)},${Y(0)} L${X(0).toFixed(1)},${Y(0)} Z`;
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.c).toFixed(1)}" r="3" fill="${T.title}"/>`).join('');
  const sum = pts.reduce((s, p) => s + p.c, 0);
  return card(W, H, `<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${T.title}" stop-opacity="0.35"/><stop offset="1" stop-color="${T.title}" stop-opacity="0"/></linearGradient></defs>
<text x="${L - 30}" y="34" fill="${T.title}" font-size="18" font-weight="600">Contribution Activity</text>
<text x="${W - R}" y="34" text-anchor="end" fill="${T.muted}" font-size="12">${sum} contributions in the last ${ACTIVITY_DAYS} days</text>
${grid}${xl}
<path d="${area}" fill="url(#fill)"/>
<path d="${line}" fill="none" stroke="${T.icon}" stroke-width="2.2" stroke-linejoin="round"/>
${dots}`, 'Contribution activity graph');
}

// ---------------------------------------------------------------- main
const data = MOCK ? JSON.parse(await readFile(MOCK, 'utf8')) : (TOKEN ? await fetchData() : (() => { throw new Error('GH_TOKEN is not set'); })());
await mkdir(OUT, { recursive: true });
await Promise.all([
  writeFile(`${OUT}/stats.svg`, statsCard(data)),
  writeFile(`${OUT}/top-langs.svg`, langsCard(data)),
  writeFile(`${OUT}/streak.svg`, streakCard(data)),
  writeFile(`${OUT}/activity.svg`, activityCard(data)),
]);
const s = streaks(data.days);
console.log(`Wrote cards for ${data.login}: ${s.total} contributions, streak ${s.cur.len} (longest ${s.longest.len}), ${data.repoCount} repos`);
