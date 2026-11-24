// Jeux pilotés par le serveur, tour par tour : Quiz, Le bon tonneau, Bataille royale.
// Chaque jeu expose begin(round, st, now) et advance(round, picks, now) ; advance renvoie false quand la manche est finie.
// picks : Map pid → choix du joueur pour l'étape en cours (lu dans room/<code>/p/<pid>).
import { randomInt } from 'node:crypto';
import { luckyOrder, TF_COUNT } from '../../public/games.mjs';
import quizBank from './quiz-bank.mjs';
import { cupsTurn, cupsLevel } from '../../public/games.mjs';

const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const add = (round, pid, n) => { round.tally[pid] = (round.tally[pid] || 0) + n; };

// ---------- Quiz (quatre choix, une bonne réponse) ----------
// 10 questions ; 8 s pour répondre (5 s en Sprint), 2 s de répartition des votes, 5 s de réponse expliquée.
const TF = { ask: 8000, sprint: 5000, stats: 2000, answer: 5000 };
export const tfAsk = rule => rule === 'sprint' ? TF.sprint : TF.ask;
// Banque à plat : identifiant stable « thème:index ».
// Banque du Quiz : 3 000 questions à quatre choix (quiz-bank.json). Une question n'est jamais reposée dans la soirée.
const bank = quizBank.questions.map(q => ({ id: q.id, theme: q.theme, level: q.difficulty, text: q.question, options: q.choices, answer: q.correctIndex, why: q.explanation }));
// Progression d'une manche de 10 : 4 faciles, 4 moyennes, 2 difficiles (repli sur le niveau voisin si un thème en manque).
const MIX = [['facile', 4], ['moyen', 4], ['difficile', 2]];
export const quizThemes = [...new Set(bank.map(q => q.theme))];
export const bankFor = theme => theme && theme !== 'all' ? bank.filter(q => q.theme === theme) : bank;

const truefalse = {
  begin(round, st, now) {
    st.usedQuestions ||= [];
    const pool = bankFor(round.theme);
    let fresh = pool.filter(q => !st.usedQuestions.includes(q.id));
    if (fresh.length < TF_COUNT) {
      // Banque du thème épuisée : on la remet en jeu (l'animateur en est prévenu).
      st.usedQuestions = st.usedQuestions.filter(id => !pool.some(q => q.id === id));
      fresh = pool; round.recycled = true;
    }
    // Tirage par niveau, en alternant les thèmes (utile pour « Tous les thèmes »), du plus facile au plus difficile.
    const varied = (list, n) => {
      const byTheme = new Map();
      for (const q of shuffle(list)) { if (!byTheme.has(q.theme)) byTheme.set(q.theme, []); byTheme.get(q.theme).push(q); }
      const lanes = shuffle([...byTheme.values()]), out = [];
      while (out.length < n && lanes.some(l => l.length)) for (const l of lanes) if (l.length && out.length < n) out.push(l.shift());
      return out;
    };
    const picked = [];
    let missing = 0;
    for (const [level, n] of MIX) {
      const got = varied(fresh.filter(q => q.level === level && !picked.includes(q)), n + missing);
      picked.push(...got); missing = n + missing - got.length;
    }
    if (picked.length < TF_COUNT) picked.push(...varied(fresh.filter(q => !picked.includes(q)), TF_COUNT - picked.length));
    // Les quatre choix sont mélangés une fois, au lancement : même ordre sur le grand écran et les téléphones, même après rechargement.
    for (const [i, q] of picked.entries()) {
      const order = shuffle([0, 1, 2, 3]);
      picked[i] = { ...q, options: order.map(k => q.options[k]), answer: order.indexOf(q.answer) };
    }
    st.usedQuestions.push(...picked.map(q => q.id));
    round.questions = picked;
    round.out = {};
    round.stage = { step: 0, phase: 'choose', from: round.startAt, until: round.startAt + tfAsk(round.rule), total: picked.length };
  },
  advance(round, picks, now, times = new Map()) {
    const s = round.stage, q = round.questions[s.step];
    if (s.phase === 'choose') {
      const counts = q.options.map(() => 0);
      // Bonus de rapidité : +1 à la bonne réponse la plus rapide (heure serveur de la dernière réponse envoyée).
      let fastest = null;
      for (const [pid, value] of picks) if (value === q.answer && !round.out[pid] && (fastest === null || (times.get(pid) ?? Infinity) < (times.get(fastest) ?? Infinity))) fastest = pid;
      for (const [pid, value] of picks) {
        if (!Number.isInteger(value) || value < 0 || value >= q.options.length) continue;
        counts[value]++;
        round.played[pid] = true;
        if (round.out[pid]) continue;                       // Mort subite : déjà éliminé
        if (value === q.answer) add(round, pid, 1);
        else if (round.rule === 'sudden') round.out[pid] = s.step + 1;
      }
      if (round.rule === 'sudden') for (const pid of round.ids) if (!round.out[pid] && !picks.has(pid)) round.out[pid] = s.step + 1;   // pas de réponse = erreur
      if (fastest) add(round, fastest, 1);
      round.stage = { ...s, phase: 'stats', until: now + TF.stats, counts, fastest };
    } else if (s.phase === 'stats') round.stage = { ...s, phase: 'answer', until: now + TF.answer };
    else {
      if (s.step + 1 >= round.questions.length) return false;
      round.stage = { step: s.step + 1, phase: 'choose', from: now, until: now + tfAsk(round.rule), total: s.total };
    }
    return true;
  },
  // Ce que voit un joueur : jamais la réponse avant la phase « answer ».
  publicStage(round) {
    const s = round.stage, q = round.questions?.[s.step];
    return { ...s, text: q?.text, theme: q?.theme, options: q?.options, answer: s.phase === 'answer' ? q.answer : undefined, why: s.phase === 'answer' && !/^Réponse\s*:/i.test(q.why || '') ? q.why : undefined, out: round.out, scores: s.phase === 'choose' ? undefined : round.tally };   // l'explication « Réponse : X » répète la bonne réponse : on ne l'envoie pas
  },
  needsPicks: s => s.phase === 'choose',
  stageLength: (s, rule) => s.phase === 'choose' ? tfAsk(rule) : TF[s.phase],
};

