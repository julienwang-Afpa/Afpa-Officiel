// Écran animateur : mode salon (admin) entre les manches, mode spectacle pendant les manches.
import { S, isHost, api, $, esc, show, status, now, storage, resetScreen, plural } from './core.mjs';
import { sounds, isMuted, setMuted } from './sound.mjs';
import { seeded, games, programme, rules, ruleNames, ruleText, ruleExample, standings, memoryStageAt, memorySequence, memoryPlan, reactionPlan, REACTION_TRY, isRed, themes, levels, cupsTurn, cupsPlan, cupsPose, CUPS, BARREL, perfLabel, teamSymbol } from './games.mjs';
import { chip, ruleCard, pointsHelpHTML, timer, setTimer, podium, standingsHTML, animateStandings, confetti, teamLinesHTML, teamResultsHTML, teamPodiumHTML, gameBoardHTML, generalBoardHTML } from './ui.mjs';
import { arenaSVG, arenaSummary, barrelsHTML, luckyTitle, livesHTML } from './boards.mjs';

let ui = storage.load('beaujolais.host.ui.v3') || {};
const saveUi = () => storage.save('beaujolais.host.ui.v3', ui);
let resultSlide = 'podium', resultTimer = null;
const TEAM_SIZES = [2, 3, 4];

export const joinUrl = () => { const u = new URL(location.pathname, location.origin); u.searchParams.set('r', S.session.room); return u.href; };
function qr(el, size = 6) {
  if (!el || !window.qrcode) return;
  const q = qrcode(0, 'M');
  q.addData(joinUrl());
  q.make();
  el.innerHTML = q.createSvgTag({ cellSize: size, margin: 2, scalable: true });
}

async function command(action, args = {}) {
  if (S.busy) return;
  S.busy = true;
  let retry = false;
  try {
    S.state = await api('host', { action, revision: S.state.revision, ...args });
    resetScreen();
    renderHost();
  } catch (e) {
    // Équipes inégales : le serveur demande confirmation avant le lancement.
    if (action === 'start' && e.data?.needsConfirm && confirm(`${e.message}\n\nLe jeu peut quand même démarrer.`)) retry = true;
    else status(e.status === 409 && /changé/.test(e.message) ? 'L’écran se met à jour, refais ton choix.' : e.message, 'error');
  } finally { S.busy = false; }
  if (retry) command('start', { force: true });
}

// ---------- Aiguillage ----------
export function renderHost() {
  const st = S.state;
  if (!st) return;
  if (ui.room !== S.session.room) { ui = { room: S.session.room, done: [], total: 1 }; saveUi(); }
  const round = st.round;
  document.body.classList.toggle('spectacle', Boolean(recapOpen || (round && (!round.results || ui.dismissed !== round.id))));
  if (round?.results && !round.practice && !ui.done.includes(round.game)) { ui.done.push(round.game); saveUi(); }
  if (recapOpen) return recap(st);
  if (round && !round.results) return spectacle(st, round);
  if (round?.results && ui.dismissed !== round.id) return results(st, round);
  admin(st);
}

// ---------- Mode spectacle ----------
function hostPhase(round) {
  const t = now();
  if (t < round.startAt) return 'count';
  if (round.stage) return `s${round.stage.step}-${round.stage.phase}-${round.stage.answered || 0}-${round.stage.trapsTaken ?? ""}`;   // le compteur « X / N ont répondu » redessine l'écran
  if (t >= round.endAt) return 'grace';
  if (round.game === 'memory') { const m = memoryStageAt(t - round.startAt); return m ? `m${m.index}-${m.phase}` : 'grace'; }
  return 'play';
}

function topBar(round) {
  const g = games[round.game];
  return `<header class="stage-top">
    <span class="icon" aria-hidden="true">${g.icon}</span><h1>${esc(g.name)}</h1>
    ${round.rule !== 'classic' ? `<span class="badge gold">${esc(ruleNames(round.rule))}</span>` : ''}
    ${round.theme && !(round.vote?.wheel?.length && now() < round.startAt - ROULETTE_HIDE) ? `<span class="badge">${esc(themes[round.theme])}</span>` : ''}${round.level ? `<span class="badge">${esc(levels[round.level])}</span>` : ''}
    <span class="round-no">${round.practice ? 'Manche d’essai' : `Manche ${round.index} / ${round.total}`}</span>
  </header>`;
}

function hostBar(round, { canEnd = true, extra = '' } = {}) {
  return `<footer class="host-bar">
    ${canEnd ? '<button class="ghost" id="end">■ Terminer la manche</button>' : ''}${!round.results ? '<button class="ghost" id="cancel">↩️ Annuler et rejouer</button>' : ''}${extra}
    <button class="ghost" id="recap-open">📋 Récap</button>
    <button class="ghost" id="sound" aria-pressed="${!isMuted()}">${isMuted() ? '🔇 Son coupé' : '🔊 Son'}</button>
    <button class="ghost" id="fs">⛶ Plein écran</button>
    <span class="join-mini"><span>Rejoindre</span><b class="code">${esc(S.session.room)}</b><span class="qr-mini" id="qr-mini"></span></span>
  </footer>`;
}

