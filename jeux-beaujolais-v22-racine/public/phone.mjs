// Téléphone du joueur : inscription, attente, règles, jeux, résultats.
import { S, api, $, esc, show, status, now, storage, resetScreen, vibrate, plural, app } from './core.mjs';
import { colors, colorNames, games, ruleNames, ruleText, themes, standings, isRed, fruits, memorySequence, memoryPalette, memoryStageAt, memoryPlan, reactionPlan, REACTION_TRY, BARREL, cupsTurn, cupsPlan, cupsPose, CUPS, perfLabel, teamSymbol } from './games.mjs';
import { easyWords, hardWords } from './words.mjs';
import { chip, ruleCard, pointsHelpHTML, timer, setTimer, standingsHTML, animateStandings, gameBoardHTML, generalBoardHTML, confetti, floatText, flash, perf } from './ui.mjs';
import { arenaSVG, arenaSummary, barrelsHTML, luckyTitle, livesHTML } from './boards.mjs';

const GRACE = 2500;
let colorChoice = colors[Math.floor(Math.random() * colors.length)], nickname = '';
let ctl = null;            // progression locale de la manche en cours (jeux individuels)
let game = null;           // jeu monté à l'écran : { tick() }
let pickQueue = null, pickSending = false, sending = false;
const ctlKey = () => `beaujolais.ctl.v3.${S.session.room}`;
const me = () => S.state?.players.find(p => p.pid === S.session.pid);

// ---------- Aiguillage ----------
export function renderPhone() {
  const st = S.state;
  if (!st) return;
  if (!st.joined) return registration();
  const round = st.round;
  if (round && !round.results && !round.playing) return spectator(st, round);
  if (round && !round.results) return playing(st, round);
  if (st.duel && !st.duel.winner && round?.id === st.duel.round) return duelPhone(st);
  if (round?.results && round.playing) return results(st, round);
  lobby(st);
}

const myTeam = st => (st.teams || []).find(t => t.members.includes(S.session.pid)) || null;

// En-tête : nom de l'équipe et coéquipiers (mode équipes), puis mon total et mon rang.
// Pendant les résultats, l'équipe affichée est celle enregistrée pour la manche (round.teams), pas celle du salon en cours.
function header(st, round) {
  const p = me(), rows = standings(st.players, st.totals), mine = rows.find(r => r.pid === S.session.pid);
  const team = round?.mode === 'team' && round.teams ? round.teams.find(t => t.members.includes(S.session.pid)) || null : myTeam(st);
  const mates = team ? team.members.filter(pid => pid !== S.session.pid).map(pid => st.players.find(x => x.pid === pid)?.name).filter(Boolean) : [];
  const teamHead = team ? `<span class="team-head"><b style="--c:${esc(team.color)}"><i></i>${teamSymbol(team.name)} ${esc(team.name)}</b><small>${mates.length ? `avec ${esc(mates.join(', '))}` : 'seul dans son équipe'}</small></span>`
    : st.series?.mode === 'team' && st.teams ? '<span class="tag gold">Pas d’équipe</span>' : '';
  return `<div class="phone-top"><div class="who">${p ? chip(p) : ''}${p?.helper ? '<span class="tag">Renfort</span>' : ''}${teamHead}</div><span class="my-total"><b>${mine?.total || 0}</b> pt${(mine?.total || 0) > 1 ? 's' : ''} · ${mine?.rank || '–'}<sup>${mine?.rank === 1 ? 'er' : 'e'}</sup>${mine?.rank ? ` sur ${rows.length}` : ''}</span></div>`;
}

// Zone d'action fixe de la Course : « TAPE ICI » dès le décompte, « STOP » au feu rouge.
const tapZone = (label, disabled) => `<button class="tap-barrel" id="tap" ${disabled ? 'disabled' : ''} aria-label="Taper sur le tonneau"><span>${BARREL}</span><em class="tap-label" id="tap-label">${label}</em></button>`;

// ---------- Inscription ----------
function registration() {
  // Couleurs déjà prises : grisées, pour que chacun se repère sur l'écran (surtout dans la Bataille royale).
  const taken = new Set((S.state?.players || []).map(p => p.color));
  if (taken.size >= colors.length) taken.clear();
  if (taken.has(colorChoice)) { const free = colors.filter(c => !taken.has(c)); colorChoice = free[Math.floor(Math.random() * free.length)]; }
  const typing = document.activeElement?.id === 'name';
  if (!show(`registration/${[...taken].join()}`, `<section class="card welcome">
      <p class="eyebrow">Bienvenue aux</p>
      <h1>Les Jeux du Beaujolais</h1>
      <form id="join" autocomplete="off">
        <label for="name">Ton prénom ou pseudo</label>
        <input id="name" required maxlength="16" autocomplete="nickname" enterkeyhint="go" placeholder="Ex. : Julie">
        <p class="label">Choisis ta couleur</p>
        <div class="swatches">${colors.map((c, i) => `<button type="button" style="--c:${c}" data-color="${c}" aria-label="${colorNames[i]}${taken.has(c) ? ' (déjà prise)' : ''}" aria-pressed="${c === colorChoice}" ${taken.has(c) ? 'disabled' : ''}></button>`).join('')}</div>
        <p class="color-name" id="color-name">${colorNames[colors.indexOf(colorChoice)]}</p>
        <button class="primary huge" id="join-btn">Entrer dans la partie</button>
        <p class="muted small center">Code de la partie : <b class="code">${esc(S.session.room)}</b></p>
      </form>
    </section>`)) return;
  $('name').value = nickname;
  $('name').oninput = e => { nickname = e.target.value; };
  if (typing) $('name').focus();
  $('join').onsubmit = join;
  document.querySelectorAll('[data-color]').forEach(b => b.onclick = () => {
    colorChoice = b.dataset.color;
    document.querySelectorAll('[data-color]').forEach(x => x.setAttribute('aria-pressed', x === b));
    $('color-name').textContent = colorNames[colors.indexOf(colorChoice)];
  });
}

async function join(event) {
  event.preventDefault();
  if (S.busy) return;
  S.busy = true;
  nickname = $('name').value.trim();
  $('join-btn').disabled = true;
  try {
    for (let attempt = 0; ; attempt++) {
      try { S.state = await api('join', { name: nickname, color: colorChoice }); break; }
      catch (e) {
        if (attempt === 3 || (e.status && e.status !== 503)) throw e;
        await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
      }
    }
    keepAwake();
    resetScreen();
    renderPhone();
  } catch (e) {
    status(e.message, 'error');
    if ($('join-btn')) $('join-btn').disabled = false;
  } finally { S.busy = false; }
}

// L'écran reste allumé pendant la soirée (si le navigateur le permet).
let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* facultatif */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.state?.joined && !wakeLock?.released === false) keepAwake(); });

// ---------- Attente entre les manches ----------
function nextCard(st) {
  // Pas de bloc de règles sur le téléphone : l'animateur les explique à l'oral. On garde le jeu, la variante et le vote.
  if (st.pending && st.series) {
    const g = games[st.series.game], rule = st.pending.rule;
    const head = `<section class="card next-mini"><p class="eyebrow">Prochaine manche · ${st.series.played + 1} / ${st.series.total}</p>
      <h2><span aria-hidden="true">${g.icon}</span> ${esc(g.name)}</h2>${rule && rule !== 'classic' ? `<p class="variant-chip">Variante · ${esc(ruleNames(rule))}</p>` : ''}${st.pending.practice ? '<p class="variant-chip">Manche d’essai</p>' : ''}</section>`;
    return head + (st.series.game === 'truefalse' ? voteCard(st) : '');
  }
  return `<div class="card waiting"><div class="grapes" aria-hidden="true">🍇</div><h2>L’animateur prépare le prochain jeu</h2><p class="muted">Garde cette page ouverte : tout se lance automatiquement.</p></div>`;
}