// ---------- Le Bon Tonneau : survie sur 16 tonneaux (4 × 4) ----------
// À chaque tour, un poseur (en équipes : une équipe) est tiré au sort, sans répétition tant que chacun n'est pas passé.
// Dès qu'il y a des éliminés, le poseur est tiré parmi eux : ils restent dans la partie et prennent leur revanche.
// Fenêtre commune de 12 s : les joueurs choisissent un tonneau en secret (plusieurs joueurs par tonneau possible),
// les poseurs réservent des cases piégées distinctes (premier arrivé, premier servi). Le poseur est protégé pendant son tour.
// Pièges : solo 2 → 4 → … → 12 ; en équipes, par paliers de la taille de l'équipe (duo 2, 4… ; trio 3, 6, 9, 12 ; quatuor 4, 8, 12).
// Chaque palier dure 2 tours. Fin : il reste au plus un survivant (en équipes : une seule équipe en lice). S'il ne reste personne,
// les derniers éliminés sont ex æquo. Départage des ex æquo : le nombre de joueurs éliminés par ses pièges.
export const LK = { cells: 16, maxTraps: 12, announce: 3500, choose: 12000, revealBase: 2500, revealPer: 2600, turnsPerStep: 2, maxTurns: 24 };
const teamOfPid = (round, pid) => (round.teams || []).find(t => t.members.includes(pid));
function luckyPosers(round, st) {
  const s = round.stage;
  if (round.mode === 'team' && round.teams?.length) {
    const alive = new Set(s.alive);
    const candidates = round.teams.filter(t => t.members.some(pid => alive.has(pid)) || t.members.length);
    let pool = candidates.filter(t => !s.usedTeams.includes(t.id));
    if (!pool.length) { s.usedTeams = []; pool = candidates; }
    const team = pool[randomInt(pool.length)];
    s.usedTeams.push(team.id);
    return { posers: [...team.members], team: team.id, size: team.members.length };
  }
  const out = round.ids.filter(pid => !s.alive.includes(pid));
  const base = out.length ? out : s.alive;
  let pool = base.filter(pid => !s.usedPosers.includes(pid));
  if (!pool.length) { s.usedPosers = s.usedPosers.filter(pid => !base.includes(pid)); pool = base; }
  const pid = pool[randomInt(pool.length)];
  s.usedPosers.push(pid);
  return { posers: [pid], team: null, size: 1 };
}
export function luckyTraps(turn, size) {
  const step = Math.max(2, size), palier = Math.floor((turn - 1) / LK.turnsPerStep) + 1;
  return Math.min(LK.maxTraps, step * palier);
}
function startTurn(round, st, now, turn) {
  const s = round.stage;
  s.turn = turn; s.step = turn - 1;
  Object.assign(s, luckyPosers(round, st));
  s.trapCount = luckyTraps(turn, s.size);
  s.quota = Object.fromEntries(s.posers.map((pid, i) => [pid, Math.floor(s.trapCount / s.posers.length) + (i < s.trapCount % s.posers.length ? 1 : 0)]));
  s.traps = {}; s.phase = 'announce'; s.from = now; s.until = now + LK.announce; s.reveal = null;
}
const lucky = {
  begin(round, st, now) {
    round.kills = {};
    round.stage = { alive: [...round.ids], eliminated: {}, usedPosers: [], usedTeams: [] };
    startTurn(round, st, round.startAt, 1);
  },
  advance(round, picks, now) {
    const s = round.stage;
    if (s.phase === 'announce') { Object.assign(s, { phase: 'choose', from: now, until: now + LK.choose }); return true; }
    if (s.phase === 'choose') {
      // Pièges manquants (poseur absent ou trop lent) : complétés au hasard, pour respecter le nombre annoncé.
      const free = [...Array(LK.cells).keys()].filter(c => s.traps[c] === undefined);
      for (const pid of s.posers) {
        let mine = Object.values(s.traps).filter(x => x === pid).length;
        while (mine < s.quota[pid] && free.length) { s.traps[free.splice(randomInt(free.length), 1)[0]] = pid; mine++; }
      }
      const protectedIds = new Set(s.posers);
      const spots = {};
      for (const pid of s.alive) {
        if (protectedIds.has(pid)) continue;
        const v = picks.get(pid);
        if (Number.isInteger(v) && v >= 0 && v < LK.cells) { spots[pid] = v; round.played[pid] = true; }
        else spots[pid] = randomInt(LK.cells);          // pas de choix : tonneau tiré au hasard
      }
      // Révélation : d'abord les survivants sur leurs tonneaux, puis chaque poseur dévoile ses cases à tour de rôle.
      const order = s.posers.filter(pid => Object.values(s.traps).includes(pid));
      const lost = [], byPoser = {};
      for (const poser of order) {
        const cells = Object.entries(s.traps).filter(([, x]) => x === poser).map(([c]) => Number(c));
        const hit = Object.entries(spots).filter(([pid, c]) => cells.includes(c) && !lost.includes(pid)).map(([pid]) => pid);
        byPoser[poser] = { cells, hit };
        lost.push(...hit);
        round.kills[poser] = (round.kills[poser] || 0) + hit.length;
      }
      for (const pid of s.alive) if (!lost.includes(pid)) round.tally[pid] = (round.tally[pid] || 0) + 1;
      Object.assign(s, { phase: 'reveal', from: now, until: now + LK.revealBase + order.length * LK.revealPer,
        reveal: { spots, order, byPoser, lost, traps: s.traps },
        alive: s.alive.filter(pid => !lost.includes(pid)),
        eliminated: { ...s.eliminated, ...Object.fromEntries(lost.map(pid => [pid, s.turn])) } });
      return true;
    }
    // Fin de la révélation : partie finie ?
    const teamsLeft = round.mode === 'team' ? new Set(s.alive.map(pid => teamOfPid(round, pid)?.id).filter(Boolean)).size : null;
    const over = round.mode === 'team' ? teamsLeft <= 1 : s.alive.length <= 1;
    if (over || s.turn >= LK.maxTurns) return false;
    startTurn(round, null, now, s.turn + 1);
    return true;
  },
  // Les cases piégées restent secrètes pendant le choix (seuls les poseurs les voient, via la vue personnalisée).
  publicStage: round => {
    const { traps, ...rest } = round.stage;
    return { ...rest, trapsTaken: Object.keys(traps || {}).length, kills: round.kills, scores: round.tally };
  },
  needsPicks: s => s.phase === 'choose',
  stageLength: s => s.until - (s.from || 0),
};