function bindBar(round) {
  qr($('qr-mini'), 3);
  if ($('recap-open')) $('recap-open').onclick = () => openRecap();
  if ($('sound')) $('sound').onclick = () => { setMuted(!isMuted()); $('sound').textContent = isMuted() ? '🔇 Son coupé' : '🔊 Son'; $('sound').setAttribute('aria-pressed', String(!isMuted())); };
  if ($('fs')) $('fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
  if ($('end')) $('end').onclick = () => {
    const msg = round.stage
      ? 'Terminer la manche maintenant ? Les points déjà gagnés sont gardés.'
      : 'Terminer la manche maintenant ? Les scores envoyés jusqu’ici sont gardés.';
    if (confirm(msg)) command('end');
  };
  if ($('cancel')) $('cancel').onclick = () => { if (confirm('Annuler cette manche ? Aucun point ne sera compté et la même règle sera reproposée.')) command('cancel'); };
}

function spectacle(st, round) {
  const phase = hostPhase(round), g = games[round.game];
  const key = `spec/${round.id}/${phase}`;
  let body;
  if (phase === 'count') {
    body = `<div class="count-layout">${round.vote?.wheel?.length ? rouletteHTML(round) : ruleCard(round.game, round.rule, round.id, { big: true, practice: round.practice, theme: round.theme, level: round.level })}
      <div class="count-side"><div class="countdown"><span>Départ dans</span><b id="count"></b></div>
        ${teamLinesHTML(round.teams, st.players)}</div></div>`;
  } else if (phase === 'grace') {
    body = `<div class="center-msg"><div class="spinner"></div><h2>Manche terminée !</h2><p>Réception des derniers scores…</p></div>`;
  } else if (round.stage) {
    body = stagedBody(st, round);
  } else {
    body = playBody(st, round, phase);
  }
  if (!show(key, `<div class="stage-screen">${topBar(round)}<section class="stage-body">${body}</section>${hostBar(round, { canEnd: phase !== 'count' && phase !== 'grace' })}</div>`)) return updateSpectacle(st, round, phase);
  bindBar(round);
  updateSpectacle(st, round, phase);
}

function playBody(st, round, phase) {
  const g = games[round.game];
  let side = '';
  if (round.game === 'memory') {
    const m = memoryStageAt(now() - round.startAt);
    const seq = m ? memorySequence(round.id, m) : [];
    side = !m ? '' : m.phase === 'show'
      ? `<div class="memo-show"><p>Suite ${m.index + 1} / 6 · Mémorisez !</p><div class="fruits big">${seq.map(f => `<span>${f}</span>`).join('')}</div></div>`
      : m.phase === 'answer'
        ? `<div class="memo-show"><p>Suite ${m.index + 1} / 6</p><h2>À vous ! Reproduisez la suite${round.rule === 'reverse' ? ' <u>à l’envers</u>' : ''}</h2><div class="fruits big hidden">${seq.map(() => '<span>❔</span>').join('')}</div></div>`
        : `<div class="memo-show"><h2>Suite suivante…</h2><p>${m.len} fruits</p></div>`;
  } else if (round.game === 'cups') {
    side = `<div class="cups-host"><div class="cup-head"><div class="cup-dots" id="hdots"></div><p class="cup-info" id="hinfo"></p></div><div class="cup-stage big" id="hstage"></div><p class="cup-msg" id="hmsg"></p></div>`;
  } else if (round.game === 'reaction') {
    side = `<div class="reaction-host"><p class="big-hint">📱 Regardez votre téléphone</p><p id="try-no"></p></div>`;
  } else if (round.game === 'barrels' && round.rule === 'lights') {
    side = `<div class="light-host" id="light"></div>`;
  } else if (round.game === 'barrels' && round.rule === 'turbo') {
    side = `<div class="turbo-host" id="turbo"></div>`;
  }
  // Course par équipe : chrono donné (20 s), temps restant en gros en haut ; la piste reste en grand.
  const teamRace = round.game === 'barrels';
  return `<div class="play-layout ${teamRace ? 'team-race' : ''}">
    ${timer('play-timer', true)}
    ${side}
    <div class="live-wrap">${teamRace ? '' : '<h3>En direct</h3>'}<ol class="live" id="live"></ol></div>
  </div>`;
}

function stagedBody(st, round) {
  const s = round.stage, players = st.players;
  if (round.game === 'cups') return cupsBody(st, round);
  if (round.game === 'truefalse') {
    const n = (s.counts || []).reduce((a, b) => a + b, 0);
    const colors = ['#1f7a4d', '#a3283f', '#2f6fb0', '#b58a1c'];
    return `<div class="tf-host">
      <p class="step">Question ${s.step + 1} / ${s.total}</p>
      <blockquote class="tf-q">${esc(s.text)}</blockquote>
      ${s.phase === 'choose' ? `${timer('stage-timer')}<p class="big-hint">Choisissez la bonne réponse sur votre téléphone${s.eligible ? ` · <b class="answered">${s.answered || 0} / ${s.eligible} ont répondu</b>` : ''}</p>
        <ol class="quiz-host-options">${(s.options || []).map((o, i) => `<li style="--c:${colors[i]}"><b>${String.fromCharCode(65 + i)}</b>${esc(o)}</li>`).join('')}</ol>` : ''}
      ${s.phase === 'stats' ? `<div class="tf-bars">${(s.options || []).map((o, i) => `<div class="bar" style="--p:${n ? (s.counts[i] || 0) / n : 0};--c:${colors[i]}"><b>${String.fromCharCode(65 + i)} · ${esc(o)}</b><span>${s.counts[i] || 0}</span></div>`).join('')}</div>
          <p class="big-hint">Et la bonne réponse est…</p>` : ''}
      ${s.phase === 'answer' ? `<ol class="quiz-host-options reveal">${(s.options || []).map((o, i) => `<li class="${i === s.answer ? 'right' : 'wrong'}" style="--c:${colors[i]}"><b>${String.fromCharCode(65 + i)}</b>${esc(o)}${i === s.answer ? ' <span class="ok">✓</span>' : ''}</li>`).join('')}</ol>${s.why ? `<p class="quiz-why host">${esc(s.why)}</p>` : ''}${s.fastest ? `<p class="fastest">⚡ <b style="color:${esc(S.state.players.find(p => p.pid === s.fastest)?.color || 'inherit')}">${esc(S.state.players.find(p => p.pid === s.fastest)?.name || '')}</b> · réponse la plus rapide · +1 bonus</p>` : ''}` : ''}
    </div>`;
  }
  if (round.game === 'lucky') return luckyBody(st, round);
  const alive = s.survivors.map(pid => players.find(p => p.pid === pid)).filter(Boolean);
  return `<div class="arena-host">
    <div class="arena-board">${arenaSVG(s, players)}</div>
    <div class="arena-info">
      <p class="step">Tour ${s.turn}</p>
      <h2>${plural(alive.length, 'survivant')}</h2>
      ${s.phase === 'choose' ? `${timer('stage-timer')}<p class="big-hint">Sur votre téléphone : touchez pour vous placer, puis touchez pour viser</p>` : arenaSummary(s, players)}
      <div class="chips">${alive.map(p => chip(p, s.shields?.includes(p.pid) ? 'shielded' : '')).join('')}</div>
    </div>
  </div>`;
}

let lastLive = '';
let lastOrder = [];
let lastCelebrated = null;
const lastPos = new Map();
let overtake = null;
function updateSpectacle(st, round, phase) {
  if (phase === 'count') { if ($('count')) $('count').textContent = Math.max(1, Math.ceil((round.startAt - now()) / 1000)); return; }
  if (round.stage) { setTimer('stage-timer', round.stage.until - round.stage.len, round.stage.until); return; }
  if (phase === 'grace') return;
  const elapsed = now() - round.startAt;
  if (round.game === 'memory') {
    // Mémoire Flash : la barre suit la phase en cours (mémoriser, puis répondre), comme sur les téléphones.
    const m = memoryStageAt(elapsed), at = sec => round.startAt + sec * 1000;
    if (m?.phase === 'show') setTimer('play-timer', at(m.start), at(m.answerAt));
    else if (m?.phase === 'answer') setTimer('play-timer', at(m.answerAt), at(m.end));
    else setTimer('play-timer', now(), now());
  } else setTimer('play-timer', round.startAt, round.endAt);
  if ($('light')) {
    const red = isRed(round.id, elapsed);
    $('light').className = `light-host ${red ? 'red' : 'green'}`;
    $('light').textContent = red ? 'Rouge · on ne tape pas !' : 'Vert · tapez !';
  }
  if ($('turbo')) $('turbo').textContent = round.endAt - now() <= 3000 ? '🔥 Turbo ! Chaque tape vaut 2 points' : 'Turbo dans les 3 dernières secondes';
  if ($('try-no')) { const i = Math.min(2, Math.floor(elapsed / REACTION_TRY)); $('try-no').textContent = `Essai ${i + 1} / 3`; }
  const live = $('live');
  if (live) {
    const scores = st.live || {};
    // Mode équipes : une ligne par équipe (somme des membres). Les temps de Top départ ne s'additionnent pas en direct.
    const teamMode = round.mode === 'team' && round.teams;
    const rows = teamMode
      ? round.teams.map(t => {
        const vals = round.game === 'reaction' ? [] : t.members.map(pid => scores[pid]).filter(v => v !== undefined);
        return { pid: t.id, name: t.name, color: t.color, v: vals.length ? vals.reduce((s, v) => s + v, 0) : undefined };
      })
      : st.players.filter(p => round.ids.includes(p.pid)).map(p => ({ ...p, v: scores[p.pid] }));
    const key = JSON.stringify([teamMode, rows.map(r => [r.pid, r.v])]);
    if (key === lastLive) return;
    lastLive = key;
    const sorted = rows.sort((a, b) => (b.v ?? -1e9) - (a.v ?? -1e9));
    const max = Math.max(1, ...sorted.map(r => r.v || 0));
    const show = v => v === undefined ? '…' : round.game === 'reaction' ? (v > 0 ? `${10000 - v} ms` : '—') : v;
    if (round.game === 'barrels') {
      raceUpdate(live, round, sorted, teamMode, scores, st);
    } else live.innerHTML = sorted.slice(0, 14).map((r, i) => `<li style="--c:${esc(r.color)};--w:${round.game === 'reaction' ? (r.v > 0 ? 1 : 0) : Math.max(0, r.v || 0) / max}">
      <span class="pos">${i + 1}</span><span class="name"><i></i>${esc(r.name)}</span><span class="bar"></span><b>${show(r.v)}</b></li>`).join('')
      + (!teamMode && sorted.length > 14 ? `<li class="more">+ ${sorted.length - 14} autres joueurs</li>` : '');
  }
}
// ---------- Bonneteau survie : grand écran ----------
// Survivants à gauche, gobelets au centre, classement à droite. Le mélange est rejoué image par image (même tirage que les téléphones).
function cupsBody(st, round) {
  const s = round.stage, lv = s.level, name = pid => st.players.find(p => p.pid === pid);
  const chipOf = pid => { const p = name(pid); return p ? `<li style="--c:${esc(p.color)}"><i></i>${esc(p.name)}</li>` : ''; };
  const team = round.mode === 'team' ? (round.teams || []).map(t => ({ ...t, left: t.members.filter(pid => s.alive.includes(pid)).length })) : null;
  const rows = st.players.filter(p => round.ids.includes(p.pid)).map(p => ({ ...p, v: s.scores?.[p.pid] || 0, out: s.eliminated[p.pid] }))
    .sort((a, b) => b.v - a.v || (a.out ? 1 : 0) - (b.out ? 1 : 0) || a.name.localeCompare(b.name, 'fr'));
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].v === r.v && Boolean(rows[i - 1].out) === Boolean(r.out) ? rows[i - 1].rank : i + 1; });
  const msg = s.phase === 'show' ? 'Suivez le raisin !' : s.phase === 'choose' ? `À vos téléphones !${s.eligible ? ` · ${s.answered || 0} / ${s.eligible} ont choisi` : ''}`
    : s.lost?.length ? `💥 ${plural(s.lost.length, 'joueur')} éliminé${s.lost.length > 1 ? 's' : ''} : ${s.lost.map(pid => esc(name(pid)?.name || '?')).join(', ')}` : '✅ Tout le monde a trouvé !';
  return `<div class="survie-host">
    <aside class="survivors"><h3>En lice <b>${s.alive.length}</b></h3>
      ${team ? `<ul class="team-left">${team.map(t => `<li style="--c:${esc(t.color)}" class="${t.left ? '' : 'gone'}"><b>${teamSymbol(t.name)} ${esc(t.name)}</b><span>${t.left} / ${t.members.length}</span></li>`).join('')}</ul>` : ''}
      <ul class="alive">${s.alive.map(chipOf).join('')}</ul></aside>
    <section class="cups-center"><p class="cup-info">Tour ${s.turn} · ${lv.g} gobelets · ${lv.s} échanges${lv.f ? ` · ${plural(lv.f, 'feinte')}` : ''}</p>
      <div class="cup-stage big" id="hstage" style="--g:${lv.g}"><div class="cup-ball"></div>${Array.from({ length: lv.g }, () => '<div class="cup"></div>').join('')}</div>
      <p class="cup-msg big">${msg}</p></section>
    <aside class="survie-rank"><h3>Classement</h3><ol>${rows.slice(0, 14).map(r => `<li class="${r.out ? 'out' : ''}" style="--c:${esc(r.color)}"><span class="rk">${r.rank}</span><i></i><span class="nm">${esc(r.name)}</span><b>${r.v}</b><small>${r.out ? `éliminé tour ${r.out}` : 'en lice'}</small></li>`).join('')}</ol></aside>
  </div>`;
}
function cupsHostFrame() {
  requestAnimationFrame(cupsHostFrame);
  const round = S.state?.round, stage = $('hstage'), s = round?.stage;
  if (!round || round.game !== 'cups' || round.results || !stage || !s) return;
  const plan = cupsTurn(round.id, s.turn - 1), t = now() - (s.from || round.startAt);
  const el = s.phase === 'show' ? Math.min(t, plan.tRot) : s.phase === 'choose' ? plan.tRot : plan.tRot + t;
  const pose = cupsPose(s.phase === 'reveal' ? { ...plan, tReveal: plan.tRot } : plan, el), H = stage.clientHeight * .55;
  stage.querySelectorAll('.cup').forEach((c, i) => { c.style.left = ((pose.x[i] + .5) / plan.g * 100) + '%'; c.style.transform = `translate(-50%, ${Math.round(pose.y[i] * H)}px)`; });
  const ball = stage.querySelector('.cup-ball');
  ball.style.left = pose.ball == null ? '-100px' : ((pose.ball + .5) / plan.g * 100) + '%'; ball.style.opacity = pose.ball == null ? 0 : 1;
}
requestAnimationFrame(cupsHostFrame);