// Entre deux manches : ta position et l'écart avec le joueur devant, pour donner un objectif.
function positionCard(st) {
  if (!Object.keys(st.totals || {}).length) return '';
  const rows = standings(st.players, st.totals), mine = rows.find(r => r.pid === S.session.pid);
  if (!mine) return '';
  const ahead = rows.filter(r => r.total > mine.total).at(-1);
  return `<section class="card position-card"><p class="eyebrow">Ta position</p>
    <p class="pos-big"><b>${mine.rank}<sup>${mine.rank === 1 ? 'er' : 'e'}</sup></b> sur ${rows.length} · ${mine.total} pt${mine.total > 1 ? 's' : ''}</p>
    <p class="muted">${ahead ? `À ${ahead.total - mine.total} pt${ahead.total - mine.total > 1 ? 's' : ''} de ${esc(ahead.name)}` : '👑 Tu mènes la soirée'}</p></section>`;
}

// Quiz : vote du thème. Les thèmes déjà joués ce soir ne sont pas proposés.
function voteCard(st) {
  const chosen = st.pending.theme || 'vote';
  if (chosen !== 'vote') return `<section class="card"><p>Thème choisi par l’animateur : <b>${esc(themes[chosen] || '')}</b></p></section>`;
  const played = st.playedThemes || [], mine = st.pending.votes?.[S.session.pid];
  const left = st.pending.voteOptions || Object.keys(themes).filter(t => t !== 'all' && !played.includes(t));
  if (!left.length) return '<section class="card"><p>Tous les thèmes ont été joués : questions de tous les thèmes.</p></section>';
  return `<section class="card vote"><h3>Vote pour le thème</h3><p class="muted small">La roulette tire parmi les thèmes votés</p><p class="muted">${mine ? '✓ Vote enregistré · tu peux changer' : 'Touche un thème'}</p>
    <div class="vote-grid">${left.map(t => `<button type="button" class="vote-opt" data-vote="${t}" aria-pressed="${mine === t}">${esc(themes[t])}</button>`).join('')}</div></section>`;
}

function bindVote() {
  app.querySelectorAll('[data-vote]').forEach(b => b.onclick = async () => {
    const theme = b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.vote;
    app.querySelectorAll('[data-vote]').forEach(x => x.setAttribute('aria-pressed', x === b && theme !== null));
    try { const data = await api('vote', { theme }); S.state = { ...S.state, ...data }; renderPhone(); }
    catch (e) { status(e.message); }
  });
}

function lobby(st) {
  const p = me();
  show(`lobby/${JSON.stringify([st.pending, st.series?.game, st.totals[S.session.pid], st.players.length, st.playedThemes])}`, `${header(st)}
    ${!st.round && !Object.keys(st.totals).length ? `<section class="card hello"><h1>Salut ${esc(p?.name)} !</h1><p>Tu es dans la partie. ${plural(st.players.length, 'joueur')} connecté${st.players.length > 1 ? 's' : ''}.</p>${pointsHelpHTML()}</section>` : ''}
    ${positionCard(st)}${nextCard(st)}`);
  bindVote();
}

function spectator(st, round) {
  show(`spect/${round.id}`, `${header(st)}<section class="card waiting"><div class="grapes" aria-hidden="true">${games[round.game].icon}</div>
    <h2>Manche en cours : ${esc(games[round.game].name)}</h2><p>Tu es arrivé pendant la manche. Tu joueras la suivante ! Regarde le projecteur en attendant.</p></section>`);
}

// ---------- Résultats ----------
function results(st, round) {
  const mine = round.results.find(r => r.pid === S.session.pid);
  const n = round.results.filter(r => r.played).length;
  const key = `res/${round.id}/${JSON.stringify([st.pending, st.series?.game, st.playedThemes])}`;
  // En équipes, ce qui compte est le rang de l'équipe (pas de points individuels) : on l'affiche en gros.
  const myTeamRes = round.mode === 'team' ? (round.teamResults || []).find(t => t.members.includes(S.session.pid)) : null;
  const nTeams = (round.teamResults || []).filter(t => t.rank).length;
  const shownRank = myTeamRes ? myTeamRes.rank : mine?.rank;
  const medal = !mine?.played ? '😴' : shownRank === 1 ? '🥇' : shownRank === 2 ? '🥈' : shownRank === 3 ? '🥉' : '🍇';
  const fresh = show(key, `${header(st, round)}
    ${st.pending ? nextCard(st) : ''}
    <section class="card result-me ${shownRank === 1 ? 'winner' : ''}">
      <div class="medal" aria-hidden="true">${medal}</div>
      <h2>${myTeamRes?.rank ? `${esc(myTeamRes.name)} : ${myTeamRes.rank}<sup>${myTeamRes.rank === 1 ? 're' : 'e'}</sup> sur ${nTeams}` : mine?.played ? `${mine.rank}<sup>${mine.rank === 1 ? 'er' : 'e'}</sup> sur ${n}` : 'Pas de score reçu'}</h2>
      <p class="perf">${mine ? `${myTeamRes ? 'Ta contribution : ' : ''}${esc(perf(round, mine))}` : ''}</p>
      <p class="gain">${round.practice ? 'Manche d’essai : points non comptés' : round.mode === 'team' ? `+${mine?.teamBonus || 0} bonus d’équipe au général` : `+${mine?.points || 0} point${(mine?.points || 0) > 1 ? 's' : ''}`}</p>
    </section>
    ${mine?.bonus ? '<p class="banner">⚡ Bonus Mémoire Flash : tu es le plus rapide à avoir tout réussi, +1 point !</p>' : ''}
    
    ${round.practice ? '' : `${round.mode === 'team' ? '' : `<section class="card"><h3>Classement ${esc(games[round.game].name)}</h3>${gameBoardHTML(st.players, round.game, st.perfByGame?.[round.game], st.byGame?.[round.game], S.session.pid, 8)}</section>`}
    <section class="card"><h3>Classement général</h3>${generalBoardHTML(st.players, st.totals, { bonuses: st.bonusTotals, gains: Object.fromEntries(Object.keys(st.totals).map(pid => [pid, st.totals[pid] - (round.before?.[pid] || 0)]).filter(([, v]) => v > 0)), teams: round.mode === 'team' ? round.teams : null, me: S.session.pid, limit: 10, compact: true, before: round.before })}</section>`}`);
  bindVote();
  if (!fresh) return;
  if (mine?.rank === 1 && mine.played) { confetti(50); vibrate([60, 40, 120]); }
  if (!round.practice) {
    // Les classements s'affichent directement avec les totaux à jour (plus de « 0 » en attendant une animation).
    setTimeout(() => document.querySelector('.standings .me')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 800);
  }
}

// Résultat de mon équipe sur cette manche (mode équipes).
function teamCard(round) {
  const team = round.teamResults?.find(t => t.members.includes(S.session.pid));
  if (!team) return '';
  return `<section class="card team-me" style="--c:${esc(team.color)}"><h3><i></i>${esc(team.name)}</h3>
    <p>${team.rank ? `${team.rank}<sup>${team.rank === 1 ? 're' : 'e'}</sup> équipe sur ${round.teamResults.filter(t => t.rank).length}` : 'Pas de score d’équipe'} · ${esc(perfLabel(round.game, team.perf))}${team.bonus ? ` · bonus <b>+${team.bonus}</b>` : ''}</p></section>`;
}

// ---------- Manche en cours ----------
function phoneControl(round) {
  if (ctl?.id === round.id) return ctl;
  const saved = storage.load(ctlKey());
  const remote = S.state.mine?.score?.round === round.id ? S.state.mine.score : null;
  ctl = saved?.id === round.id ? saved : { id: round.id, seq: remote?.seq || 0, ack: remote?.seq || 0, raw: remote?.raw || 0, score: remote?.score || 0, tb: remote?.tb };
  return ctl;
}
const persist = () => storage.save(ctlKey(), ctl);
function overLine(round) {
  const mine = ctl?.id === round.id;
  if (round.game === 'reaction') return mine && ctl.raw ? `Ton meilleur temps : <b>${ctl.raw} ms</b>` : 'Aucun temps valide cette fois.';
  return mine && ctl.seq ? `Ton score : <b>${ctl.score}</b>` : '';
}

function commit(raw, score, tb) {
  ctl.raw = raw; ctl.score = score; ctl.tb = tb; ctl.seq++;
  persist();
  if ($('sc')) $('sc').textContent = score;
}

