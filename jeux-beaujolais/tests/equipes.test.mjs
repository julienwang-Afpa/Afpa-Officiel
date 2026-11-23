// Tests du mode équipes côté serveur, avec un magasin Blobs en mémoire (aucune attente réelle).
// Lancer : npm test   (ou node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { handle, rankRound } from '../netlify/lib/game-logic.mjs';
import { colors } from '../public/games.mjs';

const hex = () => randomBytes(16).toString('hex');

function memStore() {
  const mem = new Map();
  let etag = 0;
  return {
    mem,
    async get(key) { const v = mem.get(key); return v ? JSON.parse(v.data) : null; },
    async getWithMetadata(key) { const v = mem.get(key); return v ? { data: JSON.parse(v.data), etag: v.etag } : null; },
    async setJSON(key, data, opts = {}) {
      const cur = mem.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      mem.set(key, { data: JSON.stringify(data), etag: 'e' + (++etag) });
      return { modified: true };
    },
  };
}

async function call(store, path, body) {
  const res = await handle(new Request(`http://test/api/${path}`, { method: 'POST', body: JSON.stringify(body) }), store);
  return { status: res.status, data: await res.json() };
}

// Crée une partie avec n joueurs (téléphones) et un animateur.
async function room(store, n) {
  const host = hex();
  const { data: { room: code } } = await call(store, 'create', { token: host });
  const names = ['Erika', 'Jad', 'Julien', 'Marie', 'Jean', 'Anne', 'Max', 'Léa'];
  const players = [];
  for (let i = 0; i < n; i++) {
    const pid = hex(), token = hex();
    const r = await call(store, 'join', { room: code, pid, token, name: names[i], color: colors[i] });
    assert.equal(r.status, 200, r.data.error);
    players.push({ pid, token, name: names[i] });
  }
  return { store, code, host, players };
}

// Action animateur : relit la révision courante, puis envoie la commande.
async function cmd(env, action, extra = {}) {
  const poll = await call(env.store, 'host', { room: env.code, token: env.host, action: 'poll' });
  return call(env.store, 'host', { room: env.code, token: env.host, action, revision: poll.data.revision, ...extra });
}

const state = env => JSON.parse(env.store.mem.get(`room/${env.code}/state`).data);
function edit(env, fn) {
  const key = `room/${env.code}/state`;
  const st = state(env);
  fn(st);
  env.store.mem.set(key, { data: JSON.stringify(st), etag: 'x' + Math.random() });
}

// Décale l'horloge de la manche (pour passer le décompte, puis la clôture).
const shiftRound = (env, { startAt, endAt }) => edit(env, st => { st.round.startAt = startAt; st.round.endAt = endAt; });

test('tirage automatique : 6 joueurs en 2 équipes de 3', async () => {
  const env = await room(memStore(), 6);
  const r = await cmd(env, 'series', { game: 'barrels', total: 2, mode: 'team', teamBy: 'count', teamValue: 2 });
  assert.equal(r.status, 200, r.data.error);
  const teams = r.data.teams;
  assert.equal(teams.length, 2);
  assert.deepEqual(teams.map(t => t.members.length), [3, 3]);
  assert.equal(new Set(teams.flatMap(t => t.members)).size, 6, 'chacun est placé une seule fois');
  assert.equal(teams[0].name, 'Team Or');
});

test('taille cible : 7 joueurs par équipes de 3 donnent 2 équipes', async () => {
  const env = await room(memStore(), 7);
  const r = await cmd(env, 'series', { game: 'barrels', total: 1, mode: 'team', teamBy: 'size', teamValue: 3 });
  assert.equal(r.data.teams.length, 2);
  assert.equal(r.data.teams.reduce((s, t) => s + t.members.length, 0), 7);
});

test('rotation : deux tirages successifs sans coéquipier commun quand c’est possible', async () => {
  const env = await room(memStore(), 4);
  await cmd(env, 'series', { game: 'barrels', total: 2, mode: 'team', teamBy: 'count', teamValue: 2 });
  const first = state(env).teams;
  // Une manche jouée enregistre les coéquipiers (st.together) : on la termine tout de suite.
  const started = await cmd(env, 'start');
  assert.equal(started.status, 200, started.data.error);
  edit(env, st => { st.round.endAt = Date.now() - 10000; st.round.startAt = Date.now() - 30000; });
  await call(env.store, 'host', { room: env.code, token: env.host, action: 'poll' });
  const again = await cmd(env, 'teams-draw');
  assert.equal(again.status, 200, again.data.error);
  const pairs = teams => teams.flatMap(t => t.members.flatMap((a, i) => t.members.slice(i + 1).map(b => [a, b].sort().join('|'))));
  const before = new Set(pairs(first));
  assert.equal(pairs(again.data.teams).filter(p => before.has(p)).length, 0, 'aucun duo déjà formé');
});

