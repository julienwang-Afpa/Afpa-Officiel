import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { colors, duration, games, pointsFor, drawRule, themes, levels, TF_COUNT, MEMORY_MAX, seeded, cupsTimeline, REACTION_TRY, TEAMS, TEAM_MAX, TEAM_BONUS, teamLowerWins } from '../../public/games.mjs';
import { staged, arenaScores, bankFor, quizThemes } from './staged.mjs';

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
function voteWinner(st, votes) {
  const left = themesLeft(st), tally = {};
  for (const t of Object.values(votes || {})) if (left.includes(t)) tally[t] = (tally[t] || 0) + 1;
  const best = Math.max(0, ...Object.values(tally));
  const top = best ? left.filter(t => tally[t] === best) : left;
  if (!top.length) return { theme: 'all', votes: 0, tie: false };
  return { theme: top[randomInt(top.length)], votes: best, tie: top.length > 1 };
}

// AUDIT : plafonds plausibles par jeu (un humain ne peut pas faire mieux) ; au-delà, le score est refusé.
export function scoreAllowed(round, { raw, score, tb }) {
  const sec = (round.endAt - round.startAt) / 1000;
  switch (round.game) {
    case 'barrels': { const max = Math.ceil(sec * 1000 / 45); return raw <= max && score <= 2 * max && score >= -max; }
    case 'odd': { const max = Math.ceil(sec * 4); return raw <= max && score <= max * 2 && score >= 0; }
    case 'maths': case 'words': { const max = Math.ceil(sec * 2); return raw <= max && score <= max * 2 && score >= 0; }
    case 'reaction': return raw === 0 ? score === 0 : raw >= 100 && raw <= REACTION_TRY && score === 10000 - raw;
    case 'memory': return raw <= MEMORY_MAX && score === raw && (tb == null || tb >= 0);
    case 'cups': return raw <= 10 && score <= 550 && score >= 0 && score % 10 === 0;
    default: return true;
  }
}

// ---------- Vue envoyée aux navigateurs ----------
function publicRound(round) {
  if (!round) return null;
  const { questions, ...rest } = round;
  // len : durée de la phase en cours, pour que les barres de temps soient justes sur tous les écrans.
  if (round.stage && staged[round.game]) rest.stage = { ...staged[round.game].publicStage(round), len: staged[round.game].stageLength(round.stage, round.rule) };
  // Vrai ou faux : les points ne bougent qu'au moment de la réponse, pour ne pas la trahir.
  if (round.game === 'truefalse' && !round.results && round.stage?.phase !== 'answer') rest.tally = round.shownTally || {};
  if (round.game === 'truefalse' && round.stage?.phase === 'answer') rest.tally = round.tally;
  return rest;
}

