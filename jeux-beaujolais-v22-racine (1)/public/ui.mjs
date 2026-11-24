// Composants d'interface partagés : chips, carte de règle, chrono, podium, classement animé, confettis.
import { esc, now, plural } from './core.mjs';
import { games, ruleNames, ruleText, ruleExample, standings, themes, levels, perfLabel, teamSymbol } from './games.mjs';

export const chip = (p, extra = '') => `<span class="chip ${extra}" style="--c:${esc(p.color)}"><i></i>${esc(p.name)}</span>`;

export function ruleCard(gameId, rule, roundId, { big = false, practice = false, theme, level } = {}) {
  const g = games[gameId];
  const ex = rule && rule !== 'classic' ? ruleExample(gameId, rule) : '';
  const variant = rule && rule !== 'classic'
    ? `<div class="variant"><b>Variante · ${esc(ruleNames(rule))}</b><span>${esc(ruleText(gameId, rule))}</span>${ex ? `<span class="ex">Exemple : ${esc(ex)}</span>` : ''}</div>` : '';
  const extra = gameId === 'truefalse' && theme ? `<div class="rule-line"><span class="tag">Thème</span><p>${theme === 'vote' ? 'Vote des joueurs' : esc(themes[theme] || theme)}</p></div>`
    : gameId === 'words' && level ? `<div class="rule-line"><span class="tag">Niveau</span><p>${esc(levels[level] || level)}</p></div>` : '';
  return `<article class="rule-card ${big ? 'big' : ''}">
    <div class="rule-head"><span class="icon" aria-hidden="true">${g.icon}</span><h2>${esc(g.name)}</h2>${practice ? '<span class="badge">Manche d’essai · non comptée</span>' : ''}</div>
    <div class="rule-line"><span class="tag">Règle</span><p>${esc(g.how)}</p></div>
    <div class="rule-line"><span class="tag gold">Pour gagner</span><p>${esc(g.goal)}</p></div>
    <div class="rule-line"><span class="tag ex">Exemple</span><p>${esc(g.example)}</p></div>
    ${extra}
    ${variant}
  </article>`;
}

// Chrono en barre : la barre se vide, le chiffre est facultatif (jeux « sans chrono »).
export const timer = (id, withNumber = true) => `<div class="timer" id="${id}"><div class="timer-track"><div class="timer-fill"></div></div>${withNumber ? '<span class="timer-num"></span>' : ''}</div>`;
export function setTimer(id, from, until) {
  const el = document.getElementById(id);
  if (!el) return;
  const left = Math.max(0, until - now()), ratio = Math.min(1, left / Math.max(1, until - from));
  el.querySelector('.timer-fill').style.transform = `scaleX(${ratio})`;
  const total = Math.max(1, until - from);
  el.classList.toggle('hurry', left > 0 && left < Math.min(5000, total * 0.35));   // rouge sur la fin seulement, même pour les phases courtes
  const num = el.querySelector('.timer-num');
  if (num) num.textContent = `${Math.ceil(left / 1000)} s`;
  // Urgence : les 5 dernières secondes, le chiffre bat, et le bord de l'écran rougit (grand écran et téléphones).
  const urgent = left > 0 && left <= 5000 && total > 4000;
  el.classList.toggle('urgent', urgent);
  urgentTimers[urgent ? 'add' : 'delete'](id);
  document.body.classList.toggle('urgent', urgentTimers.size > 0 && Boolean(document.getElementById([...urgentTimers][0])));
  const sec = Math.ceil(left / 1000);
  if (urgent && sec <= 3 && lastBuzz !== `${id}/${until}/${sec}`) { lastBuzz = `${id}/${until}/${sec}`; navigator.vibrate?.(40); }
}
const urgentTimers = new Set();
let lastBuzz = '';