function phase(round) {
  const t = now();
  if (t < round.startAt) return 'count';
  if (round.stage) return `s${round.stage.step}-${round.stage.phase}`;
  if (t >= round.endAt) return 'over';
  if (round.game === 'memory') { const m = memoryStageAt(t - round.startAt); return m ? `m${m.index}-${m.phase}` : 'over'; }
  return 'play';
}

function playing(st, round) {
  const ph = phase(round);
  const g = games[round.game];
  if (ph === 'count') {
    if (show(`count/${round.id}`, `<div class="phone-play"><section class="card next-mini"><h2><span aria-hidden="true">${g.icon}</span> ${esc(g.name)}</h2>${round.game === 'truefalse' && round.theme ? `<p class="variant-chip" id="theme-chip">${round.vote?.wheel?.length ? '🎡 La roulette tourne…' : `Thème · ${esc(themes[round.theme] || '')}`}</p>` : ''}${round.rule && round.rule !== 'classic' ? `<p class="variant-chip">Variante · ${esc(ruleNames(round.rule))}</p>` : ''}</section>
        <div class="countdown small"><span>C’est parti dans</span><b id="count"></b></div>${round.game === 'barrels' ? tapZone('TAPE ICI', true) : ''}</div>`)) game = null;
    if ($('count')) $('count').textContent = Math.max(1, Math.ceil((round.startAt - now()) / 1000));
    // Le thème apparaît sur le téléphone au moment où la roulette s'arrête sur le grand écran.
    const chip = $('theme-chip');
    if (chip && round.vote?.wheel?.length && now() >= round.startAt - 1800 && !chip.dataset.done) { chip.dataset.done = '1'; chip.textContent = `🎯 Thème · ${themes[round.theme] || ''}`; vibrate([40, 30, 80]); }
    return;
  }
  if (ph === 'over') {
    if (show(`over/${round.id}`, `<section class="card center-msg"><div class="big-emoji" aria-hidden="true">⏱️</div><h2>Temps écoulé !</h2><p>${overLine(round)}</p><p class="muted">Calcul des résultats…</p></section>`)) game = null;
    return;
  }
  if (round.stage) return stagedScreen(st, round, ph);
  phoneControl(round);
  const mount = individual[round.game];
  const key = `play/${round.id}/${round.game === 'memory' ? ph : 'play'}`;
  if (show(key, `<div class="phone-play game-${round.game}" id="play"></div>`)) game = mount($('play'), round);
  game?.tick?.();
}

// ---------- Jeux individuels ----------
const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const elapsedOf = round => now() - round.startAt;
const scoreline = (label = 'points') => `<div class="scoreline"><b id="sc">${ctl.score}</b><span>${label}</span></div>`;
const banner = text => `<div class="banner">${text}</div>`;

