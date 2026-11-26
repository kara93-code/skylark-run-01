// Skylark Run — keyboard and mouse: arrows fly, W/S work the throttle, G drops the gear.
// The mouse drags to steer in flight and clicks the mission cards on the title screen.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_GEAR = 4;
export const ACTION_RESTART = 8;

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let drag = null;
  let wheel = 0;
  let click = null;

  function keyName(event) {
    return event.key.length === 1 ? event.key.toLowerCase() : event.key;
  }

  function onKeyDown(event) {
    const key = keyName(event);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
      event.preventDefault();
    }
    if (event.repeat) return;
    keys.add(key);
    if (key === ' ' || key === 'Enter') actions |= ACTION_CONFIRM;
    if (key === 'p' || key === 'Escape') actions |= ACTION_PAUSE;
    if (key === 'g') actions |= ACTION_GEAR;
    if (key === 'r') actions |= ACTION_RESTART;
  }

  function onKeyUp(event) {
    keys.delete(keyName(event));
  }

  function onPointerDown(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    drag = { x, y, startX: x, startY: y };
    click = { x, y };
  }

  function onPointerMove(event) {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    drag.x = (event.clientX - rect.left) * (canvas.width / rect.width);
    drag.y = (event.clientY - rect.top) * (canvas.height / rect.height);
  }

  function onPointerUp() {
    drag = null;
  }

  function onWheel(event) {
    event.preventDefault();
    wheel += event.deltaY < 0 ? 1 : -1;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function takeActions() {
    const taken = actions;
    actions = 0;
    return taken;
  }

  function takeClick() {
    const taken = click;
    click = null;
    return taken;
  }

  /** -1..1 pitch (up positive) and roll (right positive) from keys or mouse drag. */
  function stick() {
    let pitch = 0;
    let roll = 0;
    if (keys.has('ArrowUp')) pitch += 1;
    if (keys.has('ArrowDown')) pitch -= 1;
    if (keys.has('ArrowLeft')) roll -= 1;
    if (keys.has('ArrowRight')) roll += 1;
    if (drag) {
      const dx = (drag.x - drag.startX) / 160;
      const dy = (drag.y - drag.startY) / 160;
      roll = Math.max(-1, Math.min(1, roll + dx));
      pitch = Math.max(-1, Math.min(1, pitch - dy));
    }
    let throttle = 0;
    if (keys.has('w')) throttle += 1;
    if (keys.has('s')) throttle -= 1;
    if (wheel !== 0) {
      throttle += wheel * 0.35;
      wheel = 0;
    }
    return { pitch, roll, throttle };
  }

  function missionKey() {
    if (keys.has('1')) return 0;
    if (keys.has('2')) return 1;
    if (keys.has('3')) return 2;
    return -1;
  }

  return { takeActions, takeClick, stick, missionKey };
}
