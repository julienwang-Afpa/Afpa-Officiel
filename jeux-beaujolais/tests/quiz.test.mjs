import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staged } from '../netlify/lib/staged.mjs';
import { themes } from '../public/games.mjs';
import quizBank from '../netlify/lib/quiz-bank.mjs';

test('banque : 3 000 questions à quatre choix, une seule bonne réponse, identifiants uniques', () => {
  const qs = quizBank.questions;
  assert.equal(qs.length, 3000);
  assert.equal(new Set(qs.map(q => q.id)).size, 3000);
  for (const q of qs) {
    assert.equal(q.choices.length, 4, q.id);
    assert.ok(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4, q.id);
    assert.ok(q.explanation.trim(), q.id);
  }
});

test('thèmes du menu : toutes les catégories de la banque sont proposées, sans compteur', () => {
  for (const id of new Set(quizBank.questions.map(q => q.theme))) assert.ok(themes[id], `thème ${id}`);
});

test('une question déjà posée ne revient pas dans la soirée', () => {
  const st = {}, round = { theme: 'general', ids: ['a', 'b'], played: {}, out: {}, tally: {}, startAt: 0, rule: 'normal' };
  staged.truefalse.begin(round, st, 0);
  const first = round.questions.map(q => q.id);
  assert.equal(first.length, 10);
  const next = { ...round, questions: undefined, tally: {}, out: {} };
  staged.truefalse.begin(next, st, 0);
  const second = next.questions.map(q => q.id);
  assert.equal(second.filter(id => first.includes(id)).length, 0, 'aucune répétition entre deux manches');
});

test('réponse : indice 0 à 3, la bonne réponse rapporte un point, un indice hors plage est ignoré', () => {
  const st = {}, round = { theme: 'general', ids: ['p'], played: {}, out: {}, tally: {}, startAt: 0, rule: 'normal' };
  staged.truefalse.begin(round, st, 0);
  const q = round.questions[0];
  const picks = new Map([['p', q.answer], ['x', 9]]);
  staged.truefalse.advance(round, picks, 1000);
  assert.equal(round.tally.p, 1);
  assert.equal(round.tally.x, undefined);
  assert.equal(round.stage.counts.reduce((a, b) => a + b, 0), 1, 'seul le choix valide est compté');
});

test('choix mélangés : la bonne réponse suit le mélange, et la progression va du facile au difficile', () => {
  const st = {}, round = { theme: 'language', ids: ['p'], played: {}, out: {}, tally: {}, startAt: 0, rule: 'normal' };
  staged.truefalse.begin(round, st, 0);
  const byId = new Map(quizBank.questions.map(q => [q.id, q]));
  for (const q of round.questions) {
    const src = byId.get(q.id);
    assert.equal(q.options[q.answer], src.choices[src.correctIndex], q.id);
    assert.deepEqual([...q.options].sort(), [...src.choices].sort());
  }
  const rank = { facile: 0, moyen: 1, difficile: 2 };
  const levels = round.questions.map(q => rank[q.level]);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), 'du plus facile au plus difficile');
  assert.equal(levels.filter(l => l === 2).length, 2, 'Langue française a des questions difficiles : 2 par manche');
});

test('thème sans question difficile : la manche reste à 10 questions', () => {
  const round = { theme: 'general', ids: ['p'], played: {}, out: {}, tally: {}, startAt: 0, rule: 'normal' };
  staged.truefalse.begin(round, {}, 0);
  assert.equal(round.questions.length, 10);
});