test('démarrage refusé tant qu’un joueur n’est pas placé', async () => {
  const env = await room(memStore(), 4);
  await cmd(env, 'series', { game: 'barrels', total: 1, mode: 'team', teamBy: 'count', teamValue: 2 });
  const victim = state(env).teams[0].members[0];
  const moved = await cmd(env, 'teams-set', { move: { pid: victim, team: null } });
  assert.equal(moved.status, 200, moved.data.error);
  const r = await cmd(env, 'start');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /1 joueur non placé/);
});

test('équipes inégales : confirmation demandée, puis lancement forcé', async () => {
  const env = await room(memStore(), 4);
  await cmd(env, 'series', { game: 'barrels', total: 1, mode: 'team', teamBy: 'count', teamValue: 2 });
  const [a, b] = state(env).teams;
  await cmd(env, 'teams-set', { move: { pid: b.members[0], team: 0 } });   // 3 contre 1
  const refused = await cmd(env, 'start');
  assert.equal(refused.status, 409);
  assert.equal(refused.data.needsConfirm, true);
  const forced = await cmd(env, 'start', { force: true });
  assert.equal(forced.status, 200, forced.data.error);
  assert.equal(forced.data.round.mode, 'team');
  assert.equal(forced.data.round.teams.length, 2);
  assert.ok(a && b);
});

test('échange de deux joueurs placés', async () => {
  const env = await room(memStore(), 4);
  await cmd(env, 'series', { game: 'barrels', total: 1, mode: 'team', teamBy: 'count', teamValue: 2 });
  const [t0, t1] = state(env).teams;
  const x = t0.members[0], y = t1.members[0];
  const r = await cmd(env, 'teams-set', { swap: [x, y] });
  assert.equal(r.status, 200, r.data.error);
  const after = state(env).teams;
  assert.ok(after[0].members.includes(y) && after[1].members.includes(x));
});

test('le tirage d’équipes n’existe qu’en mode Équipes', async () => {
  const env = await room(memStore(), 4);
  await cmd(env, 'series', { game: 'barrels', total: 1 });
  const r = await cmd(env, 'teams-draw');
  assert.equal(r.status, 409);
});