const individual = {
  barrels(root, round) {
    const lights = round.rule === 'lights', turbo = round.rule === 'turbo';
    root.innerHTML = `${timer('t')}${scoreline("tapes")}
      ${lights || turbo ? '<div class="signal" id="signal"></div>' : ''}
      ${tapZone('TAPE ICI', false)}`;
    let last = 0;
    $('tap').addEventListener('pointerdown', e => {
      e.preventDefault();
      const t = now();
      if (t >= round.endAt || t < round.startAt || e.timeStamp - last < 45) return;
      last = e.timeStamp;
      const red = lights && isRed(round.id, t - round.startAt);
      const pts = red ? -1 : turbo && round.endAt - t <= 3000 ? 2 : 1;
      commit(ctl.raw + 1, ctl.score + pts);
      const b = $('tap');
      b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
      if (red) { flash(root, 'bad'); floatText(b, '−1', 'bad'); vibrate(80); }
      else if (pts === 2) floatText(b, '+2', 'great');
    });
    return { tick() {
      setTimer('t', round.startAt, round.endAt);
      const sig = $('signal'), label = $('tap-label');
      if (lights && sig) { const red = isRed(round.id, elapsedOf(round)); sig.className = `signal ${red ? 'red' : 'green'}`; sig.textContent = red ? '🔴 ROUGE · stop !' : '🟢 VERT · tape !'; root.classList.toggle('is-red', red); if (label) { const text = red ? 'STOP' : 'TAPE ICI'; if (label.textContent !== text) label.textContent = text; label.classList.toggle('stop', red); } }
      if (turbo && sig) { const on = round.endAt - now() <= 3000; sig.className = `signal ${on ? 'turbo on' : 'turbo'}`; sig.textContent = on ? '🔥 TURBO · chaque tape = 2 points' : 'Turbo dans les 3 dernières secondes'; }
    } };
  },

  odd(root, round) {
    const rule = round.rule;
    ctl.streak ||= 0;
    root.innerHTML = `${timer('t')}${scoreline('intrus')}<p class="hint" id="hint">${rule === 'shuffle' ? 'Touche la case différente : elle change de place toutes les 2 s' : 'Touche la case différente'}</p><div class="odd-grid" id="grid"></div>`;
    let lockUntil = 0, puzzle = null, moveAt = 0;
    const paint = () => {
      const { cells, target, hue, delta } = puzzle;
      $('grid').style.setProperty('--n', Math.sqrt(cells));
      $('grid').innerHTML = Array.from({ length: cells }, (_, i) => `<button type="button" data-i="${i}" style="background:hsl(${hue} 60% ${i === target ? 46 + delta : 46}%)" aria-label="Case ${i + 1}"></button>`).join('');
    };
    const draw = () => {
      const level = ctl.raw;
      const cells = rule === 'grid44' ? 16 : level < 5 ? 9 : level < 15 ? 16 : 25;
      // Intrus ressemblant : écart de luminosité plus faible, mais jamais sous 5 % pour rester visible.
      const delta = rule === 'lookalike' ? Math.max(5, 11 - level * 0.3) : Math.max(7, 22 - level * 0.8);
      // Nouvelle position (jamais la case précédente) et nouvelle famille de couleur (au moins 60° d'écart de teinte).
      let target = Math.floor(Math.random() * cells), hue = Math.floor(Math.random() * 360);
      if (puzzle && cells > 1) while (target === puzzle.target) target = Math.floor(Math.random() * cells);
      if (puzzle) { const d = h => Math.min(Math.abs(h - puzzle.hue), 360 - Math.abs(h - puzzle.hue)); while (d(hue) < 60) hue = Math.floor(Math.random() * 360); }
      puzzle = { cells, target, hue, delta };
      moveAt = now() + 2000;
      paint();
    };
    draw();
    $('grid').addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      e.preventDefault();
      const t = now();
      if (t >= round.endAt || t < lockUntil) return;
      if (Number(b.dataset.i) === puzzle.target) {
        commit(ctl.raw + 1, ctl.score + 1);   // 1 intrus trouvé = 1 point, sans bonus de série
        floatText(b, '+1', 'good');
        draw();
      } else {
        ctl.streak = 0;
        persist();
        lockUntil = t + 500;
        $('grid').querySelector(`[data-i="${puzzle.target}"]`)?.classList.add('reveal');
        $('grid').classList.add('locked');
        $('hint').textContent = 'Raté ! La bonne case est entourée';
        flash(root, 'bad'); vibrate(60);
        setTimeout(() => { $('grid')?.classList.remove('locked'); if ($('grid')) { $('hint').textContent = 'Touche la case différente'; draw(); } }, 500);
      }
    });
    return { tick() {
      setTimer('t', round.startAt, round.endAt);
      // Grille qui se mélange : l'intrus change de case toutes les 2 s.
      if (rule === 'shuffle' && now() >= moveAt && now() >= lockUntil && now() < round.endAt) { puzzle.target = Math.floor(Math.random() * puzzle.cells); moveAt = now() + 2000; paint(); }
    } };
  },

  reaction(root, round) {
    const plan = reactionPlan(round.id, round.rule);
    ctl.tries ||= [null, null, null];   // ms, 'early', 'slow'
    root.innerHTML = `<div class="tries" id="tries"></div><button class="reaction-pad" id="pad"><span id="pad-text"></span></button>`;
    let greenAt = null, state = '';
    const drawTries = () => {
      const valid = ctl.tries.filter(Number.isFinite), best = valid.length ? Math.min(...valid) : null;
      $('tries').innerHTML = ctl.tries.map((v, i) => `<div class="try ${Number.isFinite(v) && v === best ? 'best' : ''}"><small>Essai ${i + 1}</small><b>${Number.isFinite(v) ? v + ' ms' : v === 'early' ? 'Trop tôt' : v === 'slow' ? 'Raté' : '…'}</b></div>`).join('');
    };
    const conclude = () => {
      const valid = ctl.tries.filter(Number.isFinite), best = valid.length ? Math.min(...valid) : null;
      commit(best || 0, best ? 10000 - best : 0, best ?? undefined);
      drawTries();
    };
    drawTries();
    $('pad').addEventListener('pointerdown', e => {
      e.preventDefault();
      const el = now() - round.startAt, i = Math.floor(el / REACTION_TRY);
      if (i > 2 || ctl.tries[i] !== null) return;
      if (state === 'green' && greenAt !== null) {
        ctl.tries[i] = Math.max(1, Math.round(e.timeStamp - greenAt));
        vibrate(30);
      } else if (state === 'wait' || state === 'fake') {
        ctl.tries[i] = 'early';
        vibrate([80, 40, 80]);
      } else return;
      conclude();
    });
    let raf;
    const frame = ts => {
      if (!root.isConnected) return;
      const el = now() - round.startAt, i = Math.floor(el / REACTION_TRY);
      let next = 'done';
      if (i <= 2) {
        const p = plan[i], t = el;
        if (ctl.tries[i] !== null) next = 'result';
        else if (t >= p.go + 2500) { ctl.tries[i] = 'slow'; conclude(); next = 'result'; }
        else if (t >= p.go) next = 'green';
        else if (p.fake !== null && t >= p.fake) next = 'fake';
        else next = 'wait';
      }
      if (next !== state) {
        state = next;
        greenAt = next === 'green' ? ts : null;
        const v = ctl.tries[Math.min(2, i)];
        $('pad').className = `reaction-pad ${state}`;
        // Un seul message d'attente : « Attends le vert ». Le résultat s'affiche seul, sans consigne en plus.
        $('pad-text').innerHTML = state === 'wait' ? '<b>Attends le vert</b>'
          : state === 'fake' ? '<b>Attends le vert</b>'
          : state === 'green' ? '<b>APPUIE !</b>'
          : state === 'result' ? (Number.isFinite(v) ? `<b>${v} ms</b>` : v === 'early' ? '<b>Trop tôt !</b>' : '<b>Trop lent</b>')
          : '<b>Terminé !</b>';
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return {};
  },

  memory(root, round) {
    const m = memoryStageAt(now() - round.startAt);
    if (!m) return {};
    const seq = memorySequence(round.id, m), expected = round.rule === 'reverse' ? [...seq].reverse() : seq;
    ctl.memo ||= {};
    const at = s => round.startAt + s * 1000;
    if (m.phase === 'show') {
      root.innerHTML = `<p class="step">Suite ${m.index + 1} / 6</p><h2 class="center">Mémorise ces ${m.len} fruits</h2>
        <div class="fruits">${seq.map((f, i) => `<span style="--i:${i}">${f}</span>`).join('')}</div>${timer('t')}
        ${round.rule === 'reverse' ? '<p class="banner">↩️ Tu devras les redonner à l’envers</p>' : ''}`;
      return { tick() { setTimer('t', at(m.start), at(m.answerAt)); } };
    }
    if (m.phase === 'wait') {
      const last = ctl.memo[m.index - 1];
      root.innerHTML = `<section class="card center-msg">${last ? `<p class="big-emoji">${last.ok === last.len ? '🌟' : '👍'}</p><h2>${last.ok} / ${last.len} fruits</h2>` : ''}<p>Suite suivante : ${m.len} fruits</p><p class="muted">Prépare-toi…</p></section>`;
      return {};
    }
    const entry = ctl.memo[m.index] ||= { input: [], done: false, ok: 0, len: m.len };
    root.innerHTML = `<p class="step">Suite ${m.index + 1} / 6 · ${round.rule === 'reverse' ? '<b>à l’envers</b>' : 'dans l’ordre'}</p>
      <div class="slots" id="slots"></div>${timer('t')}
      <div class="fruit-pad" id="pad">${(entry.pad ||= shuffle(memoryPalette(round.id, m))).map(f => `<button type="button" data-f="${f}">${f}</button>`).join('')}</div>
      <div class="row-btns"><button class="ghost" id="erase">⌫ Effacer</button><button class="primary" id="ok">Valider ✓</button></div>
      <p class="score-note">Total : <b id="sc">${ctl.score}</b> fruits</p>`;
    const validate = () => {
      if (entry.done) return;
      entry.done = true;
      entry.ok = expected.filter((f, i) => entry.input[i] === f).length;
      entry.time = Math.min(Math.round(now() - at(m.answerAt)), (m.end - m.answerAt) * 1000);
      const all = Object.values(ctl.memo).filter(e => e.done);
      commit(all.reduce((s, e) => s + e.ok, 0), all.reduce((s, e) => s + e.ok, 0), all.reduce((s, e) => s + e.time, 0));
      draw();
      if (entry.ok === m.len) { flash(root, 'good'); vibrate(40); } else flash(root, 'bad');
    };
    const draw = () => {
      $('slots').innerHTML = Array.from({ length: m.len }, (_, i) => {
        const v = entry.input[i], cls = entry.done ? (v === expected[i] ? 'good' : 'bad') : v ? 'filled' : '';
        return `<span class="slot ${cls}">${v || ''}${entry.done && v !== expected[i] ? `<small>${expected[i]}</small>` : ''}</span>`;
      }).join('');
      root.querySelectorAll('#pad button').forEach(b => b.disabled = entry.done || entry.input.length >= m.len);
      $('erase').disabled = entry.done || !entry.input.length;
      $('ok').disabled = entry.done || !entry.input.length;
      $('ok').textContent = entry.done ? `${entry.ok} / ${m.len} ✓` : 'Valider ✓';
    };
    draw();
    $('pad').onclick = e => { const b = e.target.closest('[data-f]'); if (!b || entry.done || entry.input.length >= m.len) return; entry.input.push(b.dataset.f); persist(); draw(); };
    $('erase').onclick = () => { if (!entry.done) { entry.input.pop(); persist(); draw(); } };
    $('ok').onclick = validate;
    return { tick() {
      setTimer('t', at(m.answerAt), at(m.end));
      if (!entry.done && now() >= at(m.end) - 150) validate();
    } };
  },

  maths: (root, round) => { let chain = null; return quiz(root, round, () => { const q = mathsQuestion(round.rule, chain); chain = q.answer; return q; }); },
  words: (root, round) => quiz(root, round, () => wordQuestion(round)),
  cups: (root, round) => cupsGame(root, round),
};

// Calcul express et Mot mélangé : 4 propositions, pas de chrono affiché, une erreur bloque 0,5 s.
function quiz(root, round, make) {
  ctl.streak ||= 0;
  const streakRule = round.rule === 'streak';
  root.innerHTML = `${timer('t')}${scoreline('bonnes réponses')}<div class="question" id="q"></div><div class="answers" id="answers"></div><p class="hint" id="hint">${streakRule ? '5 bonnes réponses d’affilée = +1 point' : 'Une erreur bloque 0,6 s'}</p>`;
  let q, lock = 0;
  const next = () => {
    q = make();
    $('q').innerHTML = q.html;
    $('answers').innerHTML = q.options.map(o => `<button type="button" data-a="${esc(o)}">${esc(o)}</button>`).join('');
  };
  next();
  $('answers').addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    const t = now();
    if (!b || t < lock || t >= round.endAt) return;
    if (b.dataset.a === String(q.answer)) {
      ctl.streak++;
      const bonus = streakRule && ctl.streak % 5 === 0 ? 1 : 0;
      commit(ctl.raw + 1, ctl.score + 1 + bonus);
      floatText(b, bonus ? '+2 série !' : '+1', bonus ? 'great' : 'good');
      next();
    } else {
      ctl.streak = 0; persist();
      lock = t + 600;
      b.classList.add('wrong');
      $('answers').querySelector(`[data-a="${CSS.escape(String(q.answer))}"]`)?.classList.add('right');
      $('answers').classList.add('locked');
      flash(root, 'bad'); vibrate(60);
      setTimeout(() => { if ($('answers')) { $('answers').classList.remove('locked'); next(); } }, 600);
    }
  });
  return { tick() { setTimer('t', round.startAt, round.endAt); } };
}

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function mathsQuestion(rule, chain) {
  let a, b, op, answer;
  const linked = rule === 'chain' && chain != null && chain <= 150;
  const kind = rule === 'multiply' ? 'x' : linked ? (chain > 20 && Math.random() < .5 ? '-' : '+') : ['+', '+', '-', 'x'][rnd(0, 3)];
  if (kind === '+') { a = linked ? chain : rnd(4, 49); b = rnd(3, linked ? 19 : 39); answer = a + b; op = '+'; }
  else if (kind === '-') { a = linked ? chain : rnd(15, 80); b = rnd(3, linked ? Math.min(19, a - 5) : a - 5); answer = a - b; op = '−'; }
  else { a = rnd(2, rule === 'multiply' ? 10 : 9); b = rnd(2, 10); answer = a * b; op = '×'; }
  // Mauvaises réponses proches sans piège excessif : ±1, ±2, ±10 (ou une table d'écart pour ×).
  const near = shuffle(op === '×' ? [a, -a, b, -b, 1, -1] : [1, -1, 2, -2, 10, -10]).map(d => answer + d).filter(v => v > 0 && v !== answer);
  const options = shuffle([answer, ...[...new Set(near)].slice(0, 3)]);
  return { html: `<span class="calc">${a} ${op} ${b}</span>${linked ? '<small class="chain-note">résultat précédent ' + op + ' ' + b + '</small>' : ''}`, answer, options };
}