// ---------- Résultats ----------
// Trois écrans qui s'enchaînent : podium de la manche, classement du jeu (pour le lot), classement général.
// Quatre écrans en mode équipes (avec « Résultats des équipes »), trois en solo.
function results(st, round) {
  if (st.duel?.round === round.id && duelSeen !== st.duel.id) return duelScreen(st, round);
  // Trois vues : résultats de la manche (en équipes : tableau des équipes + podium), classement du jeu, classement général.
  const slides = ['podium', 'game', 'general'];
  if (!slides.includes(resultSlide)) resultSlide = 'podium';
  const key = `res/${round.id}/${resultSlide}`;
  const g = games[round.game];
  let body;
  const ranked = (round.teamResults || []).filter(t => t.rank).length;
  if (resultSlide === 'podium' && round.mode === 'team' && round.teamResults) body = `<div class="results-teams"><h2>Résultats de la manche</h2><p class="sub-note">Score d’équipe : somme des performances des membres. Bonus par membre : ${ranked} − rang + 1 (${ranked} équipe${ranked > 1 ? 's' : ''} classée${ranked > 1 ? 's' : ''}).</p><div class="team-split">${teamResultsHTML(round, st.players)}${teamPodiumHTML(round)}</div>${round.practice ? '<p class="note">Manche d’essai : aucun point au classement.</p>' : ''}</div>`;
  else if (resultSlide === 'podium') body = `<div class="results-podium"><h2>Résultats de la manche</h2>${podium(round, st.players)}${round.practice ? '<p class="note">Manche d’essai : aucun point au classement.</p>' : ''}</div>`;
  else if (resultSlide === 'game') body = `<div class="results-general"><h2>Classement ${esc(g.name)}</h2><p class="sub-note">Score du jeu sur la soirée · entre parenthèses : points apportés au classement général.</p>${gameBoardHTML(st.players, round.game, st.perfByGame?.[round.game], st.byGame?.[round.game], null, 15)}</div>`;
  else body = `<div class="results-general"><h2>Classement général</h2>${generalBoardHTML(st.players, st.totals, { bonuses: st.bonusTotals, gains: gainsOf(round, st), before: round.before, teams: latestTeams(st), limit: 15 })}</div>`;
  const label = { podium: '📋 Résultats de la manche', game: `🏅 Classement ${g.name}`, general: '🏆 Classement général' };
  // Les trois vues restent affichées jusqu'au prochain clic (en équipes, pas de défilement automatique).
  const toggle = round.practice ? '' : slides.map(id => `<button class="ghost ${id === resultSlide ? 'on' : ''}" data-rslide="${id}" aria-pressed="${id === resultSlide}">${label[id]}</button>`).join('');
  if (!show(key, `<div class="stage-screen">${topBar(round)}<section class="stage-body">${body}</section>${hostBar(round, { canEnd: false, extra: `${toggle}${round.game === 'reaction' && !round.practice && st.duel?.round !== round.id ? '<button class="ghost gold-btn" id="duel">⚔️ Duel final</button>' : ''}<button class="primary" id="back">${st.pending ? 'Préparer la manche suivante ▸' : 'Retour au salon ▸'}</button>` })}</div>`)) return;
  bindBar(round);
  if (resultSlide === 'podium') confetti();
  document.querySelectorAll('[data-rslide]').forEach(b => b.onclick = () => { clearTimeout(resultTimer); resultSlide = b.dataset.rslide; renderHost(); });
  if ($('duel')) $('duel').onclick = () => { clearTimeout(resultTimer); command('duel'); };
  $('back').onclick = () => { clearTimeout(resultTimer); ui.dismissed = round.id; saveUi(); resultSlide = 'podium'; resetScreen(); renderHost(); };
  clearTimeout(resultTimer);
  // Solo : défilement automatique. Équipes : la vue choisie reste affichée jusqu'au prochain clic.
  if (!round.practice && !round.teamResults && resultSlide !== 'general') resultTimer = setTimeout(() => { if (S.state?.round?.id === round.id && ui.dismissed !== round.id) { resultSlide = slides[(slides.indexOf(resultSlide) + 1) % slides.length]; renderHost(); } }, 8000);
}

