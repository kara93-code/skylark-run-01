// Skylark Run — screenshot scenes: each one flies the real rules forward from a fresh
// world with a simple autopilot, so every frame is a moment a real sortie produces and
// the same seed always gives the same frame. ?shot=cover|takeoff|turn|landing
import { FLIGHT, STEP } from './config.js';
import { SCREENS } from './config.js';

/** Steer toward the next ring, or toward the runway when the rings are done.
 *  A gentle proportional controller: aim the bank at the heading error and the
 *  pitch at the altitude error, so the plane settles instead of seesawing. */
export function autopilotInput(state, world) {
  const input = { pitch: 0, roll: 0, throttle: 0 };
  if (state.onGround) {
    input.throttle = 1;
    input.pitch = state.speed > FLIGHT.stallSpeed ? 1 : 0;
    return input;
  }
  const ring = world.nextRing();
  let target;
  let finalApproach = false;
  if (ring) {
    target = ring;
  } else {
    // Short final: join the extended centreline 900 m out, then ride the glide
    // slope down to the threshold, wings level, gear down.
    const runway = world.targetRunway();
    const headingRad = (runway.heading * Math.PI) / 180;
    const axis = { x: Math.sin(headingRad), z: -Math.cos(headingRad) };
    const distance = Math.hypot(state.x - runway.x, state.z - runway.z);
    state.gearDown = distance < 1100;
    if (distance > 900) {
      target = { x: runway.x - axis.x * 900, y: 120, z: runway.z - axis.z * 900 };
    } else {
      finalApproach = true;
      target = {
        x: runway.x + axis.x * 120,
        y: Math.max(12, Math.min(120, distance * 0.09)),
        z: runway.z + axis.z * 120,
      };
    }
  }
  const dx = target.x - state.x;
  const dz = target.z - state.z;
  let desiredHeading = (Math.atan2(dx, -dz) * 180) / Math.PI;
  if (finalApproach) {
    // Steer at a point 300 m past the threshold on the centreline: the heading
    // blends into the runway heading as the plane lines up, instead of flying
    // parallel to the strip forever.
    const runway = world.targetRunway();
    const headingRad = (runway.heading * Math.PI) / 180;
    const aimX = runway.x + Math.sin(headingRad) * 300;
    const aimZ = runway.z - Math.cos(headingRad) * 300;
    desiredHeading = (Math.atan2(aimX - state.x, -(aimZ - state.z)) * 180) / Math.PI;
  }
  const error = ((desiredHeading - state.heading + 540) % 360) - 180;
  const rollCap = finalApproach ? 14 : 32;
  const targetRoll = Math.max(-rollCap, Math.min(rollCap, error * 1.1));
  input.roll = Math.max(-1, Math.min(1, (targetRoll - state.roll) / 14));
  const climb = Math.abs(error) > 70 ? 0 : 1;
  const targetPitch = climb * Math.max(-10, Math.min(14, (target.y - state.y) / 5));
  input.pitch = Math.max(-1, Math.min(1, (targetPitch - state.pitch) / 8));
  if (state.speed < 52) input.throttle = 1;
  else if (state.speed > 72) input.throttle = -1;
  else input.throttle = 0.25;
  return input;
}

function flyFor(world, seconds, stopWhen) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    world.step(STEP, autopilotInput(world.state, world));
    if (stopWhen && stopWhen(world.state)) break;
    if (world.state.done || world.state.crashed) break;
  }
}

/**
 * Set `world` to the named scene and return the screen to draw over it.
 * cover: two rings down, the third gold ring dead ahead over the lagoon.
 * takeoff: rolling fast down runway 09, nose just coming up.
 * turn: four rings down, banked hard toward the next one.
 * landing: short final to runway 09, gear down, the strip filling the view.
 */
export function stageShot(name, world) {
  world.reset(0);
  if (name === 'takeoff') {
    flyFor(world, 4.6);
    return { screen: SCREENS.PLAY, best: 0 };
  }
  if (name === 'turn') {
    flyFor(world, 90, (state) => state.ringsHit >= 4);
    flyFor(world, 2);
    return { screen: SCREENS.PLAY, best: world.state.score };
  }
  if (name === 'landing') {
    flyFor(world, 150, (state) => {
      if (state.ringsHit < 8 || state.onGround) return false;
      const distance = Math.hypot(state.x, state.z);
      return distance < 380 && state.y < 70;
    });
    return { screen: SCREENS.PLAY, best: world.state.score };
  }
  flyFor(world, 90, (state) => state.ringsHit >= 2);
  flyFor(world, 8, (state) => {
    const ring = world.nextRing();
    if (!ring) return true;
    return Math.hypot(state.x - ring.x, state.y - ring.y, state.z - ring.z) < 150;
  });
  return { screen: SCREENS.PLAY, best: world.state.score };
}
