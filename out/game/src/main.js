// Skylark Run — boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps, and the renderer paints what is there. Screens: title, play, paused,
// mission complete and crashed. ?seed=N fixes the world. ?shot=cover|takeoff|turn|landing
// (with &seed=N) stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, SCREENS, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_CRASH, EVENT_DONE, EVENT_RING, EVENT_TOUCHDOWN } from './world.js';
import { ACTION_CONFIRM, ACTION_GEAR, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createRenderer } from './render.js';
import { autopilotInput, stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);

/** Tiny WebAudio blips: a ring chime, a touchdown thud, a crash thud. No audio files. */
let audio = null;
function beep(frequency, duration, type = 'sine', gainValue = 0.12) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(gainValue, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
  } catch {
    // Audio is decoration; a silent browser still flies.
  }
}

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off: the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, {
      selectedMission: 0,
      blink: true,
      cards: [],
    });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  const ui = { selectedMission: 0, blink: true, cards: [] };
  let screen = SCREENS.TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let lastBlink = 0;

  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset(ui.selectedMission);
    accumulator = 0;
    screen = SCREENS.PLAY;
    announce(`Flying ${world.mission().name}. Take off, thread the rings, land home.`);
  }

  function endGame(done) {
    screen = done ? SCREENS.DONE : SCREENS.CRASHED;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(done ? `Mission complete. Score ${world.state.score}.` : `Crashed. Score ${world.state.score}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    const missionKey = input.missionKey();
    if (missionKey >= 0 && (screen === SCREENS.TITLE || screen === SCREENS.DONE || screen === SCREENS.CRASHED)) {
      ui.selectedMission = missionKey;
      if (screen !== SCREENS.TITLE) startGame();
    }
    if (actions & ACTION_RESTART && screen !== SCREENS.TITLE) startGame();
    if (actions & ACTION_GEAR && screen === SCREENS.PLAY) {
      world.state.gearDown = !world.state.gearDown;
      announce(world.state.gearDown ? 'Gear down.' : 'Gear up.');
    }
    if (actions & ACTION_CONFIRM && (screen === SCREENS.TITLE || screen === SCREENS.DONE || screen === SCREENS.CRASHED)) {
      startGame();
    } else if (actions & ACTION_PAUSE && screen === SCREENS.PLAY) {
      screen = SCREENS.PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREENS.PAUSED) {
      screen = SCREENS.PLAY;
      announce('Flying.');
    }
    const click = input.takeClick();
    if (click && screen === SCREENS.TITLE && ui.cards.length > 0) {
      for (const card of ui.cards) {
        if (click.x >= card.x && click.x <= card.x + card.w && click.y >= card.y && click.y <= card.y + card.h) {
          ui.selectedMission = card.index;
          startGame();
          break;
        }
      }
    }
  }

  function step() {
    if (screen === SCREENS.TITLE) {
      // Attract mode: the autopilot flies a sortie behind the title.
      world.step(STEP, autopilotInput(world.state, world));
      if (world.state.done || world.state.crashed) world.reset(ui.selectedMission);
      return;
    }
    const events = world.step(STEP, input.stick());
    if (events & EVENT_RING) beep(880, 0.25, 'sine', 0.14);
    if (events & EVENT_TOUCHDOWN) beep(140, 0.2, 'triangle', 0.16);
    if (events & EVENT_DONE) {
      beep(660, 0.2);
      setTimeout(() => beep(880, 0.3), 180);
      endGame(true);
    } else if (events & EVENT_CRASH) {
      beep(70, 0.6, 'sawtooth', 0.18);
      endGame(false);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastBlink > 450) {
      ui.blink = !ui.blink;
      lastBlink = now;
    }
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREENS.TITLE || screen === SCREENS.PLAY) {
      while (accumulator >= STEP && (screen === SCREENS.TITLE || screen === SCREENS.PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best, ui);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREENS.PLAY) {
      screen = SCREENS.PAUSED;
      announce('Paused.');
    }
  });

  announce('Skylark Run. Press Space or click a mission to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