test('manche en équipes : bonus, renfort hors classement individuel, historique', async () => {
  const env = await room(memStore(), 4);
  const [p0, p1, p2, p3] = env.players;
  await cmd(env, 'series', { game: 'barrels', total: 2, mode: 'team', teamBy: 'count', teamValue: 2 });
  // Équipes fixées à la main : A = p0 + p1, B = p2 + p3.
  await cmd(env, 'teams-set', { move: { pid: p0.pid, team: 0 } });
  await cmd(env, 'teams-set', { move: { pid: p1.pid, team: 0 } });
  await cmd(env, 'teams-set', { move: { pid: p2.pid, team: 1 } });
  await cmd(env, 'teams-set', { move: { pid: p3.pid, team: 1 } });
  // p1 est l'animateur en renfort : il compte pour Team Or, mais pas dans le classement individuel.
  const flagged = await cmd(env, 'helper', { player: p1.pid, on: true });
  assert.equal(flagged.status, 200, flagged.data.error);
  const started = await cmd(env, 'start');
  assert.equal(started.status, 200, started.data.error);
  const roundId = started.data.round.id;
  const now = Date.now();
  shiftRound(env, { startAt: now - 6500, endAt: now + 10000 });
  const scores = { [p0.pid]: 30, [p1.pid]: 10, [p2.pid]: 25, [p3.pid]: 20 };
  for (const p of env.players) {
    const r = await call(env.store, 'score', { room: env.code, pid: p.pid, token: p.token, round: roundId, seq: 1, raw: scores[p.pid], score: scores[p.pid] });
    assert.equal(r.status, 200, r.data.error);
  }
  shiftRound(env, { startAt: now - 30000, endAt: now - 8000 });
  const done = await call(env.store, 'host', { room: env.code, token: env.host, action: 'poll' });
  const st = state(env);
  assert.ok(st.round.results, 'la manche est classée');
  const byPid = Object.fromEntries(st.round.results.map(r => [r.pid, r]));
  assert.equal(byPid[p1.pid], undefined, 'le renfort n’est pas dans le classement individuel');
  // Individuel (3 joueurs) : p0 1er = 3 pts, p2 2e = 2 pts, p3 3e = 1 pt.
  assert.equal(byPid[p0.pid].points, 3);
  assert.equal(byPid[p2.pid].points, 2);
  assert.equal(byPid[p3.pid].points, 1);
  // Équipes : A = 30 + 10 = 40 ; B = 25 + 20 = 45 → B gagne. Bonus N − rang + 1 avec N = 2 : +2 pour B, +1 pour A.
  const teams = st.round.teamResults;
  assert.equal(teams.find(t => t.name === 'Team Or').perf, 40);
  assert.equal(teams.find(t => t.name === 'Team Argent').rank, 1);
  assert.equal(teams.find(t => t.name === 'Team Argent').bonus, 2);
  assert.equal(teams.find(t => t.name === 'Team Or').bonus, 1);
  assert.equal(byPid[p2.pid].teamBonus, 2);
  assert.equal(byPid[p0.pid].teamBonus, 1);
  // Cumul général = points individuels + bonus ; classement par jeu = points individuels seulement.
  assert.equal(st.totals[p2.pid], 2, 'p2 : seul le bonus d’équipe (+2) va au général, pas ses points individuels');
  assert.equal(st.byGame.barrels[p2.pid], 2);
  assert.equal(st.totals[p1.pid] ?? 0, 0, 'le renfort ne touche aucun point individuel');
  assert.equal(st.totals[p0.pid], 1, 'p0 : bonus de 2e équipe (+1) seulement');
  // Historique : l'équipe de l'époque est conservée.
  assert.equal(st.history.length, 1);
  assert.equal(st.history[0].mode, 'team');
  assert.deepEqual(st.history[0].teams.map(t => t.name), ['Team Or', 'Team Argent']);
  assert.equal(done.status, 200);
  // Bouton « Finale ×2 » : la manche suivante est proposée en ×2 (variante réservée à ce bouton).
  const finale = await cmd(env, 'rule', { rule: 'double' });
  assert.equal(finale.status, 200, finale.data.error);
  assert.equal(finale.data.pending.rule, 'double');
});

test('manche d’essai en équipes : aucun point, aucun bonus', async () => {
  const env = await room(memStore(), 4);
  const [p0, p1, p2, p3] = env.players;
  await cmd(env, 'series', { game: 'barrels', total: 1, mode: 'team', teamBy: 'count', teamValue: 2 });
  await cmd(env, 'teams-set', { move: { pid: p0.pid, team: 0 } });
  await cmd(env, 'teams-set', { move: { pid: p1.pid, team: 0 } });
  await cmd(env, 'teams-set', { move: { pid: p2.pid, team: 1 } });
  await cmd(env, 'teams-set', { move: { pid: p3.pid, team: 1 } });
  await cmd(env, 'practice', { on: true });
  const started = await cmd(env, 'start');
  assert.equal(started.status, 200, started.data.error);
  const now = Date.now();
  shiftRound(env, { startAt: now - 6500, endAt: now + 10000 });
  for (const [i, p] of env.players.entries()) {
    await call(env.store, 'score', { room: env.code, pid: p.pid, token: p.token, round: started.data.round.id, seq: 1, raw: 10 + i * 5, score: 10 + i * 5 });
  }
  shiftRound(env, { startAt: now - 30000, endAt: now - 8000 });
  await call(env.store, 'host', { room: env.code, token: env.host, action: 'poll' });
  const st = state(env);
  assert.ok(st.round.teamResults.every(t => t.bonus === 0));
  assert.ok(st.round.results.every(r => r.teamBonus === 0));
  assert.deepEqual(st.totals, {}, 'un essai ne touche pas le cumul');
  assert.equal((st.history || []).length, 0, 'un essai n’entre pas dans l’historique');
});