// Performance lisible d'une ligne de résultat.
export function perf(round, row) {
  if (!row.played) return 'Absent';
  if (round.game === 'reaction') return row.raw ? `${row.raw} ms` : 'Aucun temps';
  if (round.game === 'arena') return round.stage?.survivors?.includes(row.pid) ? 'Survivant' : `Éliminé au tour ${row.raw}`;
  if (round.game === 'lucky') return `${plural(row.raw, 'tour')} survécu${row.raw > 1 ? 's' : ''}`;
  if (round.game === 'memory') return plural(row.raw, 'fruit') + (row.bonus ? ' · ⚡ bonus +1 (le plus rapide)' : '');
  if (round.game === 'cups') return round.rule === 'survie' ? `${row.raw} tour${row.raw > 1 ? 's' : ''} réussi${row.raw > 1 ? 's' : ''}` : `${row.raw} / 10 séries · ${row.score} pts`;
  if (round.game === 'barrels') return plural(row.raw, 'tape') + (row.score !== row.raw ? ` · ${row.score} pts` : '');
  if (round.game === 'odd') return plural(row.raw, 'intrus', 'intrus');
  const g = games[round.game];
  return `${row.raw} ${g.unit}`;
}

export function podium(round, players) {
  const rows = round.results.filter(r => r.played);
  const top = [rows.find(r => r.rank === 2) ? rows.filter(r => r.rank === 2) : [], rows.filter(r => r.rank === 1), rows.filter(r => r.rank === 3)];
  const step = (list, place) => `<div class="step step-${place}">
      <div class="who">${list.slice(0, 3).map(r => `<div class="podium-name">${chip(r)}<small>${esc(perf(round, r))}</small></div>`).join('') || '<div class="podium-name empty">—</div>'}${list.length > 3 ? `<div class="podium-more">+ ${list.length - 3} ex æquo</div>` : ''}</div>
      <div class="block"><span class="place">${place}</span>${list.length ? `<span class="pts">+${list[0].points}</span>` : ''}</div>
    </div>`;
  const rest = round.results.filter(r => !r.played || r.rank > 3);
  return `<div class="podium">${step(top[0], 2)}${step(top[1], 1)}${step(top[2], 3)}</div>
    ${rest.length ? `<ol class="result-rest">${rest.map(r => `<li><span class="rank">${r.rank ?? '–'}</span>${chip(r)}<span class="perf">${esc(perf(round, r))}</span><span class="pts">+${r.points}</span></li>`).join('')}</ol>` : ''}`;
}

// Équipes : « Team Or : Erika, Jad… » (décompte et écran de préparation).
export function teamLinesHTML(teams, players) {
  if (!teams?.length) return '';
  const name = pid => esc(players.find(p => p.pid === pid)?.name || '?');
  return `<div class="team-lines">${teams.map(t => `<p style="--c:${esc(t.color)}"><b><i></i>${teamSymbol(t.name)} ${esc(t.name)}</b> : ${t.members.map(name).join(', ') || '—'}</p>`).join('')}</div>`;
}

// Podium des trois meilleures équipes (manche en équipes), à droite du tableau des équipes.
export function teamPodiumHTML(round) {
  const top = [...(round.teamResults || [])].filter(t => t.rank).sort((a, b) => a.rank - b.rank).slice(0, 3);
  if (!top.length) return '<p class="muted">Pas de score d’équipe.</p>';
  return `<ol class="team-podium">${top.map(t => `<li style="--c:${esc(t.color)}"><span class="place">${t.rank}</span>
      <b><i></i>${teamSymbol(t.name)} ${esc(t.name)}</b><span class="pts">+${t.bonus || 0} bonus</span></li>`).join('')}</ol>`;
}