function view(st, now, pid, isHost) {
  return {
    now,
    players: Object.values(st.roster).map(identity),
    joined: Boolean(pid && st.roster[pid]),
    series: st.series, pending: st.pending, totals: st.totals, byGame: st.byGame || {},
    teams: st.teams || null,
    bonusTotals: st.bonusTotals || {},
    round: st.round && { ...publicRound(st.round), playing: Boolean(pid && st.round.ids.includes(pid)) },
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
    case 'reaction': { const raw = between(230, 480); return { raw, score: 10000 - raw, tb: raw }; }
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
  if (round.game === 'truefalse') { const q = round.questions[s.step]; return r() < 0.7 ? q.answer : !q.answer; }
  if (round.game === 'lucky') return Math.floor(r() * (s.rule === 'final' ? 9 : s.rule === 'gamble' ? 6 : 5));
  return undefined;   // Bataille royale : le serveur place et vise au hasard les joueurs sans choix
}

// ---------- Classement d'une manche ----------
// N joueurs classés : N points au 1er, N − 1 au 2e… ; égalité = même rang et mêmes points ; score nul ou absent = 0 ; ×2 double.
export function rankRound(round, roster, players) {
  const subs = new Map(players.filter(p => p?.score?.round === round.id).map(p => [p.pid, p.score]));
  for (const pid of round.ids) if (roster[pid]?.bot && !staged[round.game]) subs.set(pid, { round: round.id, ...botScore(round, pid) });
  const arena = round.game === 'arena' ? arenaScores(round) : null;
  const entries = round.ids.filter(pid => roster[pid]).map(pid => {
    const base = identity(roster[pid]);
    if (arena) return { ...base, score: arena[pid], raw: arena[pid], played: true };
    if (staged[round.game]) {
      const score = round.tally[pid] || 0;
      return { ...base, score, raw: score, played: Boolean(round.played[pid]) || Boolean(roster[pid].bot) };
    }
    const sub = subs.get(pid);
    return { ...base, score: sub?.score ?? 0, raw: sub?.raw ?? 0, tb: sub?.tb, played: Boolean(sub) };
  });
  // Le temps (tb) ne départage que les jeux où il compte : Mémoire Flash et bonneteau.
  const usesTb = round.game === 'memory' || round.game === 'cups';
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
function teamRanking(round, entries, results) {
  const raw = new Map(entries.map(e => [e.pid, e.raw]));
  const byPid = new Map(results.map(r => [r.pid, r]));
  const lower = teamLowerWins(round.game);
  const rows = round.teams.map(t => {
    const values = t.members.map(pid => raw.get(pid) || 0);
    const perf = lower ? (values.filter(v => v > 0).reduce((a, b) => a + b, 0) || null) : values.reduce((a, b) => a + b, 0);
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
      board[r.pid] = (board[r.pid] || 0) + r.points;
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
async function step(store, room, st, now, late = 0) {
  const round = st.round, active = round && !round.results;
  const game = active && staged[round.game];
  if (game && now >= round.startAt && now >= round.stage.until + late) {
    let picks = new Map();
    if (game.needsPicks(round.stage)) {
      const docs = await readPlayersOf(store, room, st, round.ids);
      picks = new Map(docs.filter(d => d?.pick?.round === round.id && d.pick.step === round.stage.step).map(d => [d.pid, d.pick.value]));
      for (const pid of round.ids) if (st.roster[pid]?.bot && !picks.has(pid)) { const v = botPick(round, pid); if (v !== undefined) picks.set(pid, v); }
    }
    if (!game.advance(round, picks, now)) complete(st, []);
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
      if (body.theme !== null && !themesLeft(st).includes(body.theme)) return fail(409, 'Ce thème n’est plus disponible.');
      st.pending.votes ||= {};
      if (body.theme === null) delete st.pending.votes[pid]; else st.pending.votes[pid] = body.theme;
    } else if (path === 'score' || path === 'pick') {
      if (!player || !active || body.round !== round.id || !round.ids.includes(pid) || now < round.startAt) {
        return fail(409, 'Cette action ne correspond plus à la manche.');
      }
      const previous = ownEntry;
      const own = previous?.data || { pid };
      if (path === 'score') {
        if (round.stage || now > round.endAt + GRACE) return fail(409, 'Les scores sont clos.');
        const { seq, raw, score, tb } = body;
        if (!Number.isSafeInteger(seq) || seq < 1 || !isInt(raw, 0, 100000) || !isInt(score, -1000, 100000) ||
          (tb !== undefined && tb !== null && !isInt(tb, 0, 600000))) return fail(400, 'Score invalide.');
        if (!scoreAllowed(round, { raw, score, tb })) return fail(400, 'Score invalide.');
        if (own.score?.round === round.id && own.score.seq >= seq) return json(200, { accepted: own.score.seq });
        own.score = { round: round.id, seq, raw, score, tb: tb ?? undefined };
      } else {
        const s = round.stage;
        if (!s || s.phase !== 'choose' || body.step !== s.step || now > s.until + 400) return fail(409, 'Ce choix est clos.');
        if (round.game === 'arena' && !s.survivors.includes(pid)) return fail(409, 'Tu es éliminé pour cette manche.');
        if (round.game === 'lucky' && s.rule === 'final' && !(s.lives[pid] > 0)) return fail(409, 'Tu n’as plus de vie.');
        const v = body.value;
        let value;
        if (round.game === 'truefalse') {
          if (!isInt(v, 0, 3)) return fail(400, 'Réponse invalide.');
          value = v;
        } else if (round.game === 'lucky') {
          if (!isInt(v, 0, s.rule === 'final' ? 8 : s.rule === 'gamble' ? 5 : 4)) return fail(400, 'Tonneau invalide.');
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
        own.pick = { round: round.id, step: s.step, value };
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
          if (active && !staged[round.game] && now >= round.startAt) {
            // Progression en direct pour le projecteur (lecture seule, aucune écriture).
            const docs = await readPlayersOf(store, room, st, round.ids);
            result.live = Object.fromEntries(docs.filter(d => d?.score?.round === round.id).map(d => [d.pid, d.score.score]));
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
          if (body.rule !== 'classic' && (!series.played || !games[series.game].variants.includes(body.rule))) return fail(400, 'Variante indisponible.');
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
          theme: quiz?.theme, chosenTheme: quiz?.chosen, votes: quiz ? st.pending.votes : undefined, vote: quiz?.byVote ? { votes: quiz.votes, tie: quiz.tie } : undefined,
          themeAdded: Boolean(quiz && quiz.theme !== 'all'), level: game === 'words' ? st.pending.level || 'easy' : undefined,
          index: series.played + 1, total: series.total, ids, startAt,
          endAt: staged[game] ? null : startAt + duration(game, st.pending.rule) * 1000,
          tally: {}, played: {},
        };
        if (quiz && quiz.theme !== 'all') st.playedThemes = [...(st.playedThemes || []), quiz.theme];
        if (staged[game]) staged[game].begin(st.round, st, now);
        st.pending = null;
      } else if (action === 'end') {
        if (!active || now < round.startAt) return fail(409, 'Cette manche ne peut pas être arrêtée.');
        if (staged[round.game]) complete(st, []);
        else if (now < round.endAt) round.endAt = now;
        else return fail(409, 'La manche se termine déjà.');
      } else if (action === 'reset') {
        if (active) return fail(409, 'Attends la fin de la manche.');
        if (body.code !== room) return fail(400, 'Tape le code de la partie pour confirmer.');
        st.totals = {}; st.byGame = {}; st.series = null; st.pending = null; st.round = null;
        st.teams = null; st.history = []; st.together = {}; st.bonusTotals = {}; st.playedThemes = [];
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
