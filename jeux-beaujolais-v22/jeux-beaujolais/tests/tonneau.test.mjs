import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staged, luckyTraps } from '../netlify/lib/staged.mjs';

const mk = (ids, extra = {}) => ({ id: 'r-lucky', ids, played: {}, out: {}, tally: {}, startAt: 0, rule: 'classic', ...extra });
const L = staged.lucky;

test('Bon Tonneau : paliers de pièges (solo 2→12, duo, trio 3-6-9-12, quatuor 4-8-12), 2 tours par palier', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 11, 12, 13].map(t => luckyTraps(t, 1)), [2, 2, 4, 4, 6, 6, 12, 12, 12]);
  assert.deepEqual([1, 3, 5, 7].map(t => luckyTraps(t, 3)), [3, 6, 9, 12]);
  assert.deepEqual([1, 3, 5, 7].map(t => luckyTraps(t, 4)), [4, 8, 12, 12]);
  assert.deepEqual([1, 3, 11].map(t => luckyTraps(t, 2)), [2, 4, 12]);
});

test('Bon Tonneau solo : poseur protégé, pièges à son nom, éliminés sur les cases piégées', () => {
  const round = mk(['a', 'b', 'c', 'd']);
  L.begin(round, {}, 0);
  const s = round.stage;
  assert.equal(s.posers.length, 1);
  assert.equal(s.trapCount, 2);
  const poser = s.posers[0], others = round.ids.filter(p => p !== poser);
  L.advance(round, new Map(), 10);                       // annonce → choix
  s.traps = { 0: poser, 5: poser };
  const picks = new Map([[others[0], 0], [others[1], 0], [others[2], 9], [poser, 0]]);
  L.advance(round, picks, 20);                            // choix → révélation
  assert.deepEqual(round.stage.reveal.lost.sort(), [others[0], others[1]].sort(), 'deux joueurs sur le même tonneau piégé');
  assert.ok(round.stage.alive.includes(poser), 'le poseur est protégé');
  assert.equal(round.kills[poser], 2);
  assert.equal(L.advance(round, new Map(), 30), true, 'il reste 2 survivants : tour suivant');
  assert.ok(others.slice(0, 2).includes(round.stage.posers[0]), 'le nouveau poseur est tiré parmi les éliminés');
});

test('Bon Tonneau : un poseur qui élimine tout le monde gagne', () => {
  const round = mk(['a', 'b']);
  L.begin(round, {}, 0);
  const poser = round.stage.posers[0], other = round.ids.find(p => p !== poser);
  L.advance(round, new Map(), 10);
  round.stage.traps = { 3: poser, 4: poser };
  L.advance(round, new Map([[other, 3]]), 20);
  assert.deepEqual(round.stage.alive, [poser]);
  assert.equal(L.advance(round, new Map(), 30), false, 'un seul survivant : fin');
  assert.ok((round.tally[poser] || 0) > (round.tally[other] || 0));
});

test('Bon Tonneau en équipes : une équipe pose, pièges répartis équitablement, rotation sans répétition', () => {
  const teams = [{ id: 't0', name: 'Team Or', members: ['a', 'b', 'c'] }, { id: 't1', name: 'Team Argent', members: ['d', 'e', 'f'] }];
  const round = mk(['a', 'b', 'c', 'd', 'e', 'f'], { mode: 'team', teams });
  L.begin(round, {}, 0);
  const first = round.stage.team;
  assert.equal(round.stage.trapCount, 3);
  assert.deepEqual(Object.values(round.stage.quota), [1, 1, 1]);
  L.advance(round, new Map(), 10); L.advance(round, new Map(), 20);   // pièges complétés au hasard, joueurs placés au hasard
  assert.equal(Object.keys(round.stage.reveal.traps).length, 3, 'pièges manquants complétés');
  if (L.advance(round, new Map(), 30)) assert.notEqual(round.stage.team, first, 'l’autre équipe pose au tour 2');
});