// Résultats par équipe : rang, performance brute, points individuels et bonus, sur deux colonnes.
export function teamResultsHTML(round, players) {
  const name = pid => esc(players.find(p => p.pid === pid)?.name || '?');
  const raw = pid => (round.results || []).find(r => r.pid === pid);
  const lower = round.game === 'reaction';
  const rows = [...(round.teamResults || [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return `<ol class="team-results">${rows.map(t => {
    // Meilleur joueur de l'équipe (⭐) : la plus forte contribution (le temps le plus court pour Top départ).
    const played = t.members.filter(pid => raw(pid)?.played && (!lower || raw(pid).raw > 0));
    const best = played.sort((a, b) => lower ? raw(a).raw - raw(b).raw : raw(b).raw - raw(a).raw)[0];
    const members = [...t.members].sort((a, b) => (a === best ? -1 : b === best ? 1 : 0));
    return `<li style="--c:${esc(t.color)}"><span class="rank">${t.rank ?? '–'}</span>
      <div class="team-body"><div class="team-head"><b><i></i>${teamSymbol(t.name)} ${esc(t.name)}</b><span class="team-total">${esc(perfLabel(round.game, t.perf))}</span>${t.bonus ? `<span class="team-bonus">+${t.bonus} au général</span>` : '<span class="team-bonus none">sans bonus</span>'}</div>
      <ul class="team-members">${members.map(pid => `<li class="${pid === best ? 'mvp' : ''}"><span>${pid === best ? '⭐ ' : ''}${name(pid)}</span><b>${esc(perfLabel(round.game, raw(pid)?.raw ?? 0))}</b></li>`).join('')}</ul></div></li>`;
  }).join('')}</ol>`;
}

// Classement d'un jeu : le score du jeu (cumulé sur la soirée, meilleur temps pour Top départ) et, entre parenthèses,
// les points que ce jeu a apportés au classement général.
export function gameBoardHTML(players, game, perfs = {}, points = {}, me = null, limit = Infinity) {
  const lower = game === 'reaction';
  const rows = players.filter(p => p.pid in perfs || p.pid in points).map(p => ({ ...p, perf: perfs[p.pid], pts: points[p.pid] || 0 }))
    .sort((a, b) => (a.perf == null) - (b.perf == null) || (lower ? a.perf - b.perf : b.perf - a.perf) || b.pts - a.pts || a.name.localeCompare(b.name, 'fr'));
  rows.forEach((r, i) => { r.rank = r.perf == null ? '–' : i && rows[i - 1].perf === r.perf ? rows[i - 1].rank : i + 1; });
  if (!rows.length) return '<p class="muted">Pas encore de score pour ce jeu.</p>';
  const shown = rows.filter((r, i) => i < limit || r.pid === me);
  return `<ol class="standings game-board ${shown.length > 6 ? 'two-cols' : ''}">${shown.map(r => `<li data-pid="${esc(r.pid)}" class="${r.pid === me ? 'me' : ''}" style="--c:${esc(r.color)}">
    <span class="rank">${r.rank}</span><span class="name"><i></i>${esc(r.name)}</span><span class="total"><span class="num">${esc(perfLabel(game, r.perf))}</span><small class="to-general">(+${r.pts} au général)</small></span></li>`).join('')}</ol>${rows.length > shown.length ? `<p class="more-rows">+ ${rows.length - shown.length} autres joueurs</p>` : ''}`;
}

// Classement général. Avec des équipes : un bloc par équipe (total de l'équipe = somme des totaux de ses membres),
// équipes triées par points, membres triés par points ; sinon, la liste habituelle.
// `gains` : points gagnés à la dernière manche (affichés tout de suite, sans dépendre d'une animation).
export function generalBoardHTML(players, totals, { bonuses = {}, gains = {}, teams = null, me = null, limit = Infinity, compact = false, before = null } = {}) {
  if (!teams?.length) return standingsHTML(players, totals, me, limit, { bonuses, gains, before });
  const all = standings(players, totals), prevRank = rankMap(players, before);
  const row = r => generalRow(r, all, { me, gains, bonuses, prevRank });
  const groups = teams.map(t => ({ ...t, rows: all.filter(r => t.members.includes(r.pid)) }));
  const loose = all.filter(r => !teams.some(t => t.members.includes(r.pid)));
  if (loose.length) groups.push({ id: 'none', name: 'Sans équipe', color: '#9a8a94', rows: loose });
  for (const g of groups) g.total = g.rows.reduce((a, r) => a + r.total, 0);
  groups.sort((a, b) => b.total - a.total);
  return `<div class="general-teams ${compact ? 'compact' : ''}">${groups.filter(g => g.rows.length).map((g, i) => `<section class="gt" style="--c:${esc(g.color)}">
    <header><span class="gt-rank">${g.id === 'none' ? '' : i + 1}</span><b><i></i>${teamSymbol(g.name)} ${esc(g.name)}</b><span class="gt-total">${g.total} pts</span></header>
    ${compact && !g.rows.some(r => r.pid === me) ? '' : `<ol class="standings">${g.rows.map(row).join('')}</ol>`}</section>`).join('')}</div>`;
}

// Classement général animé « façon course » : on affiche l'ordre d'avant, puis chacun glisse à sa nouvelle place.
// limit : nombre de lignes affichées (les autres sont résumées), pour rester lisible avec beaucoup de joueurs.
// Classement : `bonuses` (bonus d'équipe cumulés) s'affiche en rouge sous le total ; `zeroDash` : sans point, pas de rang.

// Une ligne de classement général : rang (avec « ex æquo »), flèche de progression depuis la manche précédente,
// gain de la manche, total, bonus d'équipe, et pour ta ligne l'écart avec le joueur juste devant.
function generalRow(r, all, { me, gains = {}, bonuses = {}, prevRank = null, zeroDash = false }) {
  const tie = all.filter(x => x.rank === r.rank).length > 1;
  const rank = zeroDash && !r.total ? '–' : r.rank;
  const was = prevRank?.get(r.pid);
  const move = was && r.total ? (was > r.rank ? `<span class="move up" title="Gagne ${was - r.rank} place${was - r.rank > 1 ? 's' : ''}">▲${was - r.rank}</span>` : was < r.rank ? `<span class="move down" title="Perd ${r.rank - was} place${r.rank - was > 1 ? 's' : ''}">▼${r.rank - was}</span>` : '') : '';
  const ahead = r.pid === me && r.rank > 1 ? all.filter(x => x.total > r.total).at(-1) : null;
  const gap = ahead ? `<small class="gap">à ${ahead.total - r.total} pt${ahead.total - r.total > 1 ? 's' : ''} de ${esc(ahead.name)}</small>` : '';
  return `<li data-pid="${esc(r.pid)}" class="${r.pid === me ? 'me' : ''}" style="--c:${esc(r.color)}">
    <span class="rank">${rank}${tie && rank !== '–' ? '<small class="tie">ex æquo</small>' : ''}</span><span class="name"><i></i>${esc(r.name)}${move}${gap}</span>${gains[r.pid] ? `<span class="gain shown">+${gains[r.pid]}</span>` : '<span class="gain"></span>'}<span class="total"><span class="num">${r.total}<small> pt${r.total > 1 ? 's' : ''}</small></span>${bonuses?.[r.pid] ? ` <em class="bonus-red">dont +${bonuses[r.pid]} équipe</em>` : ''}</span></li>`;
}
const rankMap = (players, before) => before ? new Map(standings(players, before).filter(r => r.total > 0).map(r => [r.pid, r.rank])) : null;

export function standingsHTML(players, totals, me, limit = Infinity, { bonuses = null, zeroDash = false, gains = {}, before = null } = {}) {
  const all = standings(players, totals), prevRank = rankMap(players, before);
  const rows = all.filter((r, i) => i < limit || r.pid === me);
  return `<ol class="standings">${rows.map(r => generalRow(r, all, { me, gains, bonuses, prevRank, zeroDash })).join('')}</ol>${all.length > rows.length ? `<p class="more-rows">+ ${all.length - rows.length} autres joueurs</p>` : ''}`;
}

export function animateStandings(list, players, before, after, delay = 900) {
  if (!list) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    if (!list.isConnected) return;
    const items = new Map([...list.children].map(li => [li.dataset.pid, li]));
    const first = new Map([...items].map(([pid, li]) => [pid, li.getBoundingClientRect().top]));
    const oldRank = new Map([...items].map(([pid, li]) => [pid, Number(li.querySelector('.rank').textContent)]));
    const rows = standings(players, after);
    // Pas de flèches tant que personne n'avait de points (tout le monde était ex æquo).
    const ranked = Object.values(before || {}).some(v => v > 0);
    for (const r of rows) {
      const li = items.get(r.pid);
      if (!li) continue;
      list.appendChild(li);
      li.querySelector('.rank').textContent = r.rank;
      const gain = r.total - (before?.[r.pid] || 0);
      if (gain) { li.querySelector('.gain').textContent = `+${gain}`; li.classList.add('gained'); }
      countUp(li.querySelector('.total'), before?.[r.pid] || 0, r.total, reduce ? 0 : 1100);
      const moved = oldRank.get(r.pid) - r.rank;
      li.classList.toggle('up', ranked && moved > 0);
      li.classList.toggle('down', ranked && moved < 0);
    }
    if (reduce) return;
    for (const [pid, li] of items) {
      const dy = first.get(pid) - li.getBoundingClientRect().top;
      if (!dy) continue;
      li.style.transition = 'none';
      li.style.transform = `translateY(${dy}px)`;
      li.getBoundingClientRect();
      li.style.transition = '';
      li.style.transform = '';
    }
  }, delay);
}

function countUp(el, from, to, ms) {
  if (!ms || from === to) { el.textContent = to; return; }
  const start = performance.now();
  const step = t => {
    const k = Math.min(1, (t - start) / ms), eased = 1 - (1 - k) ** 3;
    el.textContent = Math.round(from + (to - from) * eased);
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function confetti(count = 70) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  const shades = ['#f6cf7a', '#e8b45a', '#fff1c9', '#c98f2e', '#e8455f'];
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = shades[i % shades.length];
    s.style.animationDelay = Math.random() * 0.8 + 's';
    s.style.animationDuration = 2.2 + Math.random() * 1.6 + 's';
    s.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    s.style.setProperty('--x', (Math.random() * 30 - 15) + 'vw');
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 4500);
}

// Petit retour flottant (+1, −1) au-dessus d'un élément.
export function floatText(anchor, text, kind = 'good') {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = `float ${kind}`;
  el.textContent = text;
  el.style.left = r.left + r.width / 2 + 'px';
  el.style.top = r.top + r.height * 0.35 + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

export function flash(el, kind) {
  if (!el) return;
  el.classList.remove('flash-good', 'flash-bad');
  void el.offsetWidth;
  el.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
}

// Encart commun (accueil du téléphone et écran organisateur) : comment les points arrivent au classement général.
export function pointsHelpHTML() {
  return `<details class="points-help"><summary>Comment gagner des points ?</summary><ul>
    <li><b>Solo</b> : des points selon ton rang dans la manche.</li>
    <li><b>Équipes</b> : seul le bonus de l’équipe compte. Avec 3 équipes : +3, +2, +1 par membre.</li>
    <li><b>Manche d’essai</b> : aucun point.</li></ul></details>`;
}

// Nettoyage : si l'écran a changé (chrono disparu), on retire l'effet d'urgence.
setInterval(() => {
  for (const id of [...urgentTimers]) {
    const el = document.getElementById(id);
    if (!el || !el.classList.contains('urgent')) urgentTimers.delete(id);
  }
  if (!urgentTimers.size) document.body.classList.remove('urgent');
}, 400);