// Mot mélangé : niveau choisi par l'animateur ; propositions proches (longueur à 1 lettre près, de préférence même initiale).
function wordQuestion(round) {
  const base = round.level === 'hard' ? hardWords : easyWords;
  const pool = round.rule === 'long' ? [...easyWords, ...hardWords].filter(w => w.length >= 8) : base;
  // Pioche sans remise sur toute la soirée : les mots déjà vus par ce joueur ne reviennent pas d'une manche à l'autre.
  const memKey = `seen-words-${S.session?.room || ''}-${S.session?.pid || ''}`;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(memKey) || '[]'); } catch { /* stockage indisponible */ }
  let fresh = pool.filter(w => !seen.includes(w));
  if (!fresh.length) { seen = seen.filter(w => !pool.includes(w)); fresh = pool; }   // banque épuisée : on remélange
  const word = fresh[Math.floor(Math.random() * fresh.length)];
  seen.push(word);
  try { localStorage.setItem(memKey, JSON.stringify(seen.slice(-1500))); } catch { /* */ }
  const plain = w => w.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const candidates = pool.filter(w => w !== word && Math.abs(w.length - word.length) <= 1);
  const others = shuffle(candidates).sort((x, y) => (plain(y)[0] === plain(word)[0]) - (plain(x)[0] === plain(word)[0])).slice(0, 3);
  let shown;
  if (round.rule === 'holes') {
    const idx = shuffle([...Array(word.length).keys()].slice(1)).slice(0, Math.max(2, Math.round(word.length * .4)));
    shown = [...word].map((l, i) => idx.includes(i) ? '_' : l);
  } else {
    let letters; do { letters = shuffle([...word]); } while (letters.join('') === word);
    shown = letters;
  }
  return { html: `<div class="tiles">${shown.map(l => `<span class="${l === '_' ? 'hole' : ''}">${esc(l === '_' ? '' : l.toUpperCase())}</span>`).join('')}</div>`, answer: word, options: shuffle([word, ...others]) };
}

// ---------- Le bonneteau (jeu individuel, mélanges identiques pour tous) ----------
// Repris du code de référence fourni : mêmes phases (raisin montré, mélange, feintes, choix, révélation).
// La position des gobelets est calculée à partir de l'heure du serveur : pas d'animation lancée localement.
// ---------- Bonneteau classique (joué sur le téléphone) ----------
function cupsGame(root, round) {
  const plan = cupsPlan(round.id, round.rule);
  ctl.res ||= {};
  root.innerHTML = `${timer('t')}<div class="cup-head"><div class="cup-dots" id="dots"></div><p class="cup-info" id="info"></p></div>
    <div class="cup-stage" id="stage"></div><p class="cup-msg" id="cmsg"></p>${scoreline('points')}`;
  let view = null, raf;
  const build = ser => {
    $('stage').style.setProperty('--g', ser.g);
    $('stage').innerHTML = '<div class="cup-ball"></div>' + Array.from({ length: ser.g }, (_, c) => `<button type="button" class="cup" data-c="${c}" aria-label="Gobelet ${c + 1}"></button>`).join('');
    view = { L: ser.L, cups: [...$('stage').querySelectorAll('.cup')], ball: $('stage').querySelector('.cup-ball') };
  };
  const settle = (ser, el) => {
    const r = ctl.res[ser.L] || {};
    if (r.done || ctl.dead || (r.cup == null && el < ser.tReveal)) return;
    const ok = r.cup === ser.ball;
    ctl.res[ser.L] = { ...r, ok, done: true };
    if (ok) commit(ctl.raw + 1, ctl.score + 10 * ser.L, (ctl.tb || 0) + r.ms);
    else { if (round.rule === 'sudden') ctl.dead = ser.L; persist(); }
    if (ok) vibrate(30); else vibrate([60, 40, 60]);
  };
  $('stage').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    e.preventDefault();
    const el = now() - round.startAt, ser = plan.find(x => el < x.t1);
    if (!ser || ctl.dead || el < ser.tChoice || el >= ser.tReveal || ctl.res[ser.L]?.cup != null) return;
    ctl.res[ser.L] = { cup: Number(b.dataset.c), ms: Math.round(el - ser.tChoice) };
    persist(); vibrate(10);
  });
  const frame = () => {
    if (!root.isConnected) return;
    const el = now() - round.startAt, last = plan.at(-1);
    const ser = plan.find(x => el < x.t1) || last;
    for (const s2 of plan) { if (s2.L > ser.L || (s2.L === ser.L && el < s2.tReveal)) break; settle(s2, el); }
    if (!view || view.L !== ser.L) build(ser);
    const t = Math.min(el, ser.t1 - 1), pose = cupsPose(ser, t), mine = ctl.res[ser.L];
    const H = $('stage').clientHeight * .55;
    view.cups.forEach((c, i) => {
      let y = pose.y[i];
      if (mine?.cup === i && mine.cup !== ser.ball && t >= ser.tReveal) y = -Math.min(1, (t - ser.tReveal) / CUPS.lift);   // mon mauvais choix se soulève aussi
      c.style.left = ((pose.x[i] + .5) / ser.g * 100) + '%';
      c.style.transform = `translate(-50%, ${Math.round(y * H)}px)`;
      c.classList.toggle('picked', mine?.cup === i && t < ser.tReveal);
    });
    view.ball.style.left = pose.ball == null ? '-100px' : ((pose.ball + .5) / ser.g * 100) + '%';
    view.ball.style.opacity = pose.ball == null ? 0 : 1;
    $('dots').innerHTML = plan.map(x => { const r = ctl.res[x.L]; return `<i class="${r?.done ? (r.ok ? 'ok' : 'ko') : x.L === ser.L ? 'cur' : ''}"></i>`; }).join('');
    $('info').textContent = `Série ${ser.L} / 10 · ${ser.g} gobelets · ${ser.s} échanges${ser.f ? ` · ${ser.f} feinte${ser.f > 1 ? 's' : ''}` : ''}`;
    let m;
    if (ctl.dead) m = `☠️ Mort subite à la série ${ctl.dead} : tu gardes tes points.`;
    else if (el >= last.t1) m = `Terminé : ${ctl.raw} / 10 séries réussies`;
    else if (el < ser.tShow) m = ser.L === 10 ? '🔥 Dernière série : 100 pts en jeu !' : `Série ${ser.L}`;
    else if (el < ser.tMoves) m = 'Le raisin est ici…';
    else if (el < ser.tChoice) m = 'Suis-le !';
    else if (el < ser.tReveal) m = mine?.cup != null ? 'Choix enregistré…' : `Où est le raisin ? (${Math.ceil((ser.tReveal - el) / 1000)} s)`;
    else m = mine?.ok ? `Bravo ! +${10 * ser.L} points` : mine?.cup == null ? 'Trop tard !' : 'Raté…';
    if ($('cmsg').textContent !== m) $('cmsg').textContent = m;
    setTimer('t', round.startAt, round.endAt);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {};
}