// ---------- Bataille royale ----------
// Terrain : disque de rayon `zone` (1 au départ) ; coordonnées entre −1 et 1.
// Placement + visée dans une même phase de 8 s ; révélation 9 s (positions, tirs, touchés, puis le temps de comprendre).
// Joueurs plus petits (0,06) pour que toucher reste difficile. Zone : classique, elle rétrécit à partir du tour 2 ;
// en « Zone express », dès le tour 1, plus vite et plus loin.
const AR = { plan: 8000, reveal: 9000, hit: 0.06, maxTurns: 12 };   // AUDIT : plafond de tours (ex æquo des survivants)
const SHRINK = { classic: { from: 2, factor: 0.85, min: 0.35, hitStep: 0.01, hitMax: 0.12 }, shrink: { from: 1, factor: 0.72, min: 0.25, hitStep: 0.015, hitMax: 0.14 } };

function randomSpot(zone) {
  const r = Math.sqrt(randomInt(1000) / 1000) * zone * 0.9, a = randomInt(3600) / 3600 * Math.PI * 2;
  return [r * Math.cos(a), r * Math.sin(a)];
}
function clampToZone([x, y], zone) {
  const d = Math.hypot(x, y);
  return d <= zone ? [x, y] : [x / d * zone, y / d * zone];
}