// ---------- Mode salon (admin) ----------
function admin(st) {
  const { series, pending, players } = st;
  const choice = ui.choice && games[ui.choice] ? ui.choice : programme.find(id => !ui.done.includes(id)) || programme[0];
  const tab = ui.tab && (ui.tab === 'general' || st.byGame?.[ui.tab]) ? ui.tab : 'general';
  const mode = ui.mode === 'team' ? 'team' : 'solo';
  const teamBy = ui.teamBy === 'size' ? 'size' : 'count';
  const teamValue = ui.teamValue || (teamBy === 'size' ? 3 : 2);
  const key = `admin/${JSON.stringify([series, pending, players.map(p => p.pid + p.name + (p.helper ? 'h' : '')), st.totals, st.byGame, st.teams, choice, ui.total, ui.done, st.round?.id, tab, st.playedThemes, mode, teamBy, teamValue])}`;
  const rows = standings(players, st.totals);
  const hasScores = rows.some(r => r.total);
  const next = pending
    ? pendingPanel(st)
    : `<h2>${series && series.played >= series.total ? 'Série terminée · choisis le jeu suivant' : 'Choisis le prochain jeu'}</h2>
      <div class="game-grid">${programme.map((id, i) => {
        const g = games[id], done = ui.done.includes(id), suggested = id === programme.find(x => !ui.done.includes(x));
        return `<button type="button" class="game-card ${id === choice ? 'selected' : ''} ${done ? 'done' : ''}" data-game="${id}" aria-pressed="${id === choice}">
          <span class="num">${i + 1}</span><span class="icon" aria-hidden="true">${g.icon}</span><b>${esc(g.name)}</b>
          <small>${esc(g.goal)}</small>
          ${done ? '<span class="tag">Joué ✓</span>' : suggested ? '<span class="tag gold">Conseillé</span>' : ''}
        </button>`;
      }).join('')}</div>
      <div class="prepare">
        <div class="seg" role="radiogroup" aria-label="Nombre de manches">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-total="${n}" aria-checked="${ui.total === n}">${plural(n, 'manche')}</button>`).join('')}</div>
        <div class="seg mode-seg" role="radiogroup" aria-label="Mode de jeu">
          <button type="button" role="radio" data-mode="solo" aria-checked="${mode === 'solo'}">Solo</button>
          <button type="button" role="radio" data-mode="team" aria-checked="${mode === 'team'}">Équipes</button>
        </div>
        ${mode === 'team' ? `<div class="team-setup">
          <label>Former <select id="team-by">
            <option value="count" ${teamBy === 'count' ? 'selected' : ''}>un nombre d’équipes</option>
            <option value="size" ${teamBy === 'size' ? 'selected' : ''}>des équipes de taille</option></select></label>
          <select id="team-value" aria-label="${teamBy === 'size' ? 'Taille des équipes' : 'Nombre d’équipes'}">${(teamBy === 'size' ? TEAM_SIZES : [2, 3, 4, 5, 6, 7, 8, 9, 10]).map(n => `<option value="${n}" ${n === teamValue ? 'selected' : ''}>${teamBy === 'size' ? `${n} joueurs` : `${n} équipes`}</option>`).join('')}</select>
        </div>` : ''}
        <button class="primary big" id="series">Préparer ${esc(games[choice].name)} ▸</button>
        ${pointsHelpHTML()}
      </div>`;
  if (!show(key, `<div class="admin">
    <section class="admin-main">
      <div class="panel next">${next}</div>
      <div class="panel">
        <div class="panel-head"><h2>Classements</h2><div class="row-btns-inline">${st.round?.results ? '<button class="ghost small" id="replay">Revoir les derniers résultats</button>' : ''}<button class="ghost small" id="open-recap">📋 Récap</button></div></div>
        <div class="tabs" role="tablist">${['general', ...programme.filter(id => st.byGame?.[id])].map(id => `<button type="button" role="tab" data-tab="${id}" aria-selected="${tab === id}">${id === 'general' ? '🏆 Général' : esc(games[id].name)}</button>`).join('')}</div>
        ${hasScores ? (tab === 'general' ? generalBoardHTML(players, st.totals, { bonuses: st.bonusTotals, teams: latestTeams(st), limit: 20 }) : gameBoardHTML(players, tab, st.perfByGame?.[tab], st.byGame[tab], null, 20)) : `<p class="muted">${players.length ? 'Aucun point pour l’instant. Les classements se remplissent après chaque manche.' : 'En attente des joueurs.'}</p>`}
        ${hasScores ? '<button class="ghost small danger" id="reset">Remettre tous les scores à zéro</button>' : ''}
      </div>
    </section>
    <aside class="admin-side">
      <div class="panel join">
        <h2>Rejoindre la partie</h2>
        <div class="qr" id="qr"></div>
        <p class="code-big">${esc(S.session.room)}</p>
        <p class="muted small">Scannez le QR code ou ouvrez <a id="join-link" target="_blank" rel="noopener">${esc(joinUrl().replace(/^https?:\/\//, ''))}</a></p>
      </div>
      <div class="panel">
        <h2>Joueurs <span class="count">${players.length}</span></h2>
        ${players.length ? `<ul class="player-list">${players.map(p => `<li>${chip(p)}<button class="icon-btn" data-remove="${esc(p.pid)}" aria-label="Retirer ${esc(p.name)}" title="Retirer">✕</button></li>`).join('')}</ul>` : '<p class="muted">Personne pour l’instant.</p>'}
        <div class="bots-box">
          <p class="muted small">Robots de test : ils ne jouent pas sur un téléphone, le serveur leur invente un résultat plausible.</p>
          <div class="bots-row"><input type="number" id="bot-count" min="1" max="500" value="5" aria-label="Nombre de robots"><button class="ghost small" id="bots">🤖 Ajouter</button>${players.some(p => p.bot) ? `<button class="ghost small danger" id="unbots">Retirer les ${players.filter(p => p.bot).length} robots</button>` : ''}</div>
        </div>
      </div>
    </aside>
  </div>`)) return;
  qr($('qr'), 8);
  $('join-link').href = joinUrl();
  document.querySelectorAll('[data-game]').forEach(b => b.onclick = () => { ui.choice = b.dataset.game; saveUi(); renderHost(); });
  document.querySelectorAll('[data-total]').forEach(b => b.onclick = () => { ui.total = Number(b.dataset.total); saveUi(); renderHost(); });
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { ui.mode = b.dataset.mode; saveUi(); renderHost(); });
  if ($('team-by')) $('team-by').onchange = e => { ui.teamBy = e.target.value; ui.teamValue = e.target.value === 'size' ? 3 : 2; saveUi(); renderHost(); };
  if ($('team-value')) $('team-value').onchange = e => { ui.teamValue = Number(e.target.value); saveUi(); renderHost(); };
  if ($('open-recap')) $('open-recap').onclick = () => openRecap();
  if ($('series')) $('series').onclick = () => command('series', { game: choice, total: ui.total || 1, mode, teamBy, teamValue });
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; saveUi(); renderHost(); });
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { const p = players.find(x => x.pid === b.dataset.remove); if (p && confirm(`Retirer ${p.name} de la partie ? Ses points seront perdus.`)) command('remove', { player: p.pid }); });
  if ($('reset')) $('reset').onclick = () => {
    const code = prompt(`Remettre TOUS les scores à zéro (général et par jeu) ?\n${players.length} joueurs et ${Object.keys(st.byGame || {}).length} classements de jeu seront effacés.\n\nPour confirmer, tape le code de la partie : ${S.session.room.toUpperCase()}`);
    if (code === null) return;
    if (code.trim().toLowerCase() !== S.session.room) { status('Code incorrect : rien n’a été effacé.', 'error'); return; }
    ui.done = []; saveUi(); command('reset', { code: S.session.room });
  };
  if ($('replay')) $('replay').onclick = () => { ui.dismissed = null; saveUi(); resetScreen(); renderHost(); };
  if ($('bots')) $('bots').onclick = () => { const n = Math.floor(Number($('bot-count').value)); if (n >= 1) command('bots', { count: n }); else status('Indique un nombre de robots (1 ou plus).', 'error'); };
  if ($('unbots')) $('unbots').onclick = () => { if (confirm('Retirer tous les robots et leurs points ?')) command('unbots'); };
  bindPending(st);
}

function pendingPanel(st) {
  const { series, pending, players } = st, g = games[series.game];
  const enough = players.length >= (g.minPlayers || 1);
  const teamOn = series.mode === 'team';
  const placed = new Set((st.teams || []).flatMap(t => t.members));
  const unplaced = players.filter(p => !placed.has(p.pid)).length;
  const teamsReady = !teamOn || ((st.teams || []).length >= 2 && unplaced === 0);
  const first = series.played === 0;
  // Bonneteau : le mode (Classique ou Survie) se choisit à chaque manche, y compris la première.
  const cupsMode = series.game === 'cups' ? `<div class="seg cups-mode" role="radiogroup" aria-label="Mode du bonneteau"><button type="button" role="radio" data-cupsmode="classic" aria-checked="${pending.rule !== 'survie'}">🥤 Classique<small>10 séries notées</small></button><button type="button" role="radio" data-cupsmode="survie" aria-checked="${pending.rule === 'survie'}">💀 Survie<small>dernier en lice</small></button></div>` : '';
  const ruleBox = cupsMode + (first
    ? (series.game === 'cups' ? '' : '<p class="rule-hint">Manche 1 : toujours en règles classiques.</p>')
    : `<div class="rule-draw"><p class="rule-hint">${pending.rule === 'classic' ? 'Cette manche se jouera sans règle spéciale.' : 'Règle spéciale tirée au sort pour cette manche :'}</p>
        <div class="rule-buttons"><button class="ghost" id="reroll">🎲 ${pending.rule === 'classic' ? 'Tirer une règle' : 'Autre règle'}</button>${pending.rule !== 'classic' ? '<button class="ghost" id="norule">Sans règle</button>' : ''}${pending.rule !== 'double' ? '<button class="ghost" id="final2">⭐ Finale ×2</button>' : ''}</div></div>`);
  // Quiz : vote des joueurs par défaut (décompte en direct) ; l'animateur peut imposer un thème. Un thème joué ce soir est grisé.
  const played = st.playedThemes || [], votes = pending.votes || {};
  const tally = {}; for (const t of Object.values(votes)) tally[t] = (tally[t] || 0) + 1;
  const voters = Object.keys(votes).length;
  const theme = series.game === 'truefalse' ? `<h3>Thème des questions</h3><div class="variants theme-list">
    <button type="button" role="radio" class="variant-opt" data-theme="vote" aria-checked="${(pending.theme || 'vote') === 'vote'}"><b>🗳️ Vote des joueurs</b><small>${plural(voters, 'vote')}${voters ? ' · égalité tirée au sort' : ' · sans vote : tirage au sort'}</small></button>
    ${Object.entries(themes).map(([id, name]) => { const off = played.includes(id); return `<button type="button" role="radio" class="variant-opt ${off ? 'off' : ''}" data-theme="${id}" ${off ? 'disabled' : ''} aria-checked="${pending.theme === id}"><b>${esc(name)}</b><small>${off ? 'Déjà joué' : tally[id] ? plural(tally[id], 'vote') : (pending.voteOptions || []).includes(id) ? 'Proposé au vote' : ''}</small></button>`; }).join('')}</div>` : '';
  const level = g.levels ? `<h3>Niveau</h3><div class="seg" role="radiogroup">${Object.entries(levels).map(([id, name]) => `<button type="button" role="radio" data-level="${id}" aria-checked="${(pending.level || 'easy') === id}">${name}</button>`).join('')}</div>` : '';
  return `<div class="pending">
    <div class="panel-head"><h2>Prochaine manche · ${series.played + 1} / ${series.total}</h2><button class="ghost small" id="change">← Changer de jeu</button></div>
    ${ruleBox}
    <details class="rule-fold"><summary>Règle à annoncer (${esc(g.name)})</summary>${ruleCard(series.game, pending.rule, null, { practice: pending.practice, theme: series.game === 'truefalse' ? pending.theme || 'all' : undefined, level: g.levels ? pending.level || 'easy' : undefined })}</details>
    ${theme}${level}
    ${teamOn ? teamPanel(st) : ''}
    <label class="switch"><input type="checkbox" id="practice" ${pending.practice ? 'checked' : ''}><span></span>Manche d’essai : on joue pour comprendre, les points ne comptent pas</label>
    <div class="start-dock"><button class="primary huge" id="start" ${enough && teamsReady ? '' : 'disabled'}>▶ Lancer la manche</button></div>
    ${!enough ? `<p class="warn">${esc(g.name)} demande au moins ${g.minPlayers} joueurs (les robots comptent).</p>`
      : !teamsReady ? `<p class="warn">Place tous les joueurs dans une équipe (2 équipes au moins) pour lancer.</p>`
        : `<p class="muted small">Explique la règle à l’oral. Décompte de 6 secondes au lancement. Raccourci : Espace.</p>`}
  </div>`;
}

// Composition des équipes : cartes par équipe, placement à la main, échange de deux joueurs, renfort.
function teamPanel(st) {
  const { series, players } = st;
  const teams = st.teams || [];
  const who = pid => players.find(p => p.pid === pid);
  const placed = new Set(teams.flatMap(t => t.members));
  const missing = players.filter(p => !placed.has(p.pid));
  const sizes = teams.map(t => t.members.length);
  const unequal = sizes.length > 1 && Math.max(...sizes) - Math.min(...sizes) > 1;
  const setup = series.teamBy === 'size' ? `équipes de ${series.teamValue} joueurs` : `${series.teamValue} équipes`;
  return `<section class="team-panel" aria-label="Composition des équipes">
    <div class="panel-head"><h3>Équipes · ${esc(setup)}</h3><button class="ghost small" id="teams-draw">🎲 Tirer à nouveau</button></div>
    ${teams.length ? `<div class="team-grid">${teams.map((t, i) => `<article class="team-card" style="--c:${esc(t.color)}">
        <header><i></i><b>${teamSymbol(t.name)} ${esc(t.name)}</b><span class="count">${t.members.length}</span></header>
        <ul>${t.members.map(pid => { const nx = (i + 1) % teams.length, nm = esc(who(pid)?.name || ''); return `<li>${chip(who(pid) || { name: '?', color: '#999' })}${who(pid)?.helper ? '<span class="tag">Renfort</span>' : ''}
          <span class="mini-actions"><button type="button" class="mini" data-move="${esc(pid)}" data-to="${nx}" title="Déplacer vers ${esc(teams[nx].name)}" aria-label="Déplacer ${nm} vers ${esc(teams[nx].name)}">⇄</button><button type="button" class="mini" data-move="${esc(pid)}" data-to="none" title="Retirer de l’équipe" aria-label="Retirer ${nm} de l’équipe">✕</button></span></li>`; }).join('')}</ul>
      </article>`).join('')}</div>` : '<p class="muted">Pas assez de joueurs pour former des équipes (il en faut 2 au moins).</p>'}
    ${missing.length ? `<div class="to-place"><p class="warn">À placer :</p><ul>${missing.map(p => `<li>${chip(p)}${teams.map((x, j) => `<button type="button" class="mini place" data-move="${esc(p.pid)}" data-to="${j}" style="--c:${esc(x.color)}" aria-label="Placer ${esc(p.name)} dans ${esc(x.name)}">+ ${esc(x.name.replace(/^Team /, ''))}</button>`).join('')}</li>`).join('')}</ul></div>` : ''}
    ${unequal ? '<p class="muted small">Équipes inégales : le jeu demandera une confirmation avant le lancement.</p>' : ''}
    <div class="helper-row"><span class="muted small">Animateur en renfort (compte pour son équipe, hors classement individuel) :</span>
      ${players.filter(p => !p.bot).map(p => `<label class="helper-opt"><input type="checkbox" data-helper="${esc(p.pid)}" ${p.helper ? 'checked' : ''}> ${esc(p.name)}</label>`).join('') || '<span class="muted small">Aucun joueur humain.</span>'}
    </div>
  </section>`;
}

function bindPending(st) {
  if (!st.pending) return;
  if ($('change')) $('change').onclick = () => { if (!st.series.played || confirm('Changer de jeu ? Les points déjà gagnés sont gardés.')) command('change-game'); };
  if ($('reroll')) $('reroll').onclick = () => command('reroll');
  if ($('norule')) $('norule').onclick = () => command('rule', { rule: 'classic' });
  if ($('final2')) $('final2').onclick = () => command('rule', { rule: 'double' });
  document.querySelectorAll('[data-cupsmode]').forEach(b => b.onclick = () => command('rule', { rule: b.dataset.cupsmode }));
  if ($('teams-draw')) $('teams-draw').onclick = () => command('teams-draw');
  document.querySelectorAll('[data-move]').forEach(b => b.onclick = () => command('teams-set', { move: { pid: b.dataset.move, team: b.dataset.to === 'none' ? null : Number(b.dataset.to) } }));

  document.querySelectorAll('[data-helper]').forEach(c => c.onchange = () => command('helper', { player: c.dataset.helper, on: c.checked }));
  document.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => b.dataset.theme !== st.pending.theme && command('theme', { theme: b.dataset.theme }));
  document.querySelectorAll('[data-level]').forEach(b => b.onclick = () => b.dataset.level !== st.pending.level && command('level', { level: b.dataset.level }));
  if ($('practice')) $('practice').onchange = e => command('practice', { on: e.target.checked });
  if ($('start')) $('start').onclick = () => { if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); command('start'); };
}

export function hostDelay(st) {
  const r = st?.round;
  if (st?.duel && !st.duel.winner) return 300;   // duel en direct
  if (!r || r.results) return 4000;   // AUDIT : salon et résultats
  if (r.stage) return Math.max(250, Math.min(1500, r.stage.until - now() + 80));
  if (now() >= r.endAt) return 1000;   // AUDIT : attente des derniers scores puis classement
  if (r.game === 'barrels' && now() >= r.startAt) return 700;   // Course : affichage quasi en direct
  return now() < r.startAt ? Math.min(1500, r.startAt - now() + 80) : 3000;   // AUDIT : classement en direct toutes les 3 s
}

// ---------- Récap : Général, Par jeu, Historique (avec les équipes de l'époque), Détail joueur ----------
const RECAP_VIEWS = [['general', 'Général'], ['game', 'Par jeu'], ['history', 'Historique'], ['player', 'Détail joueur'], ['final', '🏆 Palmarès']];
// Le récap ne se rouvre pas tout seul après un rechargement : il reste en mémoire, pas dans les réglages sauvegardés.
let recapOpen = false;
export function openRecap() { recapOpen = true; resetScreen(); renderHost(); }
function closeRecap() { recapOpen = false; resetScreen(); renderHost(); }

function recap(st) {
  const view = RECAP_VIEWS.some(([id]) => id === ui.recapView) ? ui.recapView : 'general';
  const playedGames = Object.keys(st.byGame || {});
  const game = ui.recapGame && st.byGame?.[ui.recapGame] ? ui.recapGame : playedGames[0];
  let body;
  if (view === 'general') body = `<h2>Classement général</h2>${generalBoardHTML(st.players, st.totals, { bonuses: st.bonusTotals, teams: latestTeams(st), limit: 30 })}`;
  else if (view === 'game') body = playedGames.length
    ? `<div class="tabs" role="tablist">${playedGames.map(id => `<button type="button" role="tab" data-rgame="${id}" aria-selected="${id === game}">${esc(games[id].name)}</button>`).join('')}</div>
       <h2>Classement ${esc(games[game].name)}</h2>${gameBoardHTML(st.players, game, st.perfByGame?.[game], st.byGame[game], null, 30)}`
    : '<p class="muted">Aucun point par jeu pour l’instant.</p>';
  else if (view === 'history') body = historyHTML(st);
  else if (view === 'final') body = finalHTML(st);
  else body = playerHTML(st);
  const key = `recap/${JSON.stringify([view, game, ui.recapPlayer, st.totals, st.byGame, st.history?.length, st.players.map(p => p.pid + p.name)])}`;
  const html = `<div class="stage-screen recap">
    <header class="stage-top"><span class="icon" aria-hidden="true">📋</span><h1>Récap de la soirée</h1>
      <nav class="seg recap-views" role="tablist" aria-label="Vues du récap">${RECAP_VIEWS.map(([id, name]) => `<button type="button" role="tab" data-rview="${id}" aria-selected="${id === view}">${name}</button>`).join('')}</nav>
    </header>
    <section class="stage-body recap-body">${body}</section>
    <footer class="host-bar"><button class="primary" id="recap-back">◂ Retour</button><button class="ghost" id="fs">⛶ Plein écran</button>
      <span class="join-mini"><span>Rejoindre</span><b class="code">${esc(S.session.room)}</b><span class="qr-mini" id="qr-mini"></span></span></footer>
  </div>`;
  if (!show(key, html)) return;
  if (view === 'final') { confetti(); sounds.jingle(); }
  qr($('qr-mini'), 3);
  $('recap-back').onclick = closeRecap;
  $('fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
  document.querySelectorAll('[data-rview]').forEach(b => b.onclick = () => { ui.recapView = b.dataset.rview; saveUi(); resetScreen(); renderHost(); });
  document.querySelectorAll('[data-rgame]').forEach(b => b.onclick = () => { ui.recapGame = b.dataset.rgame; saveUi(); resetScreen(); renderHost(); });
  if ($('rplayer')) $('rplayer').onchange = e => { ui.recapPlayer = e.target.value; saveUi(); resetScreen(); renderHost(); };
}

function historyHTML(st) {
  const list = [...(st.history || [])].reverse();
  if (!list.length) return '<p class="muted">Les manches apparaîtront ici dès qu’elles seront terminées.</p>';
  const nameOf = (h, pid) => esc(h.names?.[pid] || st.players.find(p => p.pid === pid)?.name || 'Joueur parti');
  return `<ol class="history">${list.map(h => {
    const top = h.results.filter(r => r.played && r.rank && r.rank <= 3).sort((a, b) => a.rank - b.rank);
    return `<li>
      <div class="h-head"><b>${esc(games[h.game]?.name || h.game)}</b><span class="badge">Manche ${h.index}</span>
        ${h.rule && h.rule !== 'classic' ? `<span class="badge gold">${esc(ruleNames(h.rule))}</span>` : ''}${h.mode === 'team' ? '<span class="badge">Équipes</span>' : ''}</div>
      ${h.teams ? `<div class="h-teams">${h.teams.map(t => {
        const r = h.teamResults?.find(x => x.id === t.id);
        return `<span class="h-team" style="--c:${esc(t.color)}"><b><i></i>${teamSymbol(t.name)} ${esc(t.name)}</b>${r?.rank ? ` ${r.rank}<sup>e</sup>` : ''}${r?.bonus ? ` <em>+${r.bonus}</em>` : ''}<small>${t.members.map(pid => nameOf(h, pid)).join(', ') || '—'}</small></span>`;
      }).join('')}</div>` : ''}
      <p class="muted small">Podium : ${top.map(r => `${r.rank}. ${nameOf(h, r.pid)} (+${r.points}${r.teamBonus ? `, bonus équipe +${r.teamBonus}` : ''})`).join(' · ') || '—'}</p>
    </li>`;
  }).join('')}</ol>`;
}

function playerHTML(st) {
  if (!st.players.length) return '<p class="muted">Personne n’a encore rejoint la partie.</p>';
  const pid = st.players.some(p => p.pid === ui.recapPlayer) ? ui.recapPlayer : st.players[0].pid;
  const board = st.byGame || {};
  const gamesOf = Object.keys(board).filter(g => pid in board[g]);
  const rows = [...(st.history || [])].reverse().flatMap(h => {
    const r = h.results.find(x => x.pid === pid);
    if (!r) return [];
    const team = h.teams?.find(t => t.members.includes(pid));
    const teamRank = team && h.teamResults?.find(x => x.id === team.id)?.rank;
    return [`<li><b>${esc(games[h.game]?.name || h.game)}</b> · manche ${h.index} · ${r.played && r.rank ? `${r.rank}<sup>e</sup>` : 'absent'} · +${r.points}${r.teamBonus ? ` · bonus équipe +${r.teamBonus}` : ''}${team ? ` · ${esc(team.name)}${teamRank ? ` (${teamRank}<sup>e</sup>)` : ''}` : ''}</li>`];
  });
  return `<div class="player-detail">
    <div class="pd-head"><select id="rplayer" aria-label="Joueur">${st.players.map(x => `<option value="${esc(x.pid)}" ${x.pid === pid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <p class="pd-total">${chip(st.players.find(p => p.pid === pid))} <b>${st.totals[pid] || 0}</b> pts au général</p></div>
    <h3>Par jeu</h3>${gamesOf.length ? `<ul class="pd-games">${gamesOf.map(g => `<li><span>${esc(games[g].name)}</span><b>${board[g][pid] || 0} pts</b></li>`).join('')}</ul>` : '<p class="muted small">Aucun point par jeu pour l’instant.</p>'}
    <h3>Manches</h3>${rows.length ? `<ol class="pd-rounds">${rows.join('')}</ol>` : '<p class="muted small">Pas encore de manche jouée.</p>'}
  </div>`;
}

// Équipes à utiliser pour regrouper le classement général : celles de la manche en cours, sinon de la dernière manche en équipes.
function latestTeams(st) {
  return st.round?.mode === 'team' ? st.round.teams : [...(st.history || [])].reverse().find(h => h.mode === 'team')?.teams || st.teams || null;
}
// Points gagnés au général pendant cette manche (affichés directement, même sans animation).
function gainsOf(round, st) {
  return Object.fromEntries(Object.keys(st.totals || {}).map(pid => [pid, (st.totals[pid] || 0) - (round.before?.[pid] || 0)]).filter(([, v]) => v > 0));
}

// ---------- Course des tonneaux (solo et équipes) ----------
// Les pistes sont créées une fois, puis mises à jour sur place : les tonneaux glissent et roulent au lieu de « sauter ».
// Sans ligne d'arrivée : la piste s'étire avec le meneur, le chrono décide. En équipes, chaque piste montre aussi l'avancée de chaque membre.
function raceUpdate(live, round, sorted, teamMode, scores, st) {
  if (live.dataset.race !== round.id) {
    live.dataset.race = round.id; live.innerHTML = ''; lastOrder = []; lastPos.clear(); overtake = null;
    live.classList.add('race');
    live.style.setProperty('--lanes', sorted.length);
    live.classList.toggle('compact', sorted.length > 4);   // beaucoup de joueurs : une ligne par piste (nom, piste, score)
    for (const r of sorted) {
      const li = document.createElement('li');
      li.className = 'lane'; li.dataset.pid = r.pid; li.style.setProperty('--c', r.color);
      li.innerHTML = `<span class="name"><span class="crown" aria-hidden="true">👑</span><i></i>${teamMode ? teamSymbol(r.name) + ' ' : ''}${esc(r.name)}<small class="place"></small></span>
        <span class="track"><span class="fill"></span><span class="cask" aria-hidden="true">${BARREL}</span></span><b class="score">0</b>${teamMode ? '<span class="members"></span>' : ''}`;
      live.appendChild(li);
    }
    const ov = document.createElement('p'); ov.className = 'overtake'; ov.id = 'overtake'; live.prepend(ov);
  }
  const prev = lastOrder.slice(), order = sorted.map(r => r.pid);
  const mover = prev.length ? order.find((pid, i) => prev.indexOf(pid) > i && (sorted[i].v || 0) > 0) : null;
  if (mover) {
    const who = sorted.find(r => r.pid === mover), passed = sorted[order.indexOf(mover) + 1];
    if (who && passed) { overtake = { text: `${who.name} passe ${passed.name} !`, pid: mover, at: now() }; sounds.whoosh(); }
  }
  lastOrder = order;
  const scale = Math.max(10, (sorted[0]?.v || 0) * 1.15);
  const ov = $('overtake');
  if (ov) { const on = overtake && now() - overtake.at < 3500; ov.textContent = on ? `🔥 ${overtake.text}` : ''; ov.classList.toggle('on', Boolean(on)); }
  sorted.forEach((r, i) => {
    const li = live.querySelector(`li.lane[data-pid="${CSS.escape(r.pid)}"]`);
    if (!li) return;
    const pos = Math.min(1, (r.v || 0) / scale), was = lastPos.get(r.pid) ?? 0;
    lastPos.set(r.pid, pos);
    li.style.order = i + 1;
    li.style.setProperty('--w', pos);
    li.classList.toggle('lead', i === 0 && (r.v || 0) > 0);
    if (pos > was + 1e-6) { li.classList.remove('rolling'); void li.offsetWidth; li.classList.add('rolling'); }
    li.classList.toggle('passing', Boolean(overtake && overtake.pid === r.pid && now() - overtake.at < 3500));
    li.querySelector('.place').textContent = i === 0 ? '1er' : `${i + 1}e`;
    li.querySelector('.score').textContent = r.v ?? 0;
    const m = li.querySelector('.members');
    if (m) {
      const team = round.teams.find(t => t.id === r.pid);
      m.innerHTML = (team?.members || []).map(pid => ({ pid, name: st.players.find(p => p.pid === pid)?.name || '?', v: scores[pid] || 0 }))
        .sort((a, b) => b.v - a.v).map(x => `<span>${esc(x.name)} <b>${x.v}</b></span>`).join('');
    }
  });
}

// ---------- Sons : tic-tac sur les 3 dernières secondes, « top » au départ, révélations, jingle des résultats ----------
const soundMemo = { tickKey: '', phaseKey: '', resultId: '', goId: '' };
if (isHost) setInterval(() => {
  const r = S.state?.round;
  if (!r) return;
  if (r.results) {
    if (soundMemo.resultId !== r.id) { soundMemo.resultId = r.id; if (now() - (r.endedAt || 0) < 15000 || !r.endedAt) sounds.jingle(); }
    return;
  }
  const t = now();
  const deadline = t < r.startAt ? r.startAt : r.stage ? (r.stage.phase === 'choose' && r.game !== 'cups' ? r.stage.until : null) : r.endAt;
  if (deadline) {
    const left = Math.ceil((deadline - t) / 1000), key = `${r.id}/${r.stage?.step ?? ''}/${deadline}/${left}`;
    if (left >= 1 && left <= 3 && soundMemo.tickKey !== key) { soundMemo.tickKey = key; sounds.tick(); }
  }
  if (r.vote?.wheel?.length && t < r.startAt && r.startAt - t <= ROULETTE_HIDE && soundMemo.wheelId !== r.id) { soundMemo.wheelId = r.id; sounds.wrongRight(); }   // arrêt de la roulette
  if (t < r.startAt && r.startAt - t < 260 && soundMemo.goId !== r.id) { soundMemo.goId = r.id; setTimeout(sounds.go, Math.max(0, r.startAt - t)); }
  const phaseKey = `${r.id}/${r.stage?.step ?? ''}/${r.stage?.phase ?? ''}`;
  if (r.stage && soundMemo.phaseKey !== phaseKey) {
    const first = !soundMemo.phaseKey.startsWith(r.id);
    soundMemo.phaseKey = phaseKey;
    if (!first && r.stage.phase === 'answer') sounds.wrongRight();
    else if (!first && r.stage.phase !== 'choose') sounds.reveal();
  }
}, 200);

// Palmarès de fin de soirée : podium général, équipe championne (somme des totaux de ses membres), vainqueur de chaque jeu.
function finalHTML(st) {
  const rows = standings(st.players, st.totals).filter(r => r.total > 0);
  if (!rows.length) return '<p class="muted">Pas encore de points : le palmarès s’affichera après la première manche.</p>';
  const top = [rows[1], rows[0], rows[2]];   // positions 1, 2, 3 (en cas d'égalité, les ex æquo partagent le podium)
  const step = (r, place) => r ? `<div class="pal-step p${place}" style="--c:${esc(r.color)}"><span class="pal-medal">${['🥇', '🥈', '🥉'][r.rank - 1] || '🏅'}</span><b>${esc(r.name)}</b><span>${r.total} pts</span><i></i></div>` : '<div class="pal-step empty"></div>';
  const teams = latestTeams(st);
  const champ = teams?.length ? teams.map(t => ({ ...t, total: t.members.reduce((a, pid) => a + (st.totals[pid] || 0), 0) })).sort((a, b) => b.total - a.total)[0] : null;
  const winners = Object.keys(st.byGame || {}).map(id => {
    const perfs = st.perfByGame?.[id] || {}, lower = id === 'reaction';
    const best = Object.entries(perfs).sort((a, b) => lower ? a[1] - b[1] : b[1] - a[1])[0];
    const p = best && st.players.find(x => x.pid === best[0]);
    return p ? `<li><span>${games[id].icon} ${esc(games[id].name)}</span><b style="color:${esc(p.color)}">${esc(p.name)}</b><small>${esc(perfLabel(id, best[1]))}</small></li>` : '';
  }).join('');
  return `<div class="palmares"><h2>Palmarès de la soirée</h2>
    <div class="pal-podium">${step(top[0], 2)}${step(top[1], 1)}${step(top[2], 3)}</div>
    <div class="pal-side">${champ && champ.total ? `<section class="pal-team" style="--c:${esc(champ.color)}"><p>Équipe championne</p><b>${esc(champ.name)}</b><span>${champ.total} pts cumulés</span></section>` : ''}
    ${winners ? `<section class="pal-games"><p>Meilleur score par jeu</p><ul>${winners}</ul></section>` : ''}</div></div>`;
}

// ---------- Raccourcis clavier (écran organisateur) ----------
// Espace / Entrée : lancer la manche, ou revenir au salon après les résultats. R : récap. S : son. F : plein écran. 1-2-3 : vues des résultats.
if (isHost) addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
  const click = id => { const b = $(id); if (b && !b.disabled) { b.click(); e.preventDefault(); return true; } return false; };
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') click('start') || click('back') || click('recap-back');
  else if (k === 'r') recapOpen ? click('recap-back') : openRecap();
  else if (k === 's') click('sound');
  else if (k === 'f') click('fs');
  else if (['1', '2', '3'].includes(k)) document.querySelectorAll('[data-rslide]')[Number(k) - 1]?.click();
});

// ---------- Roulette du thème (Quiz) ----------
// Pendant le décompte, un rouleau fait défiler les thèmes votés (plus de votes = plus de cases) et s'arrête sur le thème tiré par le serveur.
const ROULETTE_SPIN = 3800, ROULETTE_HIDE = 1800;   // le rouleau s'arrête 1,8 s avant le départ
function rouletteHTML(round) {
  const wheel = round.vote.wheel, rnd = seeded(round.id + 'roulette');
  const slots = wheel.flatMap(w => Array(Math.max(1, w.votes)).fill(w.theme));
  const reel = [];
  for (let i = 0; i < 26; i++) reel.push(slots[Math.floor(rnd() * slots.length)]);
  reel.push(round.theme, slots[Math.floor(rnd() * slots.length)]);   // le gagnant, puis une case après pour cadrer
  const spinStart = round.startAt - ROULETTE_HIDE - ROULETTE_SPIN, elapsed = Math.max(0, now() - spinStart);
  const totalVotes = wheel.reduce((a, w) => a + w.votes, 0);
  return `<section class="roulette card" style="--n:${reel.length};--stop:${reel.length - 2}">
    <h2>🎡 Roulette des thèmes</h2>
    <p class="muted">${totalVotes ? `Parmi les ${plural(wheel.length, 'thème')} votés · plus de votes = plus de chances` : 'Aucun vote : tirage parmi tous les thèmes'}</p>
    <div class="reel-window"><ol class="reel" style="animation-delay:-${elapsed}ms">${reel.map(t => `<li>${esc(themes[t] || t)}</li>`).join('')}</ol></div>
    <ul class="wheel-legend">${wheel.filter(w => w.votes).map(w => `<li>${esc(themes[w.theme])} <b>${plural(w.votes, 'vote')}</b></li>`).join('')}</ul>
  </section>`;
}

// ---------- Top départ : duel final (grand écran) ----------
let duelSeen = null, duelTimer = null;
function duelScreen(st, round) {
  const d = st.duel, t = now(), who = pid => st.players.find(p => p.pid === pid) || { name: '?', color: '#999' };
  const teamOf = pid => d.teams ? (round.teamResults || []).find(x => x.members.includes(pid)) : null;
  const phase = d.winner ? 'done' : t < d.startAt ? 'ready' : t < d.go ? 'wait' : 'go';
  const lane = pid => {
    const p = who(pid), tm = teamOf(pid), v = (d.winner ? d.last : null)?.[pid];
    const shown = v === undefined ? '' : Number.isFinite(v) ? `${v} ms` : v === 'early' ? 'Faux départ' : 'Raté';
    return `<div class="duel-lane ${d.winner === pid ? 'win' : d.winner ? 'lose' : ''}" style="--c:${esc(p.color)}">
      ${tm ? `<p class="duel-team">${teamSymbol(tm.name)} ${esc(tm.name)}</p>` : ''}<h2><i></i>${esc(p.name)}</h2><p class="duel-time">${shown}</p>${d.winner === pid ? '<p class="duel-crown">🏆 Vainqueur</p>' : ''}</div>`;
  };
  const center = phase === 'ready' ? `<p class="duel-big">${d.replay ? 'On rejoue !' : 'Prêts ?'}</p><p>${d.replay ? 'Égalité ou double faux départ' : 'Regardez votre téléphone'}</p>`
    : phase === 'wait' ? '<div class="duel-light red"></div><p class="duel-big">Attendez le vert…</p>'
    : phase === 'go' ? '<div class="duel-light green"></div><p class="duel-big">GO !</p>'
    : `<p class="duel-big">${esc(who(d.winner).name)} gagne le duel !</p><p>${d.teams ? 'Son équipe prend la 1re place.' : 'Il prend la 1re place de la manche.'}</p>`;
  const key = `duel/${d.id}/${d.attempt}/${phase}`;
  if (show(key, `<div class="stage-screen">${topBar(round)}<section class="stage-body"><div class="duel-host">${lane(d.players[0])}<div class="duel-center"><p class="eyebrow">⚔️ Duel final</p>${center}</div>${lane(d.players[1])}</div></section>${hostBar(round, { canEnd: false, extra: d.winner ? '<button class="primary" id="duel-done">Voir les résultats ▸</button>' : '' })}</div>`)) {
    bindBar(round);
    if ($('duel-done')) $('duel-done').onclick = () => { duelSeen = d.id; resetScreen(); renderHost(); };
    if (phase === 'go') sounds.go(); else if (phase === 'done') { sounds.jingle(); confetti(); }
  }
  clearTimeout(duelTimer);
  const next = phase === 'ready' ? d.startAt : phase === 'wait' ? d.go : null;
  if (next) duelTimer = setTimeout(renderHost, Math.max(20, next - now() + 10));
}

// ---------- Le Bon Tonneau : grand écran ----------
// Annonce (poseur et nombre de pièges), fenêtre commune de choix, puis révélation : les survivants sur leurs tonneaux,
// puis chaque poseur dévoile ses cases à tour de rôle. Le décor de la cave s'assombrit à chaque palier.
const LUCKY_REVEAL = { base: 2500, per: 2600 };
function luckyBody(st, round) {
  const s = round.stage, who = pid => st.players.find(p => p.pid === pid) || { name: '?', color: '#999' };
  const team = s.team ? (round.teams || []).find(t => t.id === s.team) : null;
  const poserName = team ? `${teamSymbol(team.name)} ${esc(team.name)}` : esc(who(s.posers[0]).name);
  const palier = Math.min(6, Math.ceil(s.trapCount / Math.max(2, s.size)));
  const elapsed = now() - (s.from || now());
  const r = s.reveal, before = r ? [...s.alive, ...r.lost] : s.alive;
  const onCell = c => r ? Object.entries(r.spots).filter(([, x]) => x === c).map(([pid]) => pid) : [];
  const cellAt = c => {
    if (!r) return `<div class="tonneau"><span class="t-num">${c + 1}</span></div>`;
    const poser = r.traps[c], i = poser ? r.order.indexOf(poser) : -1, delay = i >= 0 ? LUCKY_REVEAL.base + i * LUCKY_REVEAL.per - elapsed : 0;
    const here = onCell(c);
    return `<div class="tonneau ${poser ? 'trap' : 'safe'}" style="--d:${delay}ms">
      <span class="t-num">${c + 1}</span>${poser ? '<span class="boom">💥</span>' : ''}
      <div class="t-players">${here.map(pid => `<span style="--c:${esc(who(pid).color)}" class="${r.lost.includes(pid) ? 'hit' : ''}">${esc(who(pid).name)}</span>`).join('')}</div></div>`;
  };
  const head = s.phase === 'announce' ? `<p class="lk-big">Tour ${s.turn} · ${poserName} ${team ? 'pose' : 'pose'} <b>${s.trapCount} pièges</b></p><p class="muted">${team ? 'Toute l’équipe se répartit les pièges' : 'Le poseur est protégé ce tour-ci'}</p>`
    : s.phase === 'choose' ? `${timer('stage-timer')}<p class="lk-big">Choisissez votre tonneau !${s.eligible ? ` <small>${s.answered || 0} / ${s.eligible} ont choisi</small>` : ''}</p><p class="muted">${poserName} pose ${s.trapCount} pièges en secret · ${s.trapsTaken} posé${s.trapsTaken > 1 ? 's' : ''}</p>`
    : `<p class="lk-big" id="lk-step">Les survivants se placent…</p>`;
  const ranking = st.players.filter(p => round.ids.includes(p.pid)).map(p => ({ ...p, v: s.scores?.[p.pid] || 0, out: s.eliminated[p.pid], k: s.kills?.[p.pid] || 0 }))
    .sort((a, b) => b.v - a.v || b.k - a.k || a.name.localeCompare(b.name, 'fr'));
  ranking.forEach((p, i) => { const q = ranking[i - 1]; p.rank = q && q.v === p.v && q.k === p.k ? q.rank : i + 1; });
  const teamsLeft = round.mode === 'team' ? (round.teams || []).map(t => ({ ...t, left: t.members.filter(pid => s.alive.includes(pid)).length })) : null;
  if (r) setTimeout(() => {
    r.order.forEach((pid, i) => setTimeout(() => { sounds.knock(); const el = $('lk-step'); if (el) el.innerHTML = `${esc(who(pid).name)} dévoile ses pièges…`; }, Math.max(0, LUCKY_REVEAL.base + i * LUCKY_REVEAL.per - elapsed)));
    setTimeout(() => { const el = $('lk-step'); if (el) el.innerHTML = r.lost.length ? `💥 ${plural(r.lost.length, 'joueur')} éliminé${r.lost.length > 1 ? 's' : ''}` : '😮 Personne n’est tombé !'; }, Math.max(0, LUCKY_REVEAL.base + r.order.length * LUCKY_REVEAL.per - elapsed - 600));
  }, 0);
  return `<div class="lucky-host cave-p${palier}">
    <aside class="survivors"><h3>En lice <b>${s.alive.length}</b></h3>
      ${teamsLeft ? `<ul class="team-left">${teamsLeft.map(t => `<li style="--c:${esc(t.color)}" class="${t.left ? '' : 'gone'} ${t.id === s.team ? 'posing' : ''}"><b>${teamSymbol(t.name)} ${esc(t.name)}</b><span>${t.left} / ${t.members.length}</span></li>`).join('')}</ul>` : ''}
      <ul class="alive">${before.map(pid => `<li style="--c:${esc(who(pid).color)}" class="${r?.lost.includes(pid) ? 'falling' : ''} ${s.posers.includes(pid) ? 'poser' : ''}"><i></i>${esc(who(pid).name)}${s.posers.includes(pid) ? ' 🛡️' : ''}</li>`).join('')}</ul></aside>
    <section class="lk-center"><div class="lk-head">${head}</div><div class="lk-grid">${Array.from({ length: 16 }, (_, c) => cellAt(c)).join('')}</div></section>
    <aside class="survie-rank"><h3>Classement</h3><ol>${ranking.slice(0, 14).map(p => `<li class="${p.out ? 'out' : ''}" style="--c:${esc(p.color)}"><span class="rk">${p.rank}</span><i></i><span class="nm">${esc(p.name)}</span><b>${p.v}</b><small>${p.out ? `tombé au tour ${p.out}` : 'en lice'}${p.k ? ` · ${p.k} piégé${p.k > 1 ? 's' : ''}` : ''}</small></li>`).join('')}</ol></aside>
  </div>`;
}


// Mode Classique (le mode Survie a son propre écran, cupsBody).
// Bonneteau sur le grand écran : même mélange que les téléphones, image par image.
let hostCupsClassic = null;
function cupsClassicFrame() {
  requestAnimationFrame(cupsClassicFrame);
  const round = S.state?.round, st = $('hstage');
  if (!round || round.game !== 'cups' || round.stage || round.results || !st) return;
  if (hostCupsClassic?.id !== round.id) hostCupsClassic = { id: round.id, plan: cupsPlan(round.id, round.rule), L: 0 };
  const el = now() - round.startAt, plan = hostCupsClassic.plan, ser = plan.find(x => el < x.t1) || plan.at(-1);
  if (el < 0) return;
  if (hostCupsClassic.L !== ser.L || !st.querySelector('.cup')) {
    st.style.setProperty('--g', ser.g);
    st.innerHTML = '<div class="cup-ball"></div>' + Array.from({ length: ser.g }, () => '<div class="cup"></div>').join('');
    hostCupsClassic.L = ser.L;
  }
  const t = Math.min(el, ser.t1 - 1), pose = cupsPose(ser, t), H = st.clientHeight * .55;
  st.querySelectorAll('.cup').forEach((c, i) => { c.style.left = ((pose.x[i] + .5) / ser.g * 100) + '%'; c.style.transform = `translate(-50%, ${Math.round(pose.y[i] * H)}px)`; });
  const ball = st.querySelector('.cup-ball');
  ball.style.left = pose.ball == null ? '-100px' : ((pose.ball + .5) / ser.g * 100) + '%'; ball.style.opacity = pose.ball == null ? 0 : 1;
  $('hdots').innerHTML = plan.map(x => `<i class="${x.L < ser.L || (x.L === ser.L && t >= ser.tReveal) ? 'done' : x.L === ser.L ? 'cur' : ''}"></i>`).join('');
  $('hinfo').textContent = `Série ${ser.L} / 10 · ${ser.g} gobelets · ${ser.s} échanges${ser.f ? ` · ${ser.f} feinte${ser.f > 1 ? 's' : ''}` : ''}`;
  const m = el >= plan.at(-1).t1 ? 'Fin du bonneteau !' : t < ser.tShow ? (ser.L === 10 ? '🔥 Dernière série : 100 points en jeu !' : `Série ${ser.L}`) : t < ser.tMoves ? 'Le raisin est ici…' : t < ser.tChoice ? 'Suivez-le !' : t < ser.tReveal ? `À vos téléphones ! (${Math.ceil((ser.tReveal - t) / 1000)} s)` : 'Le raisin était là !';
  if ($('hmsg').textContent !== m) $('hmsg').textContent = m;
}
requestAnimationFrame(cupsClassicFrame);