// ---------- Jeux pilotés (Vrai ou faux, Le bon tonneau, Bataille royale) ----------
function myPick(round) {
  const s = round.stage;
  if (pickQueue?.round === round.id && pickQueue.step === s.step) return pickQueue.value;
  const local = storage.load(`beaujolais.pick.v3.${S.session.room}`);
  if (local?.round === round.id && local.step === s.step) return local.value;
  const remote = S.state.mine?.pick;
  return remote?.round === round.id && remote.step === s.step ? remote.value : undefined;
}
function sendPick(round, value) {
  const step = round.stage.step;
  pickQueue = { round: round.id, step, value };
  storage.save(`beaujolais.pick.v3.${S.session.room}`, pickQueue);
  flushPick();
}
async function flushPick() {
  if (!pickQueue || pickSending) return;
  const job = pickQueue;
  pickSending = true;
  try {
    await api('pick', job);
    if (pickQueue === job) { pickQueue = null; if ($('saved')) $('saved').textContent = '✓ Choix enregistré'; }
  } catch (e) {
    if (e.status === 409 || e.status === 400) { if (pickQueue === job) pickQueue = null; status(e.message, 'error'); }
    else status('Envoi en cours… nouvel essai automatique', 'warn');
  } finally { pickSending = false; }
}

function stagedScreen(st, round, ph) {
  const s = round.stage, key = `stage/${round.id}/${ph}`;
  const fresh = show(key, `<div class="phone-play staged game-${round.game}" id="play"></div>`);
  if (fresh) game = staged[round.game]($('play'), st, round);
  game?.tick?.();
}