export function resolveShots(shots, hit) {
  // Chaque tir part du tireur et s'arrête sur la première cible dont il frôle le disque (rayon `hit`).
  const hits = new Map();
  for (const shot of shots) {
    const dx = Math.cos(shot.angle), dy = Math.sin(shot.angle);
    let best = null;
    for (const target of shots) {
      if (target.pid === shot.pid) continue;
      const tx = target.pos[0] - shot.pos[0], ty = target.pos[1] - shot.pos[1];
      const along = tx * dx + ty * dy;
      if (along <= 0) continue;
      const side = Math.abs(tx * dy - ty * dx);
      if (side <= hit && (!best || along < best.along)) best = { pid: target.pid, along };
    }
    shot.target = best?.pid || null;
    shot.length = best ? best.along : 2.4;
    if (best) hits.set(best.pid, (hits.get(best.pid) || 0) + 1);
  }
  return hits;
}

const arena = {
  begin(round, st, now) {
    round.stage = { step: 0, turn: 1, phase: 'choose', until: round.startAt + AR.plan, zone: 1, hit: AR.hit, quiet: 0,
      survivors: [...round.ids], eliminated: {}, shields: round.rule === 'shield' ? [...round.ids] : [] };
  },
  advance(round, picks, now) {
    const s = round.stage;
    if (s.phase === 'reveal') {
      if (s.survivors.length <= 1 || s.turn >= AR.maxTurns) return false;
      round.stage = { ...s, step: s.step + 1, turn: s.turn + 1, phase: 'choose', until: now + AR.plan, zone: s.nextZone, hit: s.nextHit, reveal: null };
      return true;
    }
    const shots = s.survivors.map(pid => {
      const v = picks.get(pid) || {};
      const valid = Array.isArray(v.pos) && v.pos.length === 2 && v.pos.every(Number.isFinite);
      if (valid || Number.isFinite(v.angle)) round.played[pid] = true;
      const pos = clampToZone(valid ? v.pos : randomSpot(s.zone), s.zone);
      const angle = Number.isFinite(v.angle) ? v.angle : randomInt(3600) / 3600 * Math.PI * 2;
      return { pid, pos: pos.map(n => Math.round(n * 1000) / 1000), angle: Math.round(angle * 1000) / 1000, auto: !valid };
    });
    const hits = resolveShots(shots, s.hit);
    const blocked = [...hits.keys()].filter(pid => s.shields.includes(pid));
    const lost = [...hits.keys()].filter(pid => !s.shields.includes(pid));
    const quiet = lost.length ? 0 : s.quiet + 1;
    const z = SHRINK[round.rule === 'shrink' ? 'shrink' : 'classic'];
    const shrink = s.turn >= z.from && s.zone > z.min;
    round.stage = {
      ...s, phase: 'reveal', until: now + AR.reveal, quiet: shrink ? 0 : quiet,
      survivors: s.survivors.filter(pid => !lost.includes(pid)),
      shields: s.shields.filter(pid => !hits.has(pid)),
      eliminated: { ...s.eliminated, ...Object.fromEntries(lost.map(pid => [pid, s.turn])) },
      nextZone: shrink ? Math.max(z.min, Math.round(s.zone * z.factor * 100) / 100) : s.zone,
      nextHit: shrink ? Math.min(z.hitMax, Math.round((s.hit + z.hitStep) * 1000) / 1000) : s.hit,
      reveal: { shots, lost, blocked, shrink },
    };
    return true;
  },
  publicStage: round => round.stage,
  needsPicks: s => s.phase === 'choose',
  stageLength: s => s.phase === 'choose' ? AR.plan : AR.reveal,
};

