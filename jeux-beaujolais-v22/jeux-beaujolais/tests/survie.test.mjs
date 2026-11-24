import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staged } from '../netlify/lib/staged.mjs';
import { cupsTurn, cupsLevel } from '../public/games.mjs';

const ballOf = (round, turn) => { const p = cupsTurn(round.id, turn - 1); return p.final[p.ball]; };
const newRound = ids => ({ id: 'r-survie', ids, played: {}, out: {}, tally: {}, startAt: 0, rule: 'classic' });

test('bonneteau survie : la difficulté monte par petites hausses', () => {
  assert.deepEqual(cupsLevel(0), { g: 3, s: 4, d: 0.45, f: 0 });
  assert.equal(cupsLevel(1).s, 5);
  assert.ok(cupsLevel(1).d < cupsLevel(0).d, 'tour 2 un peu plus rapide');
  assert.equal(cupsLevel(3).g, 4, 'quatre gobelets au tour 4');
  for (let k = 1; k < 30; k++) assert.ok(cupsLevel(k).s >= cupsLevel(k - 1).s && cupsLevel(k).d <= cupsLevel(k - 1).d);
});

test('bonneteau survie : 1 point par tour réussi, score figé à la première erreur, dernier survivant joue jusqu’à son erreur', () => {
  const round = newRound(['a', 'b', 'c']);
  const s = staged.cups;
  s.begin(round, {}, 0);
  const turn = (picks, now) => { s.advance(round, new Map(), now); s.advance(round, new Map(Object.entries(picks)), now + 1); };
  // Tour 1 : a et b réussissent, c se trompe.
  let ball = ballOf(round, 1);
  turn({ a: ball, b: ball, c: (ball + 1) % 3 }, 1000);
  assert.deepEqual(round.stage.alive, ['a', 'b']);
  assert.equal(round.stage.eliminated.c, 1);
  assert.equal(s.advance(round, new Map(), 2000), true, 'il reste des survivants : tour suivant');
  // Tour 2 : c joue « pour le plaisir » (bon gobelet) : son score reste figé. a se trompe, b réussit.
  ball = ballOf(round, 2);
  turn({ a: (ball + 1) % 3, b: ball, c: ball }, 3000);
  assert.deepEqual(round.stage.alive, ['b']);
  assert.equal(round.tally.c, undefined, 'score figé après l’élimination');
  assert.equal(s.advance(round, new Map(), 4000), true, 'le dernier survivant continue');
  // Tour 3 : b n'a pas répondu = erreur ; la partie s'arrête.
  s.advance(round, new Map(), 5000); s.advance(round, new Map(), 5001);
  assert.deepEqual(round.stage.alive, []);
  assert.equal(s.advance(round, new Map(), 6000), false, 'plus de survivant : fin');
  assert.deepEqual(round.tally, { a: 1, b: 2 });
});

test('bonneteau survie : éliminés au même tour = même score (ex æquo)', () => {
  const round = newRound(['a', 'b']);
  staged.cups.begin(round, {}, 0);
  staged.cups.advance(round, new Map(), 10);
  const ball = ballOf(round, 1);
  staged.cups.advance(round, new Map([['a', (ball + 1) % 3], ['b', (ball + 2) % 3]]), 20);
  assert.equal(round.tally.a ?? 0, round.tally.b ?? 0);
  assert.equal(staged.cups.advance(round, new Map(), 30), false);
});


test('bonneteau : le mode Classique reste joué sur les téléphones, la Survie est pilotée par le serveur', async () => {
  const { stagedFor } = await import('../netlify/lib/staged.mjs');
  const { duration } = await import('../public/games.mjs');
  assert.equal(stagedFor('cups', 'classic'), null);
  assert.equal(stagedFor('cups', 'sudden'), null);
  assert.ok(stagedFor('cups', 'survie'));
  assert.ok(duration('cups', 'classic') > 30, 'Classique : durée fixe des 10 séries');
});