const staged = {
  // Bonneteau survie : même mélange que le grand écran, choix sans chrono, révélation dès que tous les survivants ont choisi.
  cups(root, st, round) {
    const s = round.stage, me = S.session.pid, pick = myPick(round), lv = s.level;
    const out = s.eliminated?.[me], aliveNow = s.alive.includes(me), plan = cupsTurn(round.id, s.turn - 1);
    const outLine = '<p class="out-note">Tu es éliminé du classement. Tu peux continuer à jouer pour le plaisir ou suivre la partie sur le grand écran.</p>';
    let msg = '';
    if (s.phase === 'show') msg = 'Suis le raisin !';
    else if (s.phase === 'choose') msg = pick !== undefined ? '✓ Choix validé · en attente des autres' : 'Où est le raisin ? Touche un gobelet';
    else {
      const ok = pick === s.ball;
      if (s.lost?.includes(me)) msg = pick === undefined ? '⏱️ Pas de choix : éliminé' : '❌ Raté : tu es éliminé';
      else if (aliveNow) msg = `✅ Bien vu ! +1 · ${s.alive.length === 1 ? 'tu es le dernier en lice !' : `encore ${s.alive.length} en lice`}`;
      else msg = pick === undefined ? 'Le raisin était là' : ok ? '🍇 Bien vu (pour le plaisir)' : 'Raté (pour le plaisir)';
    }
    root.innerHTML = `<p class="cup-info">Tour ${s.turn} · ${lv.g} gobelets · ${lv.s} échanges${lv.f ? ` · ${plural(lv.f, 'feinte')}` : ''}</p>
      <div class="cup-stage" id="stage" style="--g:${lv.g}"><div class="cup-ball"></div>${Array.from({ length: lv.g }, (_, c) => `<button type="button" class="cup" data-c="${c}" aria-label="Gobelet ${c + 1}" ${s.phase === 'choose' ? '' : 'disabled'}></button>`).join('')}</div>
      <p class="cup-msg ${s.phase === 'reveal' ? (s.lost?.includes(me) ? 'bad' : aliveNow ? 'good' : '') : ''}" id="cmsg">${msg}</p>
      ${out && !s.lost?.includes(me) ? outLine : s.phase === 'reveal' && s.lost?.includes(me) ? outLine : ''}
      <p class="score-note">Ton score : <b>${s.scores?.[me] || 0}</b> tour${(s.scores?.[me] || 0) > 1 ? 's' : ''} réussi${(s.scores?.[me] || 0) > 1 ? 's' : ''}</p>
      ${s.phase === 'reveal' ? top3HTML(st, s.scores) : ''}`;
    const cupsEl = [...root.querySelectorAll('.cup')], ballEl = root.querySelector('.cup-ball');
    root.querySelector('#stage').addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-c]');
      if (!b || round.stage.phase !== 'choose') return;
      e.preventDefault();
      const i = Number(b.dataset.c);
      cupsEl.forEach(c => c.classList.toggle('picked', c === b));
      $('cmsg').textContent = '✓ Choix validé · en attente des autres';
      vibrate(15);
      sendPick(round, i);
    });
    const frame = () => {
      if (!root.isConnected) return;
      const t = now() - (s.from || round.startAt);
      const el = s.phase === 'show' ? Math.min(t, plan.tRot) : s.phase === 'choose' ? plan.tRot : plan.tRot + t;
      const pose = cupsPose(s.phase === 'reveal' ? { ...plan, tReveal: plan.tRot } : plan, el), H = $('stage')?.clientHeight * .55 || 0;
      const chosen = myPick(round);
      cupsEl.forEach((c, i) => {
        // positions : en phase de choix, l'emplacement i correspond au gobelet posé à cet endroit
        const cup = s.phase === 'show' ? i : i;
        c.style.left = ((pose.x[cup] + .5) / plan.g * 100) + '%';
        c.style.transform = `translate(-50%, ${Math.round(pose.y[cup] * H)}px)`;
        if (s.phase !== 'show') c.classList.toggle('picked', chosen === plan.final[cup]);
      });
      ballEl.style.left = pose.ball == null ? '-100px' : ((pose.ball + .5) / plan.g * 100) + '%';
      ballEl.style.opacity = pose.ball == null ? 0 : 1;
      requestAnimationFrame(frame);
    };
    // En phase de choix, chaque bouton vise un EMPLACEMENT : on renvoie l'emplacement final du gobelet touché.
    cupsEl.forEach((c, i) => { c.dataset.c = String(plan.final[i]); });
    if (s.phase === 'reveal' && s.lost?.includes(me)) vibrate([60, 40, 60]);
    requestAnimationFrame(frame);
    return {};
  },

  truefalse(root, st, round) {
    const s = round.stage, pick = myPick(round), myTally = round.tally?.[S.session.pid] || 0;
    let body = '';
    if (s.phase === 'choose') {
      body = `${timer('t')}<div class="quiz-choices">${s.options.map((o, i) => `<button type="button" class="quiz-opt" data-v="${i}" aria-pressed="${pick === i}">${esc(o)}</button>`).join('')}</div><p class="saved" id="saved">${pick !== undefined ? '✓ Choix enregistré · tu peux changer d’avis' : 'Tu peux changer d’avis jusqu’à la fin'}</p>`;
    } else if (s.phase === 'stats') {
      body = `<div class="card center-msg"><p>Ta réponse : <b>${pick === undefined ? 'aucune' : esc(s.options[pick])}</b></p><p class="muted">Suspense…</p></div>`;
    } else {
      const ok = pick === s.answer;
      // Révélation : les quatre réponses restent visibles, les mauvaises grisées, la bonne mise en avant, ton choix marqué.
      body = `<p class="quiz-verdict ${pick === undefined ? '' : ok ? 'good' : 'bad'}">${pick === undefined ? '⏱️ Pas de réponse' : ok ? (s.fastest === S.session.pid ? '⚡ Bonne réponse, la plus rapide ! +2' : '✅ Bonne réponse ! +1') : '❌ Raté'}</p>
        <div class="quiz-choices reveal">${s.options.map((o, i) => `<div class="quiz-opt ${i === s.answer ? 'right' : 'wrong'} ${i === pick ? 'mine' : ''}">${i === s.answer ? '✓ ' : ''}${esc(o)}${i === pick ? '<small>ton choix</small>' : ''}</div>`).join('')}</div>
        ${s.why ? `<p class="quiz-why">${esc(s.why)}</p>` : ''}${top3HTML(S.state, s.scores)}<p class="score-note">Ton score : <b>${myTally}</b> pt${myTally > 1 ? "s" : ""} après ${s.step + 1} question${s.step ? "s" : ""}</p>`;
      if (pick !== undefined) vibrate(ok ? 40 : [60, 30, 60]);
    }
    const out = s.out?.[S.session.pid];
    if (out && s.phase === 'choose') body = `<div class="card center-msg"><div class="big-emoji">☠️</div><h2>Mort subite</h2><p>Erreur à la question ${out} : tu gardes tes ${myTally} point${myTally > 1 ? 's' : ''}.</p></div>`;
    root.innerHTML = `<p class="step">Question ${s.step + 1} / ${s.total}${s.theme ? ` · ${esc(themes[s.theme] || '')}` : ''}</p><p class="tf-question">${esc(s.text)}</p>${body}`;
    root.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
      if (now() > s.until || s.out?.[S.session.pid]) return;
      root.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', x === b));
      $('saved').textContent = 'Enregistrement…';
      sendPick(round, Number(b.dataset.v));
    });
    return { tick() { setTimer('t', s.until - s.len, s.until); } };
  },

  // Le Bon Tonneau : choisir un tonneau (survivants), ou réserver des cases piégées (poseurs, en direct avec l'équipe).
  lucky(root, st, round) {
    const me = S.session.pid, name = pid => esc(st.players.find(p => p.pid === pid)?.name || '?');
    const draw = () => {
      const s = S.state?.round?.stage;
      if (!s || !root.isConnected) return;
      const poser = s.posers.includes(me), alive = s.alive.includes(me), pick = myPick(S.state.round);
      const team = s.team ? (S.state.round.teams || []).find(t => t.id === s.team) : null;
      const poserLabel = team ? `${teamSymbol(team.name)} ${esc(team.name)}` : name(s.posers[0]);
      let body = '';
      if (s.phase === 'announce') {
        body = poser ? `<div class="card lk-me poser"><h2>🎯 À toi de poser !</h2><p>${team ? `Ton équipe pose ${s.trapCount} pièges : <b>${s.quota[me]}</b> pour toi.` : `Tu poses <b>${s.trapCount} pièges</b>.`}</p><p class="muted">Tu es protégé ce tour-ci.</p></div>`
          : `<div class="card lk-me"><h2>Tour ${s.turn}</h2><p>${poserLabel} pose <b>${s.trapCount} pièges</b>.</p><p class="muted">${alive ? 'Prépare-toi à choisir un tonneau.' : 'Tu es éliminé : suis la partie sur le grand écran.'}</p></div>`;
      } else if (s.phase === 'choose') {
        const traps = s.traps || {}, mine = Object.values(traps).filter(x => x === me).length;
        if (poser) {
          body = `${timer('t')}<p class="lk-hint">Touche ${s.quota[me]} case${s.quota[me] > 1 ? 's' : ''} à piéger · <b>${mine} / ${s.quota[me]}</b></p>
            <div class="lk-grid phone">${Array.from({ length: 16 }, (_, c) => { const o = traps[c]; return `<button type="button" class="tonneau ${o === me ? 'mine' : o ? 'mate' : ''}" data-trap="${c}" ${o && o !== me ? 'disabled' : ''}><span class="t-num">${c + 1}</span>${o ? `<small>${o === me ? '💣 toi' : `💣 ${name(o)}`}</small>` : ''}</button>`; }).join('')}</div>`;
        } else if (alive) {
          body = `${timer('t')}<p class="lk-hint">${pick !== undefined ? `✓ Choix validé : tonneau ${pick + 1}` : 'Choisis ton tonneau'}</p>
            <div class="lk-grid phone">${Array.from({ length: 16 }, (_, c) => `<button type="button" class="tonneau ${pick === c ? 'picked' : ''}" data-barrel="${c}"><span class="t-num">${c + 1}</span></button>`).join('')}</div>
            <p class="muted center">${poserLabel} pose ${s.trapCount} pièges en secret</p>`;
        } else body = `<div class="card lk-me"><h2>Tu es éliminé</h2><p>Tu poseras peut-être des pièges au prochain tour. Suis la partie sur le grand écran.</p></div>`;
      } else {
        const r = s.reveal, lost = r?.lost.includes(me);
        body = poser ? `<div class="card lk-me poser"><h2>🎯 Tes pièges</h2><p>${r?.byPoser?.[me]?.hit.length ? `Tu as piégé <b>${r.byPoser[me].hit.map(name).join(', ')}</b> !` : 'Personne n’est tombé dans tes pièges.'}</p></div>`
          : lost ? `<div class="card lk-me bad"><div class="big-emoji">💥</div><h2>Tonneau piégé !</h2><p>Tu es éliminé au tour ${s.turn}. Tu pourras poser des pièges.</p></div>`
          : alive ? `<div class="card lk-me good"><div class="big-emoji">🍀</div><h2>Tu survis !</h2><p>Encore ${s.alive.length} en lice.</p></div>`
          : `<div class="card lk-me"><h2>Révélation sur le grand écran</h2><p>Encore ${s.alive.length} en lice.</p></div>`;
        body += top3HTML(S.state, s.scores);
      }
      const key = JSON.stringify([s.step, s.phase, s.traps, pick]);
      if (root.dataset.key === key) return;
      root.dataset.key = key;
      root.innerHTML = `<p class="lk-turn">Tour ${s.turn} · ${s.trapCount} pièges</p>${body}`;
      root.querySelectorAll('[data-barrel]').forEach(b => b.onclick = () => { if (S.state.round.stage.phase !== 'choose') return; vibrate(15); sendPick(S.state.round, Number(b.dataset.barrel)); draw(); });
      root.querySelectorAll('[data-trap]').forEach(b => b.onclick = async () => {
        vibrate(15);
        try { const data = await api('trap', { cell: Number(b.dataset.trap) }); S.state = { ...S.state, ...data }; draw(); }
        catch (e) { status(e.message, 'warn'); }
      });
      if (s.phase === 'reveal' && s.reveal?.lost.includes(me)) vibrate([80, 40, 80]);
    };
    draw();
    const loop = () => { if (!root.isConnected) return; const s = S.state?.round?.stage; if (s?.phase === 'choose' && $('t')) setTimer('t', s.from, s.until); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    return { tick: draw };
  },
  arena(root, st, round) {
    const s = round.stage, mePid = S.session.pid;
    const alive = s.survivors.includes(mePid);
    if (s.phase === 'reveal') {
      const hit = s.reveal.lost.includes(mePid), saved = s.reveal.blocked.includes(mePid);
      root.innerHTML = `<p class="step">Tour ${s.turn} · ${plural(s.survivors.length, 'survivant')}</p>
        <div class="arena-wrap">${arenaSVG(s, st.players, { me: mePid, labels: true })}</div>
        <p class="verdict-line ${hit ? 'bad' : alive ? 'good' : ''}">${hit ? '💥 Touché ! Tu es éliminé' : saved ? '🛡️ Ton bouclier t’a sauvé !' : alive ? '😎 Tu restes en jeu' : 'Tu regardes la suite'}</p>
        ${arenaSummary(s, st.players)}`;
      if (hit) setTimeout(() => vibrate([100, 50, 200]), 4400);
      return {};
    }
    if (!alive) {
      root.innerHTML = `<p class="step">Tour ${s.turn}</p><section class="card center-msg"><div class="big-emoji">👀</div><h2>Tu es éliminé</h2><p>Regarde le projecteur : ${plural(s.survivors.length, 'survivant')} encore en jeu.</p><p class="muted">Ton classement dépend du tour où tu es tombé.</p></section>`;
      return {};
    }
    let mine = { ...(myPick(round) || {}) };
    let mode = mine.pos ? 'aim' : 'place';
    root.innerHTML = `<p class="step">Tour ${s.turn} · ${plural(s.survivors.length, 'survivant')}${s.shields?.includes(mePid) ? ' · 🛡️ bouclier' : ''}</p>
      ${timer('t')}
      <p class="instruction" id="instr"></p>
      <div class="arena-wrap" id="board"></div>
      <div class="row-btns"><button class="ghost" id="mode-place">📍 Me placer</button><button class="ghost" id="mode-aim">🎯 Viser</button></div>
      <p class="saved" id="saved"></p>`;
    const draw = () => {
      $('board').innerHTML = arenaSVG(s, st.players, { me: mePid, mine });
      $('instr').innerHTML = mode === 'place' ? '<b>1.</b> Touche le terrain pour <b>te placer</b>' : '<b>2.</b> Touche pour <b>viser</b> : ton tir part dans cette direction';
      $('mode-place').setAttribute('aria-pressed', mode === 'place');
      $('mode-aim').setAttribute('aria-pressed', mode === 'aim');
      $('mode-aim').disabled = !mine.pos;
      $('saved').textContent = mine.pos && Number.isFinite(mine.angle) ? '✓ Placé et visé · tu peux encore changer' : mine.pos ? 'Placé ! Maintenant, vise' : 'Sans choix, le jeu te place au hasard';
    };
    draw();
    $('mode-place').onclick = () => { mode = 'place'; draw(); };
    $('mode-aim').onclick = () => { mode = 'aim'; draw(); };
    $('board').addEventListener('pointerdown', e => {
      if (now() > s.until) return;
      const svg = $('board').querySelector('svg');
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      if (mode === 'place') {
        let [x, y] = [pt.x, pt.y];
        const d = Math.hypot(x, y), max = s.zone * 0.97;
        if (d > max) { x = x / d * max; y = y / d * max; }
        mine.pos = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
        mode = 'aim';
      } else {
        const a = Math.atan2(pt.y - mine.pos[1], pt.x - mine.pos[0]);
        if (Math.hypot(pt.x - mine.pos[0], pt.y - mine.pos[1]) < 0.04) return;
        mine.angle = Math.round(a * 1000) / 1000;
      }
      vibrate(15);
      draw();
      sendPick(round, mine);
    });
    return { tick() { setTimer('t', s.until - s.len, s.until); } };
  },
};

