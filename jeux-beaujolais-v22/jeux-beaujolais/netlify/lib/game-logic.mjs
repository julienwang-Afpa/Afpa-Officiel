import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { colors, duration, games, pointsFor, drawRule, themes, levels, TF_COUNT, MEMORY_MAX, seeded, cupsTurn, cupsTimeline, REACTION_TRY, REACTION_TRIES, TEAMS, TEAM_MAX, TEAM_BONUS, teamLowerWins } from '../../public/games.mjs';
import { stagedFor, arenaScores, quizThemes } from './staged.mjs';

const COUNTDOWN = 6000;   // décompte avant chaque manche : la règle est rappelée pendant ce temps
const GRACE = 2500;       // délai pour recevoir les derniers scores
const SETTLE = 1000;      // AUDIT : marge entre la clôture des scores et le calcul du classement (écritures en vol)
const HOST_LATE = 2500;   // AUDIT : au-delà, un téléphone fait avancer la manche à la place de l'écran animateur
// Pas de limite fixe de joueurs : voir GUIDE.md pour les limites pratiques observées.

const json = (status, data) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const fail = (status, error) => json(status, { error });
const validToken = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const matches = (a, b) => validToken(a) && validToken(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const read = (store, key) => store.getWithMetadata(key, { type: 'json' });
const save = (store, key, entry, data) => store.setJSON(key, data, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
const identity = ({ pid, name, color, bot, helper }) => ({ pid, name, color, ...(bot ? { bot: true } : {}), ...(helper ? { helper: true } : {}) });
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Quiz : thèmes encore jouables (un thème joué ne revient pas dans la soirée) et dépouillement du vote des joueurs.
const themesLeft = st => quizThemes.filter(t => !(st.playedThemes || []).includes(t));
// Vote : tous les thèmes encore jouables sont proposés (un thème joué ce soir ne revient pas).
const voteOptions = st => themesLeft(st);
// Roulette : tirage parmi les thèmes qui ont reçu au moins un vote, chaque vote = une part de la roulette.
// Sans aucun vote, la roulette tourne sur tous les thèmes encore jouables.
function voteWinner(st, votes) {
  const left = voteOptions(st), tally = {};
  for (const t of Object.values(votes || {})) if (left.includes(t)) tally[t] = (tally[t] || 0) + 1;
  const wheel = Object.keys(tally).length ? Object.entries(tally).map(([theme, n]) => ({ theme, votes: n })) : left.map(theme => ({ theme, votes: 0 }));
  if (!wheel.length) return { theme: 'all', votes: 0, wheel: [] };
  const weight = w => w.votes || 1, total = wheel.reduce((a, w) => a + weight(w), 0);
  let ticket = randomInt(total), pick = wheel[0];
  for (const w of wheel) { if (ticket < weight(w)) { pick = w; break; } ticket -= weight(w); }
  return { theme: pick.theme, votes: pick.votes, wheel };
}

// AUDIT : plafonds plausibles par jeu (un humain ne peut pas faire mieux) ; au-delà, le score est refusé.
export function scoreAllowed(round, { raw, score, tb }) {
  const sec = (round.endAt - round.startAt) / 1000;
  switch (round.game) {
    case 'barrels': { const max = Math.ceil(sec * 1000 / 45); return raw <= max && score <= 2 * max && score >= -max; }
    case 'odd': { const max = Math.ceil(sec * 4); return raw <= max && score <= max * 2 && score >= 0; }
    case 'maths': case 'words': { const max = Math.ceil(sec * 2); return raw <= max && score <= max * 2 && score >= 0; }
    case 'cups': return raw <= 10 && score <= 550 && score >= 0 && score % 10 === 0;
    case 'reaction': return raw === 0 ? score === 0 : raw >= 100 && raw <= REACTION_TRY && score === 10000 - raw;
    case 'memory': return raw <= MEMORY_MAX && score === raw && (tb == null || tb >= 0);
    default: return true;
  }
}

// ---------- Vue envoyée aux navigateurs ----------
function publicRound(round) {
  if (!round) return null;
  const { questions, ...rest } = round;
  // len : durée de la phase en cours, pour que les barres de temps soient justes sur tous les écrans.
  if (round.stage && stagedFor(round.game, round.rule)) rest.stage = { ...stagedFor(round.game, round.rule).publicStage(round), len: stagedFor(round.game, round.rule).stageLength(round.stage, round.rule) };
  // Vrai ou faux : les points ne bougent qu'au moment de la réponse, pour ne pas la trahir.
  if (round.game === 'truefalse' && !round.results && round.stage?.phase !== 'answer') rest.tally = round.shownTally || {};
  if (round.game === 'truefalse' && round.stage?.phase === 'answer') rest.tally = round.tally;
  return rest;
}

// Le Bon Tonneau : pendant le choix, seuls les poseurs voient les cases réservées (avec le nom de chaque coéquipier).
function withSecrets(pub, round, pid, isHost) {
  if (round.game === 'lucky' && round.stage?.phase === 'choose' && pid && round.stage.posers?.includes(pid) && pub.stage) pub.stage = { ...pub.stage, traps: round.stage.traps };
  return pub;
}

function view(st, now, pid, isHost) {
  return {
    now,
    players: Object.values(st.roster).map(identity),
    joined: Boolean(pid && st.roster[pid]),
    series: st.series, pending: st.pending && st.series?.game === 'truefalse' ? { ...st.pending, voteOptions: voteOptions(st) } : st.pending, totals: st.totals, byGame: st.byGame || {},
    teams: st.teams || null,
    duel: st.duel || null,
    bonusTotals: st.bonusTotals || {},
    perfByGame: st.perfByGame || {},
    round: st.round && withSecrets({ ...publicRound(st.round), playing: Boolean(pid && st.round.ids.includes(pid)) }, st.round, pid, isHost),
    revision: isHost ? st.revision || 0 : undefined,
    playedThemes: st.playedThemes || [],
    history: isHost ? st.history || [] : undefined,
  };
}

// ---------- Robots de test ----------
// Les robots ne simulent pas de téléphone : le serveur leur invente un résultat plausible (jeux individuels)
// ou un choix (jeux pilotés). Ils servent à remplir les classements et à tester l'enchaînement des écrans.
export function botScore(round, pid) {
  const r = seeded(round.id + pid), between = (a, b) => a + Math.floor(r() * (b - a + 1));
  const factor = round.rule === 'sprint' ? 0.5 : 1;
  switch (round.game) {
    case 'barrels': { const raw = Math.round(between(55, 125) * factor * (round.rule === 'lights' ? 1.3 : 1)); return { raw, score: round.rule === 'lights' ? raw - between(0, 12) : raw + (round.rule === 'turbo' ? between(5, 20) : 0) }; }
    case 'odd': { const raw = Math.round(between(8, 32) * factor); return { raw, score: raw + Math.floor(raw / 5) }; }
    case 'reaction': {
      const tries = [0, 1, 2].map(() => r() < 0.06 ? 'early' : between(230, 480)), valid = tries.filter(Number.isFinite);
      const raw = valid.length ? Math.min(...valid) : 0;
      return { raw, score: raw ? 10000 - raw : 0, tb: raw || undefined, tries };
    }
    case 'memory': { const raw = r() < 0.25 ? MEMORY_MAX : between(10, MEMORY_MAX - 1); return { raw, score: raw, tb: between(25000, 60000) }; }
    case 'maths': case 'words': { const raw = Math.round(between(6, 24) * factor); return { raw, score: raw }; }
    case 'cups': {
      let raw = 0, score = 0, tb = 0;
      for (let L = 1; L <= 10; L++) if (r() < 0.95 - L * 0.07) { raw++; score += 10 * L; tb += between(500, 2200); } else if (round.rule === 'sudden') break;
      return { raw, score, tb };
    }
    default: return { raw: 0, score: 0 };
  }
}
export function botPick(round, pid) {
  const s = round.stage, r = seeded(round.id + pid + s.step);
  if (round.game === 'truefalse') { const q = round.questions[s.step]; return r() < 0.7 ? q.answer : (q.answer + 1 + Math.floor(r() * 3)) % 4; }
  if (round.game === 'lucky') return s.phase === 'choose' ? Math.floor(r() * 16) : undefined;
  if (round.game === 'cups') { if (s.phase !== 'choose') return undefined; const plan = cupsTurn(round.id, s.turn - 1), ball = plan.final[plan.ball]; return r() < Math.max(0.45, 0.93 - 0.05 * s.turn) ? ball : (ball + 1) % plan.g; }
  return undefined;   // Bataille royale : le serveur place et vise au hasard les joueurs sans choix
}

// ---------- Classement d'une manche ----------
// N joueurs classés : N points au 1er, N − 1 au 2e… ; égalité = même rang et mêmes points ; score nul ou absent = 0 ; ×2 double.
export function rankRound(round, roster, players) {
  const subs = new Map(players.filter(p => p?.score?.round === round.id).map(p => [p.pid, p.score]));
  for (const pid of round.ids) if (roster[pid]?.bot && !stagedFor(round.game, round.rule)) subs.set(pid, { round: round.id, ...botScore(round, pid) });
  const arena = round.game === 'arena' ? arenaScores(round) : null;
  const entries = round.ids.filter(pid => roster[pid]).map(pid => {
    const base = identity(roster[pid]);
    if (arena) return { ...base, score: arena[pid], raw: arena[pid], played: true };
    if (stagedFor(round.game, round.rule)) {
      const score = round.tally[pid] || 0;
      return { ...base, score, raw: score, tb: round.game === 'lucky' ? -(round.kills?.[pid] || 0) : undefined, played: Boolean(round.played[pid]) || Boolean(roster[pid].bot) || round.game === 'lucky' };
    }
    const sub = subs.get(pid);
    return { ...base, score: sub?.score ?? 0, raw: sub?.raw ?? 0, tb: sub?.tb, tries: sub?.tries, played: Boolean(sub) };
  });
  // Le temps (tb) ne départage que les jeux où il compte : Mémoire Flash et bonneteau.
  const usesTb = round.game === 'memory' || round.game === 'lucky' || (round.game === 'cups' && round.rule !== 'survie');   // Bon Tonneau : à survie égale, le plus d'éliminations comme poseur
  const tb = e => usesTb ? (e.tb ?? Infinity) : 0;
  // Mode équipes : l'animateur en renfort compte pour son équipe, mais reste hors du classement individuel.
  const solo = entries.filter(e => !(round.mode === 'team' && e.helper));
  const ranked = solo.filter(e => e.played).sort((a, b) => b.score - a.score || tb(a) - tb(b));
  const absent = solo.filter(e => !e.played);
  const multiplier = round.rule === 'double' ? 2 : 1;
  ranked.forEach((e, i) => {
    const prev = ranked[i - 1];
    e.rank = prev && prev.score === e.score && tb(prev) === tb(e) ? prev.rank : i + 1;
    e.points = e.score > 0 ? pointsFor(e.rank, ranked.length, multiplier) : 0;
  });
  // Mémoire Flash : +1 point de classement au plus rapide parmi ceux qui ont tout réussi.
  if (round.game === 'memory') {
    const perfect = ranked.filter(e => e.raw >= MEMORY_MAX && Number.isFinite(e.tb));
    if (perfect.length) { const best = Math.min(...perfect.map(e => e.tb)); for (const e of perfect.filter(e => e.tb === best)) { e.bonus = 1; e.points += 1; } }
  }
  absent.forEach(e => { e.rank = null; e.points = 0; });
  const results = [...ranked, ...absent].map(e => ({ ...e, teamBonus: 0 }));
  const teams = round.mode === 'team' && round.teams ? teamRanking(round, entries, results) : null;
  return { results, teams };
}

// Classement par équipe : somme des performances des membres (Top départ : somme des meilleurs temps, la plus petite gagne).
// Bonus d'équipe : +2 à chaque membre de la 1re équipe, +1 à la 2e (à partir de 3 équipes). Il ne compte pas dans le classement par jeu.
// Top départ en équipes : score de l'équipe = somme des meilleurs temps de ses membres (le plus petit total gagne).
function teamRanking(round, entries, results) {
  const raw = new Map(entries.map(e => [e.pid, e.raw]));
  const byPid = new Map(results.map(r => [r.pid, r]));
  const lower = teamLowerWins(round.game);
  const rows = round.teams.map(t => {
    const values = t.members.map(pid => raw.get(pid) || 0);
    // Jeux de survie : l'équipe vaut son meilleur survivant (le dernier joueur en vie fait gagner son équipe).
    const perf = (round.game === 'lucky' || (round.game === 'cups' && round.rule === 'survie')) ? Math.max(0, ...values) : lower ? (values.filter(v => v > 0).reduce((a, b) => a + b, 0) || null) : values.reduce((a, b) => a + b, 0);
    return { id: t.id, name: t.name, color: t.color, members: t.members, perf, rank: null, bonus: 0 };
  });
  const key = r => (lower ? r.perf : -r.perf);
  const sorted = rows.filter(r => r.perf != null).sort((a, b) => key(a) - key(b));
  sorted.forEach((r, i) => { const prev = sorted[i - 1]; r.rank = prev && key(prev) === key(r) ? prev.rank : i + 1; });
  // Brief : avec N équipes classées, bonus par membre = N − rang + 1 (3 équipes : +3, +2, +1).
  const ranked = sorted.length;
  for (const r of sorted) {
    const scored = lower || r.perf > 0;
    if (scored) r.bonus = ranked - r.rank + 1;
    for (const pid of r.members) { const res = byPid.get(pid); if (res) res.teamBonus = r.bonus; }
  }
  return rows;
}

function complete(st, players) {
  const round = st.round;
  const { results, teams } = rankRound(round, st.roster, players);
  round.results = results;
  round.teamResults = teams;
  // Manche d'essai : aucun point, donc aucun bonus d'équipe.
  if (round.practice) { for (const r of results) r.teamBonus = 0; for (const t of teams || []) t.bonus = 0; }
  // Manche en équipes : pas de barème individuel (les points solo et le bonus d'équipe sont distincts). Seul le bonus compte.
  if (round.mode === 'team') for (const r of results) r.points = 0;
  round.before = { ...st.totals };
  st.byGame ||= {};
  round.beforeGame = { ...(st.byGame[round.game] || {}) };
  if (!round.practice) {
    const board = st.byGame[round.game] ||= {};
    for (const r of results) {
      // Manche en équipes : seul le bonus de rang d'équipe va au cumul général ; les points individuels expliquent le score collectif.
      // Solo : points individuels + rien d'autre. Le bonus n'entre pas au classement du jeu (lots).
      const general = round.mode === 'team' ? r.teamBonus : r.points + r.teamBonus;
      st.totals[r.pid] = (st.totals[r.pid] || 0) + general;
      if (r.teamBonus) { st.bonusTotals ||= {}; st.bonusTotals[r.pid] = (st.bonusTotals[r.pid] || 0) + r.teamBonus; }
      // Classement du jeu : points apportés au général par ce jeu, et score cumulé du jeu (meilleur temps pour Top départ).
      board[r.pid] = (board[r.pid] || 0) + general;
      if (r.played) {
        const perfs = (st.perfByGame ||= {})[round.game] ||= {};
        if (round.game === 'reaction') { if (r.raw > 0) perfs[r.pid] = perfs[r.pid] ? Math.min(perfs[r.pid], r.raw) : r.raw; }
        else perfs[r.pid] = (perfs[r.pid] || 0) + (r.raw || 0);
      }
    }
    st.series.played++;
    st.history ||= [];
    st.history.push({
      index: round.index, game: round.game, rule: round.rule, mode: round.mode || 'solo', at: Date.now(),
      teams: round.teams || null, teamResults: teams,
      names: Object.fromEntries(results.map(r => [r.pid, r.name])),
      results: results.map(r => ({ pid: r.pid, rank: r.rank, points: r.points, teamBonus: r.teamBonus, raw: r.raw, played: r.played })),
    });
  }
  round.endedAt = Date.now();
  // Manche suivante : la 1re est classique, les suivantes reçoivent une variante tirée au sort (modifiable).
  const next = st.series.played < st.series.total;
  st.pending = next ? { rule: st.series.played === 0 ? 'classic' : drawRule(round.game, round.rule), practice: false, theme: 'vote', level: round.level || 'easy' } : null;
}

// Les robots n'ont pas de document joueur : on ne lit que les vrais joueurs.
const readPlayersOf = (store, room, st, ids) => Promise.all(ids.filter(id => !st.roster[id]?.bot).map(id => store.get(`room/${room}/p/${id}`, { type: 'json' })));

// AUDIT : avance d'une manche (pilotée : une phase ; individuelle : clôture). Renvoie true si l'état a changé.
// ---------- Top départ : duel final ----------
// Après une manche, l'animateur lance un duel entre les deux meilleurs (en équipes : le joueur le plus lent de chacune
// des deux meilleures équipes). Un seul feu vert commun ; le plus rapide gagne ; faux départ = perdu ; égalité ou double
// faux départ = on rejoue. Le duel fixe le rang 1 et le rang 2 de la manche (points et bonus mis à jour).
const DUEL = { lead: 3500, minWait: 1500, spread: 3000, timeout: 2500 };
function duelGo(now) { const startAt = now + DUEL.lead; return { startAt, go: startAt + DUEL.minWait + randomInt(DUEL.spread), results: {} }; }
function duelPlayers(round) {
  if (round.mode === 'team') {
    const top = (round.teamResults || []).filter(t => t.rank).sort((a, b) => a.rank - b.rank).slice(0, 2);
    if (top.length < 2) return null;
    const res = new Map((round.results || []).map(r => [r.pid, r]));
    // Le meilleur temps (le plus rapide) de chacune des deux meilleures équipes.
    const pickFastest = t => t.members.filter(pid => res.get(pid)?.played && res.get(pid).raw > 0).sort((a, b) => res.get(a).raw - res.get(b).raw)[0];
    const players = top.map(pickFastest);
    return players.every(Boolean) ? { players, teams: top.map(t => t.id) } : null;
  }
  const ranked = (round.results || []).filter(r => r.played && r.raw > 0 && r.rank).sort((a, b) => a.rank - b.rank).slice(0, 2);
  return ranked.length === 2 ? { players: ranked.map(r => r.pid), teams: null } : null;
}
function settleDuel(st, now) {
  const d = st.duel;
  if (!d || d.winner || now < d.go) return false;
  // Robots (tests, démonstration) : ils réagissent tout seuls, entre 230 et 430 ms.
  for (const pid of d.players) if (st.roster[pid]?.bot && d.results[pid] === undefined && now >= d.go + 450) d.results[pid] = 230 + randomInt(200);
  const [a, b] = d.players, va = d.results[a], vb = d.results[b];
  const timeUp = now > d.go + DUEL.timeout;
  if (!timeUp && (va === undefined || vb === undefined)) return false;
  const ok = v => Number.isFinite(v);
  let winner = null;
  if (ok(va) && ok(vb)) winner = va < vb ? a : vb < va ? b : null;
  else if (ok(va)) winner = a;
  else if (ok(vb)) winner = b;
  d.last = { [a]: va ?? 'slow', [b]: vb ?? 'slow' };
  // Pas de vainqueur : on rejoue, 3 fois au plus ; ensuite le classement de la manche est conservé.
  if (!winner && d.attempt < 3) { Object.assign(d, duelGo(now), { attempt: d.attempt + 1, replay: true }); return true; }
  if (!winner) winner = a;
  d.winner = winner; d.replay = false; d.doneAt = now;
  applyDuel(st, d);
  return true;
}
function applyDuel(st, d) {
  const round = st.round;
  if (!round || round.id !== d.round || !round.results) return;
  const loser = d.players.find(p => p !== d.winner);
  const hist = (st.history || []).find(h => h.index === round.index && h.game === round.game);
  if (d.teams) {
    const [wTeam, lTeam] = d.players[0] === d.winner ? d.teams : [d.teams[1], d.teams[0]];
    const n = round.teamResults.filter(t => t.rank).length;
    for (const [id, rank] of [[wTeam, 1], [lTeam, 2]]) {
      const t = round.teamResults.find(x => x.id === id), bonus = round.practice ? 0 : n - rank + 1, delta = bonus - (t.bonus || 0);
      t.rank = rank; t.bonus = bonus;
      for (const pid of t.members) {
        const r = round.results.find(x => x.pid === pid);
        if (r) r.teamBonus = bonus;
        if (delta && !round.practice) {
          st.totals[pid] = (st.totals[pid] || 0) + delta;
          (st.bonusTotals ||= {})[pid] = (st.bonusTotals[pid] || 0) + delta;
          (st.byGame[round.game] ||= {})[pid] = (st.byGame[round.game][pid] || 0) + delta;
        }
      }
    }
  } else {
    const n = round.results.filter(r => r.played).length, mult = round.rule === 'double' ? 2 : 1;
    for (const [pid, rank] of [[d.winner, 1], [loser, 2]]) {
      const r = round.results.find(x => x.pid === pid), pts = round.practice ? 0 : pointsFor(rank, n, mult), delta = pts - (r.points || 0);
      r.rank = rank; r.points = pts;
      if (delta) { st.totals[pid] = (st.totals[pid] || 0) + delta; (st.byGame[round.game] ||= {})[pid] = (st.byGame[round.game][pid] || 0) + delta; }
    }
  }
  if (hist) { hist.results = round.results.map(r => ({ pid: r.pid, rank: r.rank, points: r.points, teamBonus: r.teamBonus, raw: r.raw, played: r.played })); hist.teamResults = round.teamResults; hist.duel = { winner: d.winner, players: d.players }; }
}

async function step(store, room, st, now, late = 0) {
  if (settleDuel(st, now)) return true;
  const round = st.round, active = round && !round.results;
  const game = active && stagedFor(round.game, round.rule);
  // Quiz : compteur « X / N ont répondu » et révélation dès que tous les joueurs encore en lice ont répondu.
  if (game && (round.game === 'truefalse' || round.game === 'cups' || round.game === 'lucky') && now >= round.startAt && round.stage.phase === 'choose' && now < round.stage.until + late) {
    const docs = await readPlayersOf(store, room, st, round.ids);
    const live = round.game === 'cups' ? round.stage.alive : round.game === 'lucky' ? round.stage.alive.filter(pid => !round.stage.posers.includes(pid)) : round.ids.filter(pid => !round.out?.[pid]);
    const trapsReady = round.game !== 'lucky' || round.stage.posers.every(pid => st.roster[pid]?.bot || Object.values(round.stage.traps).filter(x => x === pid).length >= round.stage.quota[pid]);
    const answered = live.filter(pid => st.roster[pid]?.bot || docs.some(d => d?.pid === pid && d.pick?.round === round.id && d.pick.step === round.stage.step)).length;
    if (live.length && answered >= live.length && trapsReady) round.stage.until = now - late;   // tout le monde a répondu : on passe à la suite
    else if (answered !== round.stage.answered) { round.stage.answered = answered; round.stage.eligible = live.length; return true; }
    else return false;
  }
  if (game && now >= round.startAt && now >= round.stage.until + late) {
    let picks = new Map(), times = new Map();
    if (game.needsPicks(round.stage)) {
      const docs = await readPlayersOf(store, room, st, round.ids);
      const mine = docs.filter(d => d?.pick?.round === round.id && d.pick.step === round.stage.step);
      picks = new Map(mine.map(d => [d.pid, d.pick.value]));
      times = new Map(mine.map(d => [d.pid, d.pick.at ?? now]));
      for (const pid of round.ids) if (st.roster[pid]?.bot && !picks.has(pid)) {
        const v = botPick(round, pid);
        if (v !== undefined) { picks.set(pid, v); times.set(pid, (round.stage.from || now) + 1200 + seeded(round.id + pid + round.stage.step)() * 5000); }
      }
    }
    if (!game.advance(round, picks, now, times)) complete(st, []);
    return true;
  }
  if (active && !game && now >= round.endAt + GRACE + SETTLE + late) {
    complete(st, await readPlayersOf(store, room, st, round.ids));
    return true;
  }
  return false;
}

// ---------- Équipes ----------
// Tirage avec rotation : on essaie plusieurs répartitions et on garde celle où les coéquipiers ont le moins
// déjà joué ensemble (st.together). Les équipes sont de taille égale à 1 près. Le renfort n'est jamais tiré au sort.
function buildTeams(st, series) {
  const pool = Object.values(st.roster).filter(p => !p.helper).map(p => p.pid);
  if (pool.length < 2) return [];
  const wanted = series.teamBy === 'size' ? Math.max(2, Math.round(pool.length / series.teamValue)) : series.teamValue;
  const count = Math.min(wanted, TEAM_MAX, pool.length);
  const together = pairs => pairs.reduce((sum, [a, b]) => sum + (st.together?.[pairKey(a, b)] || 0), 0);
  let best = null;
  for (let trial = 0; trial < 300 && (!best || best.cost > 0); trial++) {
    const groups = Array.from({ length: count }, () => []);
    shuffle(pool).forEach((pid, i) => groups[i % count].push(pid));
    const cost = groups.reduce((sum, g) => sum + together(g.flatMap((a, i) => g.slice(i + 1).map(b => [a, b]))), 0);
    if (!best || cost < best.cost) best = { cost, groups };
  }
  const teams = best.groups.map((members, i) => ({ id: String(i), name: `Team ${TEAMS[i][0]}`, color: TEAMS[i][1], members }));
  // Un renfort garde son équipe précédente si elle existe encore.
  for (const [i, t] of (st.teams || []).entries()) for (const pid of t.members) if (st.roster[pid]?.helper && teams[i]) teams[i].members.push(pid);
  return teams;
}

// Contrôle avant le lancement d'une manche en équipes. Renvoie une réponse d'erreur, ou null si tout est prêt.
function teamCheck(st, ids, force) {
  const teams = st.teams || [];
  if (teams.length < 2) return fail(409, 'Compose au moins deux équipes avant de lancer.');
  const placed = teams.flatMap(t => t.members);
  const missing = ids.filter(pid => !placed.includes(pid)).length;
  if (missing) return fail(409, `${plural(missing, 'joueur')} non placé${missing > 1 ? 's' : ''} : place-le${missing > 1 ? 's' : ''} dans une équipe.`);
  if (teams.some(t => !t.members.length)) return fail(409, 'Une équipe est vide : place au moins un joueur dedans, ou tire à nouveau.');
  const sizes = teams.map(t => t.members.length);
  if (Math.max(...sizes) - Math.min(...sizes) > 1 && !force) {
    return json(409, { error: `Équipes inégales (de ${Math.min(...sizes)} à ${Math.max(...sizes)} joueurs). Lancer quand même ?`, needsConfirm: true });
  }
  return null;
}

// ---------- Point d'entrée ----------
export async function handle(req, store) {
  const path = new URL(req.url).pathname.replace(/^\/api\//, '');
  if (req.method !== 'POST') return fail(405, 'Requête POST requise.');
  let body;
  try {
    const raw = await req.text();
    if (raw.length > 4096) return fail(413, 'Requête trop longue.');
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'Requête invalide.');
  }
  if (!body || !validToken(body.token)) return fail(400, 'Session invalide.');

  if (path === 'create') {
    for (let attempt = 0; attempt < 8; attempt++) {
      const room = randomBytes(4).toString('hex').slice(0, 5);
      const state = { host: body.token, roster: {}, series: null, round: null, pending: null, totals: {}, revision: 0 };
      if ((await save(store, `room/${room}/state`, null, state)).modified) return json(200, { room });
    }
    return fail(503, 'Réessaie de créer la partie.');
  }

  const { room, pid, token } = body;
  if (typeof room !== 'string' || !/^[a-f0-9]{5}$/.test(room)) return fail(400, 'Code de partie invalide.');
  const key = `room/${room}/state`;
  const playerKey = id => `room/${room}/p/${id}`;

  // AUDIT : le document du joueur est lu en même temps que l'état (une attente Blobs au lieu de deux) ;
  // le téléphone ne le demande (mine) qu'à la première interrogation après un chargement ou un réveil.
  const wantsOwn = (path === 'score' || path === 'pick' || (path === 'player' && body.mine === true)) && validToken(pid);
  for (let attempt = 0; attempt < 25; attempt++) {
    const [entry, ownEntry] = await Promise.all([read(store, key), wantsOwn ? read(store, playerKey(pid)) : null]);
    const st = entry?.data;
    if (!st?.roster) return fail(404, 'Partie introuvable. Vérifie le code affiché.');
    const now = Date.now();
    const isHost = path === 'host' && matches(token, st.host);
    if (path === 'host' && !isHost) return fail(403, 'Session animateur invalide.');
    if (!isHost && !validToken(pid)) return fail(400, 'Identifiant joueur invalide.');
    const player = st.roster[pid];
    if (player && !matches(token, player.token)) return fail(403, 'Session joueur invalide.');
    const round = st.round;
    const active = round && !round.results;

    if (path === 'join') {
      if (player) return json(200, view(st, now, pid, false));
      const name = String(body.name ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 16);
      if (!name || !colors.includes(body.color)) return fail(400, 'Indique un prénom et une couleur.');
      if (Object.values(st.roster).some(p => p.name.toLowerCase() === name.toLowerCase())) return fail(409, 'Ce prénom est déjà pris : ajoute une initiale.');
      // Une couleur prise est refusée tant qu'il reste une couleur libre.
      if (Object.values(st.roster).some(p => p.color === body.color) && Object.values(st.roster).length < colors.length) return fail(409, 'Cette couleur est déjà prise. Choisis-en une autre.');
      st.roster[pid] = { pid, name, color: body.color, token };
    } else if (path === 'player') {
      // AUDIT : si l'écran animateur ne fait plus avancer la manche (fermé, en veille), un téléphone inscrit prend le relais.
      if (player && await step(store, room, st, now, HOST_LATE)) {
        if (!(await save(store, key, entry, st)).modified) continue;
      }
      const mine = player && wantsOwn ? ownEntry?.data ?? null : undefined;
      return json(200, { ...view(st, now, pid, false), mine });
    } else if (path === 'vote') {
      // Quiz : chaque joueur vote pour un thème encore jouable ; il peut changer d'avis jusqu'au lancement.
      if (!player) return fail(403, 'Rejoins la partie pour voter.');
      if (active || !st.pending || st.series?.game !== 'truefalse') return fail(409, 'Aucun vote en cours.');
      if (body.theme !== null && !voteOptions(st).includes(body.theme)) return fail(409, 'Ce thème n’est plus disponible.');
      st.pending.votes ||= {};
      if (body.theme === null) delete st.pending.votes[pid]; else st.pending.votes[pid] = body.theme;
    } else if (path === 'trap') {
      // Le Bon Tonneau : un poseur réserve ou libère une case piégée (premier arrivé, premier servi).
      const s = active && round.game === 'lucky' ? round.stage : null;
      if (!s || s.phase !== 'choose' || !s.posers.includes(pid)) return fail(409, 'Tu ne poses pas de pièges en ce moment.');
      if (!isInt(body.cell, 0, 15)) return fail(400, 'Case invalide.');
      const owner = s.traps[body.cell];
      if (owner === pid) delete s.traps[body.cell];
      else if (owner) return fail(409, 'Case déjà prise par un coéquipier.');
      else if (Object.values(s.traps).filter(x => x === pid).length >= s.quota[pid]) return fail(409, s.quota[pid] > 1 ? `Tu as déjà posé tes ${s.quota[pid]} pièges : touche un de tes pièges pour le déplacer.` : 'Tu as déjà posé ton piège : touche-le pour le déplacer.');
      else s.traps[body.cell] = pid;
    } else if (path === 'duel') {
      const d = st.duel;
      if (!d || d.id !== body.duel || d.winner || !d.players.includes(pid)) return fail(409, 'Pas de duel en cours pour toi.');
      if (d.results[pid] !== undefined) return json(200, { accepted: true });
      if (body.value !== 'early' && !isInt(body.value, 1, DUEL.timeout)) return fail(400, 'Temps invalide.');
      // Le serveur vérifie l'heure : un appui avant le feu vert est un faux départ, quoi qu'envoie le téléphone.
      d.results[pid] = now < d.go - 50 ? 'early' : body.value;
      settleDuel(st, now);
    } else if (path === 'score' || path === 'pick') {
      if (!player || !active || body.round !== round.id || !round.ids.includes(pid) || now < round.startAt) {
        return fail(409, 'Cette action ne correspond plus à la manche.');
      }
      const previous = ownEntry;
      const own = previous?.data || { pid };
      if (path === 'score') {
        if (round.stage || now > round.endAt + GRACE) return fail(409, 'Les scores sont clos.');
        const { seq, raw, score, tb } = body;
        // Top départ : détail des 3 essais (ms, « early » = faux départ, « slow » = raté, null = pas encore joué).
        const tries = round.game === 'reaction' && Array.isArray(body.tries) && body.tries.length === REACTION_TRIES &&
          body.tries.every(v => v === null || v === 'early' || v === 'slow' || isInt(v, 1, REACTION_TRY)) ? body.tries : undefined;
        if (!Number.isSafeInteger(seq) || seq < 1 || !isInt(raw, 0, 100000) || !isInt(score, -1000, 100000) ||
          (tb !== undefined && tb !== null && !isInt(tb, 0, 600000))) return fail(400, 'Score invalide.');
        if (!scoreAllowed(round, { raw, score, tb })) return fail(400, 'Score invalide.');
        if (own.score?.round === round.id && own.score.seq >= seq) return json(200, { accepted: own.score.seq });
        own.score = { round: round.id, seq, raw, score, tb: tb ?? undefined, tries };
      } else {
        const s = round.stage;
        if (!s || s.phase !== 'choose' || body.step !== s.step || now > s.until + 400) return fail(409, 'Ce choix est clos.');
        if (round.game === 'arena' && !s.survivors.includes(pid)) return fail(409, 'Tu es éliminé pour cette manche.');
        if (round.game === 'lucky' && (!s.alive.includes(pid) || s.posers.includes(pid))) return fail(409, s.posers.includes(pid) ? 'Tu poses les pièges ce tour-ci.' : 'Tu es éliminé : tu poseras peut-être des pièges.');
        const v = body.value;
        let value;
        if (round.game === 'truefalse') {
          if (!isInt(v, 0, 3)) return fail(400, 'Réponse invalide.');
          value = v;
        } else if (round.game === 'cups') {
          if (!isInt(v, 0, 4)) return fail(400, 'Gobelet invalide.');
          value = v;
        } else if (round.game === 'lucky') {
          if (!isInt(v, 0, 15)) return fail(400, 'Tonneau invalide.');
          value = v;
        } else {
          const keep = own.pick?.round === round.id && own.pick.step === s.step ? own.pick.value : {};
          value = { ...keep };
          if (v?.pos !== undefined) {
            if (!Array.isArray(v.pos) || v.pos.length !== 2 || !v.pos.every(n => Number.isFinite(n) && Math.abs(n) <= 1.01)) return fail(400, 'Position invalide.');
            value.pos = v.pos;
          }
          if (v?.angle !== undefined) {
            if (!Number.isFinite(v.angle) || Math.abs(v.angle) > 7) return fail(400, 'Visée invalide.');
            value.angle = v.angle;
          }
        }
        own.pick = { round: round.id, step: s.step, value, at: now };   // heure serveur : sert au bonus de rapidité du Quiz
      }
      if ((await save(store, playerKey(pid), previous, own)).modified) return json(200, { accepted: own.score?.seq ?? true });
      continue;
    } else if (isHost) {
      const series = st.series;
      const action = body.action || 'poll';
      if (action !== 'poll' && body.revision !== (st.revision || 0)) return fail(409, 'L’état de la partie a changé, réessaie.');
      if (action === 'poll') {
        if (!(await step(store, room, st, now))) {
          const result = view(st, now, null, true);
          if (active && !stagedFor(round.game, round.rule) && now >= round.startAt) {
            // Progression en direct pour le projecteur (lecture seule, aucune écriture).
            const docs = await readPlayersOf(store, room, st, round.ids);
            result.live = Object.fromEntries(docs.filter(d => d?.score?.round === round.id).map(d => [d.pid, d.score.score]));
            // Robots (tests et démonstration) : progression linéaire jusqu'à leur score final sur la course.
            if (round.game === 'barrels') for (const pid of round.ids) if (st.roster[pid]?.bot) {
              const f = Math.min(1, Math.max(0, (now - round.startAt) / (round.endAt - round.startAt)));
              result.live[pid] = Math.round(botScore(round, pid).score * f);
            }
          }
          return json(200, result);
        }
      } else if (action === 'series') {
        if (active) return fail(409, 'Attends la fin de la manche.');
        if (!Object.hasOwn(games, body.game) || !isInt(body.total, 1, 5)) return fail(400, 'Série invalide.');
        // Solo ou Équipes, choisi pour chaque jeu. Équipes : par nombre (2 à 10) ou par taille cible (2, 3 ou 4).
        let config = { mode: 'solo' };
        if (body.mode === 'team') {
          const size = body.teamBy === 'size';
          if (!isInt(body.teamValue, 2, size ? 4 : TEAM_MAX)) return fail(400, size ? 'Taille d’équipe : 2, 3 ou 4 joueurs.' : 'Nombre d’équipes : entre 2 et 10.');
          config = { mode: 'team', teamBy: size ? 'size' : 'count', teamValue: body.teamValue };
        }
        st.series = { game: body.game, total: body.total, played: 0, ...config };
        st.pending = { rule: 'classic', practice: false, theme: 'vote', level: 'easy' };
        st.teams = config.mode === 'team' ? buildTeams(st, st.series) : null;
      } else if (action === 'change-game') {
        if (active) return fail(409, 'Attends la fin de la manche pour changer de jeu.');
        st.series = null; st.pending = null; st.teams = null;
      } else if (action === 'teams-draw') {
        // Tirage (ou nouveau tirage avec rotation) : efface les placements à la main.
        if (active) return fail(409, 'Attends la fin de la manche.');
        if (!series || series.mode !== 'team') return fail(409, 'Passe en mode Équipes pour composer les équipes.');
        st.teams = buildTeams(st, series);
        if (!st.teams.length) return fail(409, 'Il faut au moins deux joueurs pour former des équipes.');
      } else if (action === 'teams-set') {
        // Placement à la main (déplacer un joueur) ou échange de deux joueurs placés.
        if (active || !series || series.mode !== 'team' || !st.teams?.length) return fail(409, 'Compose d’abord les équipes.');
        if (body.move) {
          const { pid, team } = body.move;
          if (!st.roster[pid]) return fail(404, 'Joueur introuvable.');
          if (team !== null && !isInt(team, 0, st.teams.length - 1)) return fail(400, 'Équipe inconnue.');
          for (const t of st.teams) t.members = t.members.filter(x => x !== pid);
          if (team !== null) st.teams[team].members.push(pid);
        } else if (Array.isArray(body.swap) && body.swap.length === 2 && body.swap.every(x => typeof x === 'string')) {
          const [a, b] = body.swap;
          const ta = st.teams.find(t => t.members.includes(a)), tb = st.teams.find(t => t.members.includes(b));
          if (!ta || !tb) return fail(409, 'Seuls des joueurs placés peuvent être échangés.');
          if (ta !== tb) { ta.members[ta.members.indexOf(a)] = b; tb.members[tb.members.indexOf(b)] = a; }
        } else return fail(400, 'Déplacement invalide.');
      } else if (action === 'helper') {
        // Animateur en renfort : compte pour son équipe, hors classement individuel. Jamais ajouté automatiquement.
        if (active) return fail(409, 'Attends la fin de la manche.');
        const p = st.roster[body.player];
        if (!p) return fail(404, 'Joueur introuvable.');
        if (p.bot) return fail(400, 'Un robot ne peut pas être renfort.');
        if (body.on) p.helper = true; else delete p.helper;
      } else if (action === 'rule' || action === 'reroll') {
        if (active || !st.pending) return fail(409, 'Aucune manche en préparation.');
        if (action === 'reroll') {
          if (!series.played) return fail(409, 'La première manche se joue toujours en règles classiques.');
          st.pending.rule = drawRule(series.game, st.pending.rule);
        } else {
          // Le mode Survie du bonneteau se choisit dès la première manche ; les autres variantes après la première.
          if (body.rule !== 'classic' && (!games[series.game].variants.includes(body.rule) || (!series.played && body.rule !== 'survie'))) return fail(400, 'Variante indisponible.');
          st.pending.rule = body.rule;
        }
      } else if (action === 'theme') {
        if (active || !st.pending) return fail(409, 'Aucune manche en préparation.');
        if (body.theme !== 'vote' && !Object.hasOwn(themes, body.theme)) return fail(400, 'Thème inconnu.');
        if ((st.playedThemes || []).includes(body.theme)) return fail(409, 'Ce thème a déjà été joué ce soir.');
        st.pending.theme = body.theme;
      } else if (action === 'level') {
        if (active || !st.pending) return fail(409, 'Aucune manche en préparation.');
        if (!Object.hasOwn(levels, body.level)) return fail(400, 'Niveau inconnu.');
        st.pending.level = body.level;
      } else if (action === 'cancel') {
        // Annuler et rejouer : la manche disparaît sans aucun point, la même règle est reproposée.
        if (!active) return fail(409, 'Aucune manche en cours.');
        if (round.themeAdded) st.playedThemes = (st.playedThemes || []).filter(t => t !== round.theme);   // annulée : le thème redevient jouable
        st.pending = { rule: round.rule, practice: round.practice, theme: round.chosenTheme || 'vote', votes: round.votes, level: round.level || 'easy' };
        st.round = null;
      } else if (action === 'bots') {
        if (active) return fail(409, 'Attends la fin de la manche.');
        if (!isInt(body.count, 1, 500)) return fail(400, 'Nombre de robots invalide.');
        let n = Object.values(st.roster).filter(p => p.bot).reduce((m, p) => Math.max(m, Number(p.name.replace(/\D/g, '')) || 0), 0);
        const used = Object.values(st.roster).map(p => p.color);
        for (let i = 0; i < body.count; i++) {
          n++;
          const free = colors.filter(c => !used.includes(c)), color = (free.length ? free : colors)[n % (free.length || colors.length)];
          used.push(color);
          const pid = randomBytes(16).toString('hex');
          st.roster[pid] = { pid, name: `🤖 Robot ${n}`, color, token: randomBytes(16).toString('hex'), bot: true };
        }
      } else if (action === 'unbots') {
        if (active) return fail(409, 'Attends la fin de la manche.');
        for (const p of Object.values(st.roster).filter(p => p.bot)) {
          delete st.roster[p.pid]; delete st.totals[p.pid]; if (st.bonusTotals) delete st.bonusTotals[p.pid];
          for (const board of Object.values(st.byGame || {})) delete board[p.pid];
          for (const t of st.teams || []) t.members = t.members.filter(x => x !== p.pid);
        }
      } else if (action === 'practice') {
        if (active || !st.pending) return fail(409, 'Aucune manche en préparation.');
        st.pending.practice = Boolean(body.on);
      } else if (action === 'start') {
        const ids = Object.keys(st.roster);
        if (active || !st.pending || !ids.length) return fail(409, 'Il faut une manche préparée et au moins un joueur.');
        const { game } = series;
        if (ids.length < (games[game].minPlayers || 1)) return fail(409, `${games[game].name} demande au moins ${games[game].minPlayers} joueurs.`);
        let quiz = null;
        if (game === 'truefalse') {
          const chosen = st.pending.theme || 'vote';
          if (chosen !== 'vote' && chosen !== 'all' && (st.playedThemes || []).includes(chosen)) return fail(409, 'Ce thème a déjà été joué ce soir.');
          quiz = chosen === 'vote' ? { ...voteWinner(st, st.pending.votes), byVote: true } : { theme: chosen, byVote: false };
          quiz.chosen = chosen;
        }
        let teamsNow;
        if (series.mode === 'team') {
          const refused = teamCheck(st, ids, body.force === true);
          if (refused) return refused;
          teamsNow = st.teams.map(t => ({ ...t, members: [...t.members] }));
          st.together ||= {};
          for (const t of teamsNow) t.members.forEach((a, i) => t.members.slice(i + 1).forEach(b => { st.together[pairKey(a, b)] = (st.together[pairKey(a, b)] || 0) + 1; }));
        }
        const startAt = now + COUNTDOWN;
        st.round = {
          id: randomBytes(8).toString('hex'), game, rule: st.pending.rule, practice: st.pending.practice,
          mode: teamsNow ? 'team' : 'solo', teams: teamsNow,
          theme: quiz?.theme, chosenTheme: quiz?.chosen, votes: quiz ? st.pending.votes : undefined, vote: quiz?.byVote ? { votes: quiz.votes, wheel: quiz.wheel } : undefined,
          themeAdded: Boolean(quiz && quiz.theme !== 'all'), level: game === 'words' ? st.pending.level || 'easy' : undefined,
          index: series.played + 1, total: series.total, ids, startAt,
          endAt: stagedFor(game, st.pending.rule) ? null : startAt + duration(game, st.pending.rule) * 1000,
          tally: {}, played: {},
        };
        if (quiz && quiz.theme !== 'all') st.playedThemes = [...(st.playedThemes || []), quiz.theme];
        if (stagedFor(game, st.round.rule)) stagedFor(game, st.round.rule).begin(st.round, st, now);
        st.pending = null;
      } else if (action === 'duel') {
        if (!round?.results || round.game !== 'reaction') return fail(409, 'Le duel se lance après une manche de Top départ.');
        if (st.duel && st.duel.round === round.id && !st.duel.winner) return fail(409, 'Un duel est déjà en cours.');
        if (st.duel?.round === round.id && st.duel.winner) return fail(409, 'Le duel de cette manche est déjà joué.');
        const who = duelPlayers(round);
        if (!who) return fail(409, 'Il faut au moins deux joueurs (ou deux équipes) classés pour un duel.');
        st.duel = { id: `${now.toString(36)}${randomInt(1e6)}`, round: round.id, ...who, attempt: 1, ...duelGo(now) };
      } else if (action === 'end') {
        if (!active || now < round.startAt) return fail(409, 'Cette manche ne peut pas être arrêtée.');
        if (stagedFor(round.game, round.rule)) complete(st, []);
        else if (now < round.endAt) round.endAt = now;
        else return fail(409, 'La manche se termine déjà.');
      } else if (action === 'reset') {
        if (active) return fail(409, 'Attends la fin de la manche.');
        if (body.code !== room) return fail(400, 'Tape le code de la partie pour confirmer.');
        st.totals = {}; st.byGame = {}; st.series = null; st.pending = null; st.round = null;
        st.teams = null; st.history = []; st.together = {}; st.bonusTotals = {}; st.playedThemes = []; st.perfByGame = {}; st.duel = null;
      } else if (action === 'remove') {
        if (active) return fail(409, 'Attends la fin de la manche.');
        if (!st.roster[body.player]) return fail(404, 'Joueur introuvable.');
        delete st.roster[body.player];
        delete st.totals[body.player]; if (st.bonusTotals) delete st.bonusTotals[body.player];
        for (const board of Object.values(st.byGame || {})) delete board[body.player];
        for (const t of st.teams || []) t.members = t.members.filter(x => x !== body.player);
      } else return fail(404, 'Commande inconnue.');
      st.revision = (st.revision || 0) + 1;
    } else return fail(404, 'Commande inconnue.');

    if ((await save(store, key, entry, st)).modified) return json(200, view(st, now, pid, isHost));
    await new Promise(r => setTimeout(r, Math.random() * 60 * Math.min(attempt + 1, 4)));   // AUDIT : évite que les essais repartent tous ensemble
  }
  return fail(503, 'Plusieurs actions simultanées. Réessaie.');
}