test('Top départ en équipes : la somme la plus petite gagne', async () => {
  const roster = Object.fromEntries(['a', 'b', 'c', 'd'].map(pid => [pid, { pid, name: pid, color: '#fff', token: hex() }]));
  const round = { id: 'r1', game: 'reaction', rule: 'classic', mode: 'team', ids: Object.keys(roster), tally: {}, played: {},
    teams: [{ id: '0', name: 'Team Or', color: '#f2c86b', members: ['a', 'b'] }, { id: '1', name: 'Team Argent', color: '#cfd6e2', members: ['c', 'd'] }] };
  const players = [
    { pid: 'a', score: { round: 'r1', raw: 300, score: 9700, seq: 1 } }, { pid: 'b', score: { round: 'r1', raw: 400, score: 9600, seq: 1 } },
    { pid: 'c', score: { round: 'r1', raw: 250, score: 9750, seq: 1 } }, { pid: 'd', score: { round: 'r1', raw: 600, score: 9400, seq: 1 } },
  ];
  const { teams } = rankRound(round, roster, players);
  assert.equal(teams.find(t => t.id === '0').perf, 700);
  assert.equal(teams.find(t => t.id === '1').perf, 850);
  assert.equal(teams.find(t => t.id === '0').rank, 1);
});

test('en solo, rien ne change : pas de bonus d’équipe ni de classement par équipe', async () => {
  const roster = Object.fromEntries(['a', 'b'].map(pid => [pid, { pid, name: pid, color: '#fff', token: hex() }]));
  const round = { id: 'r2', game: 'barrels', rule: 'classic', ids: ['a', 'b'], tally: {}, played: {} };
  const players = [{ pid: 'a', score: { round: 'r2', raw: 5, score: 5, seq: 1 } }, { pid: 'b', score: { round: 'r2', raw: 9, score: 9, seq: 1 } }];
  const { results, teams } = rankRound(round, roster, players);
  assert.equal(teams, null);
  assert.equal(results[0].pid, 'b');
  assert.equal(results[0].points, 2);
  assert.equal(results[0].teamBonus, 0);
});

test('couleurs : 24 teintes, une couleur prise est refusée tant qu’il en reste de libres', async () => {
  const { colors } = await import('../public/games.mjs');
  assert.equal(colors.length, 24);
  assert.equal(new Set(colors).size, 24, 'toutes les teintes sont distinctes');
  const env = await room(memStore(), 2);
  const r = await call(env.store, 'join', { room: env.code, pid: hex(), token: hex(), name: 'Zoé', color: colors[0] });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /déjà prise/);
});

test('Quiz : vote des joueurs, thème gagnant joué, puis interdit au vote et au choix', async () => {
  const env = await room(memStore(), 3);
  const [a, b, c] = env.players;
  await cmd(env, 'series', { game: 'truefalse', total: 2, mode: 'solo' });
  assert.equal(state(env).pending.theme, 'vote');
  for (const [p, t] of [[a, 'geo'], [b, 'geo'], [c, 'music']]) {
    const r = await call(env.store, 'vote', { room: env.code, pid: p.pid, token: p.token, theme: t });
    assert.equal(r.status, 200, r.data.error);
  }
  const started = await cmd(env, 'start');
  assert.equal(started.status, 200, started.data.error);
  let st = state(env);
  assert.equal(st.round.theme, 'geo');
  assert.deepEqual(st.playedThemes, ['geo']);
  // Annuler rend le thème jouable de nouveau ; on relance pour le consommer.
  await cmd(env, 'cancel');
  assert.deepEqual(state(env).playedThemes, []);
  await cmd(env, 'start');
  st = state(env);
  assert.deepEqual(st.playedThemes, ['geo']);
  // Pendant la manche, le vote est fermé.
  const closed = await call(env.store, 'vote', { room: env.code, pid: a.pid, token: a.token, theme: 'music' });
  assert.equal(closed.status, 409);
});

test('Quiz : un thème déjà joué est refusé au vote et au choix de l’animateur', async () => {
  const env = await room(memStore(), 2);
  const [a] = env.players;
  await cmd(env, 'series', { game: 'truefalse', total: 2, mode: 'solo' });
  await cmd(env, 'theme', { theme: 'sport' });
  await cmd(env, 'start');
  shiftRound(env, { startAt: Date.now() - 1000 });
  const ended = await cmd(env, 'end');
  assert.equal(ended.status, 200, ended.data.error);
  const st = state(env);
  assert.ok(st.playedThemes.includes('sport'));
  assert.equal(st.pending?.theme, 'vote', 'la manche suivante repasse au vote');
  const v = await call(env.store, 'vote', { room: env.code, pid: a.pid, token: a.token, theme: 'sport' });
  assert.equal(v.status, 409);
  const h = await cmd(env, 'theme', { theme: 'sport' });
  assert.equal(h.status, 409);
});