// ---------- Envois réguliers ----------
export function phoneDelay(st) {
  // AUDIT : on interroge juste après chaque échéance connue, et rarement entre deux (annulation, fin anticipée).
  const r = st?.round, t = now();
  if (st?.duel && !st.duel.winner) return st.duel.players.includes(S.session.pid) ? 400 : 1000;
  if (r?.stage && r.game === 'cups' && r.stage.phase === 'choose') return 1000;
  if (r?.stage && r.game === 'lucky' && r.stage.phase === 'choose') return r.stage.posers.includes(S.session.pid) ? 700 : 1200;   // poseurs : réservations des coéquipiers en direct
  if (!st?.joined || !r || r.results) return 4000;
  if (t < r.startAt) return Math.max(300, Math.min(4000, r.startAt - t + 150));
  if (r.stage) return r.stage.until > t ? Math.max(800, Math.min(4000, r.stage.until - t + 400)) : 1200;
  if (t < r.endAt) return Math.max(1000, Math.min(5000, r.endAt + GRACE + 1500 - t));
  return 1500;
}

setInterval(() => {
  if (pickQueue) flushPick();
  const r = S.state?.round;
  if (!ctl || !r || ctl.id !== r.id || ctl.ack >= ctl.seq || sending) return;
  const t = now();
  if (t > r.endAt + GRACE) { ctl.ack = ctl.seq; return; }
  const every = r.game === 'barrels' ? 700 : 3000;   // Course : envoi rapide pour suivre la course en direct sur le grand écran
  if ((ctl.lastSend || 0) + every > t && t < r.endAt) return;   // AUDIT : 1 envoi / 3 s pendant le jeu (le dernier part dès la fin)
  ctl.lastSend = t;
  const job = { round: ctl.id, seq: ctl.seq, raw: ctl.raw, score: ctl.score, tb: ctl.tb, ...(ctl.tries ? { tries: ctl.tries } : {}) };
  sending = true;
  api('score', job).then(reply => { if (ctl?.id === job.round) { ctl.ack = Math.max(ctl.ack, reply.accepted); persist(); } })
    .catch(e => { if (e.status === 409 && ctl?.id === job.round) ctl.ack = job.seq; else status('Envoi du score… nouvel essai automatique', 'warn'); })
    .finally(() => { sending = false; });
}, 300);

// Top 3 de la manche en cours + ta place, pour te situer (Quiz, après chaque question).
function top3HTML(st, scores) {
  if (!scores) return '';
  const rows = st.players.map(p => ({ ...p, v: scores[p.pid] || 0 })).sort((a, b) => b.v - a.v || a.name.localeCompare(b.name, 'fr'));
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].v === r.v ? rows[i - 1].rank : i + 1; });
  const me = rows.find(r => r.pid === S.session.pid);
  return `<ol class="top3">${rows.slice(0, 3).map(r => `<li class="${r.pid === S.session.pid ? 'me' : ''}" style="--c:${esc(r.color)}"><span>${['🥇', '🥈', '🥉'][r.rank - 1] || r.rank}</span><i></i>${esc(r.name)}<b>${r.v}</b></li>`).join('')}</ol>
    ${me && me.rank > 3 ? `<p class="top3-me">Toi : <b>${me.rank}<sup>e</sup></b> sur ${rows.length} · ${me.v} pt${me.v > 1 ? 's' : ''}</p>` : ''}`;
}

// ---------- Top départ : duel final (téléphone) ----------
// Les deux duellistes ont un grand pad : rouge, puis vert au même instant pour les deux. Les autres suivent sur le grand écran.
let duelSent = null;
function duelPhone(st) {
  const d = st.duel, me = S.session.pid, name = pid => esc(st.players.find(p => p.pid === pid)?.name || '?');
  if (!d.players.includes(me)) {
    show(`duel-watch/${d.id}`, `<section class="card center-msg"><div class="big-emoji">⚔️</div><h2>Duel final</h2><p><b>${name(d.players[0])}</b> contre <b>${name(d.players[1])}</b></p><p class="muted">Regarde le grand écran !</p></section>`);
    return;
  }
  const key = `duel/${d.id}/${d.attempt}`;
  if (show(key, `<div class="phone-play"><p class="eyebrow center">⚔️ Duel final${d.attempt > 1 ? ' · on rejoue' : ''}</p>
      <button type="button" class="duel-pad" id="duel-pad"><span id="duel-text">Prépare-toi…</span></button><p class="muted center">Contre ${name(d.players.find(p => p !== me))}</p></div>`)) {
    const pad = $('duel-pad');
    pad.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (duelSent === key || now() < d.startAt) return;
      duelSent = key;
      const value = now() < d.go ? 'early' : Math.max(1, Math.round(now() - d.go));
      $('duel-text').innerHTML = value === 'early' ? '<b>Faux départ !</b>' : `<b>${value} ms</b>`;
      pad.className = `duel-pad ${value === 'early' ? 'early' : 'sent'}`;
      vibrate(value === 'early' ? [80, 40, 80] : 30);
      api('duel', { duel: d.id, value }).catch(err => status(err.message, 'error'));
    });
    const tick = () => {
      if (!pad.isConnected || duelSent === key) return;
      const t = now();
      if (t >= d.go) { pad.className = 'duel-pad green'; $('duel-text').innerHTML = '<b>APPUIE !</b>'; return; }
      if (t >= d.startAt) { pad.className = 'duel-pad red'; $('duel-text').innerHTML = '<b>Attends le vert</b>'; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