// Score de la Bataille : tour d'élimination ; les survivants ont le tour final + 1 (ex æquo possibles).
export function arenaScores(round) {
  const s = round.stage;
  return Object.fromEntries(round.ids.map(pid => [pid, s.eliminated[pid] ?? s.turn + 1]));
}

// ---------- Bonneteau survie ----------
// Chaque tour : mélange montré à tous (« show »), choix sans chrono affiché (« choose », révélé dès que tous les survivants
// ont répondu ; garde-fou de 25 s), puis révélation (« reveal »). Un tour réussi avant la première erreur = 1 point.
// Après une erreur, le score se fige ; le joueur peut continuer pour le plaisir. Le dernier survivant joue jusqu'à sa première erreur.
const CS = { choose: 25000, reveal: 3200, maxTurns: 40 };
const cups = {
  begin(round, st, now) {
    const plan = cupsTurn(round.id, 0);
    round.stage = { step: 0, turn: 1, phase: 'show', from: round.startAt, until: round.startAt + plan.t1, alive: [...round.ids], eliminated: {} };
  },
  advance(round, picks, now) {
    const s = round.stage, k = s.turn - 1;
    if (s.phase === 'show') { round.stage = { ...s, phase: 'choose', from: now, until: now + CS.choose }; return true; }
    if (s.phase === 'choose') {
      const ball = cupsTurn(round.id, k).final[cupsTurn(round.id, k).ball];   // emplacement final du raisin
      const lost = [], picked = {};
      for (const [pid, v] of picks) { picked[pid] = v; round.played[pid] = true; }
      for (const pid of s.alive) {
        if (picks.get(pid) === ball) add(round, pid, 1);
        else lost.push(pid);                                  // mauvais gobelet ou pas de réponse
      }
      round.stage = { ...s, phase: 'reveal', from: now, until: now + CS.reveal, ball, picked,
        alive: s.alive.filter(pid => !lost.includes(pid)), lost,
        eliminated: { ...s.eliminated, ...Object.fromEntries(lost.map(pid => [pid, s.turn])) } };
      return true;
    }
    // Fin de la révélation : on continue tant qu'il reste au moins un survivant (le dernier joue jusqu'à sa première erreur).
    if (!s.alive.length || s.turn >= CS.maxTurns) return false;
    const plan = cupsTurn(round.id, s.turn);
    round.stage = { step: s.step + 1, turn: s.turn + 1, phase: 'show', from: now, until: now + plan.t1, alive: s.alive, eliminated: s.eliminated };
    return true;
  },
  publicStage: round => ({ ...round.stage, level: cupsLevel(round.stage.turn - 1), scores: round.tally }),
  needsPicks: s => s.phase === 'choose',
  stageLength: s => s.until - (s.from || 0),
};

export const staged = { truefalse, lucky, arena, cups };
// Le bonneteau a deux modes : Classique (joué sur chaque téléphone, comme les jeux chronométrés) et Survie (piloté par le serveur).
export const stagedFor = (game, rule) => (game === 'cups' && rule !== 'survie' ? null : staged[game] || null);
