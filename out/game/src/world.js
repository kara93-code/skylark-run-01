// Skylark Run — the flight model: one sortie, from takeoff roll to touchdown.
// Take off, thread the rings in order, then land on the target strip. Fuel burns,
// speed is life, and the ground is always exactly where the terrain says it is.
import { FLIGHT, MISSIONS, STEP, WORLD } from './config.js';

export const EVENT_NONE = 0;
export const EVENT_RING = 1;
export const EVENT_TOUCHDOWN = 2;
export const EVENT_CRASH = 4;
export const EVENT_DONE = 8;
export const EVENT_REFUEL = 16;

/** Smooth island bump: 1 at the centre, 0 at the shore. */
export function islandBump(distance, radius) {
  const d = distance / radius;
  if (d >= 1) return 0;
  return (Math.cos(d * Math.PI) + 1) / 2;
}

/** Terrain height (metres) at a map point; 0 is the sea. */
export function terrainHeightAt(x, z) {
  let height = 0;
  for (const island of WORLD.islands) {
    const dx = x - island.x;
    const dz = z - island.z;
    const distance = Math.hypot(dx, dz);
    if (distance < island.radius) {
      height = Math.max(height, island.peak * islandBump(distance, island.radius) + 2);
    }
  }
  // A runway is a flat corridor cut through its island: blend the terrain down to
  // the strip so a plane can sit on it (and lift off from it) without being inside a hill.
  return flattenRunway(flattenRunway(height, x, z, WORLD.homeRunway), x, z, WORLD.islandStrip);
}

function flattenRunway(height, x, z, runway) {
  const angle = ((runway.heading - 90) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - runway.x;
  const dz = z - runway.z;
  const along = dx * cos + dz * sin;
  const across = -dx * sin + dz * cos;
  const aDist = Math.max(0, Math.abs(along) - runway.length / 2);
  const cDist = Math.max(0, Math.abs(across) - runway.width / 2);
  const dist = Math.hypot(aDist, cDist);
  const blend = Math.max(0, 1 - dist / 160);
  const f = blend * blend * (3 - 2 * blend);
  return height + (runway.y - height) * f;
}

function inRunway(x, z, runway) {
  const angle = ((runway.heading - 90) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - runway.x;
  const dz = z - runway.z;
  const along = dx * cos + dz * sin;
  const across = -dx * sin + dz * cos;
  return Math.abs(along) <= runway.length / 2 && Math.abs(across) <= runway.width / 2;
}

/** The runway under a map point, or null (open ground, or sea). */
export function runwayAt(x, z) {
  if (inRunway(x, z, WORLD.homeRunway)) return WORLD.homeRunway;
  if (inRunway(x, z, WORLD.islandStrip)) return WORLD.islandStrip;
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createWorld(random) {
  // Decoration, fixed per seed: clouds to fly under and palms on the shores.
  const clouds = [];
  for (let i = 0; i < 16; i += 1) {
    clouds.push({
      x: random.range(-1900, 1900),
      z: random.range(-1700, 1700),
      y: random.range(260, 420),
      r: random.range(60, 150),
    });
  }
  const palms = [];
  for (const island of WORLD.islands) {
    for (let i = 0; i < 14; i += 1) {
      const angle = random.range(0, Math.PI * 2);
      const distance = island.radius * random.range(0.55, 0.92);
      const x = island.x + Math.cos(angle) * distance;
      const z = island.z + Math.sin(angle) * distance;
      palms.push({ x, z, y: terrainHeightAt(x, z), lean: random.range(-0.25, 0.25) });
    }
  }

  const state = {
    missionIndex: 0,
    x: 0, z: 0, y: 2,
    heading: 90, pitch: 0, roll: 0,
    speed: 0, throttle: 0,
    fuel: FLIGHT.fuelCapacity,
    damage: 0,
    gearDown: true,
    onGround: true,
    ringsHit: 0,
    score: 0,
    time: 0,
    leg: 0,
    phase: 'takeoff',
    message: '',
    warning: '',
    crashReason: '',
    done: false,
    crashed: false,
    clouds,
    palms,
  };

  function mission() {
    return MISSIONS[state.missionIndex];
  }

  function targetRunway() {
    if (mission().landAt === 'island' && state.leg === 0) return WORLD.islandStrip;
    return WORLD.homeRunway;
  }

  function reset(missionIndex = 0) {
    state.missionIndex = missionIndex;
    state.x = -300;
    state.z = 0;
    state.y = WORLD.homeRunway.y;
    state.heading = 90;
    state.pitch = 0;
    state.roll = 0;
    state.speed = 0;
    state.throttle = 0;
    state.fuel = FLIGHT.fuelCapacity;
    state.damage = 0;
    state.gearDown = true;
    state.onGround = true;
    state.ringsHit = 0;
    state.score = 0;
    state.time = 0;
    state.leg = 0;
    state.phase = 'takeoff';
    state.message = 'Line up on the runway. Throttle up with W.';
    state.warning = '';
    state.crashReason = '';
    state.done = false;
    state.crashed = false;
  }

  function nextRing() {
    const rings = mission().rings;
    return state.ringsHit < rings.length ? rings[state.ringsHit] : null;
  }

  function crash(reason) {
    state.crashed = true;
    state.crashReason = reason;
    state.damage = 100;
    state.message = reason;
    return EVENT_CRASH;
  }

  function step(dt, input) {
    if (state.done || state.crashed) return EVENT_NONE;
    let events = EVENT_NONE;
    state.time += dt;
    const m = mission();

    // Throttle: W/S keys move it, the mouse wheel moves it, it never jumps.
    if (state.fuel > 0) {
      state.throttle = clamp(state.throttle + (input.throttle || 0) * dt * 0.7, 0, 1);
    } else {
      state.throttle = 0;
      state.warning = 'OUT OF FUEL — glide her in!';
    }

    if (state.onGround) {
      const targetSpeed = state.throttle * FLIGHT.maxSpeed * 0.92;
      state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 0.8);
      state.heading += (input.roll || 0) * 14 * dt * Math.min(1, state.speed / 30);
      state.y = WORLD.homeRunway.y;
      if (state.speed > FLIGHT.stallSpeed && (input.pitch || 0) > 0.25) {
        state.onGround = false;
        state.pitch = 6;
        state.phase = state.ringsHit < m.rings.length ? 'rings' : 'return';
        state.message = 'Airborne! Fly through the gold ring.';
      }
      state.fuel = Math.max(0, state.fuel - state.throttle * FLIGHT.fuelBurn * dt * 0.4);
      return events;
    }

    // In the air: bank turns, pitch climbs and dives, speed follows the throttle.
    const rollInput = input.roll || 0;
    const pitchInput = input.pitch || 0;
    state.roll = clamp(state.roll + rollInput * FLIGHT.rollRate * dt, -65, 65);
    if (rollInput === 0) state.roll *= Math.max(0, 1 - 0.55 * dt);
    state.pitch = clamp(state.pitch + pitchInput * FLIGHT.pitchRate * dt, -28, 32);
    if (pitchInput === 0) state.pitch *= Math.max(0, 1 - 0.35 * dt);

    const headingRate = state.roll * 0.6 * (state.speed / 55);
    state.heading = (state.heading + headingRate * dt + 360) % 360;

    const targetSpeed = 22 + state.throttle * 66;
    state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 0.5);
    state.speed -= Math.sin((state.pitch * Math.PI) / 180) * 11 * dt;
    state.speed = clamp(state.speed, 12, 110);

    const headingRad = (state.heading * Math.PI) / 180;
    const pitchRad = (state.pitch * Math.PI) / 180;
    const forward = Math.cos(pitchRad) * state.speed;
    state.x += Math.sin(headingRad) * forward * dt;
    state.z -= Math.cos(headingRad) * forward * dt;
    state.x += m.wind * dt;
    let verticalSpeed = Math.sin(pitchRad) * state.speed;
    if (state.speed < FLIGHT.stallSpeed) verticalSpeed -= (FLIGHT.stallSpeed - state.speed) * 0.9;
    state.y += verticalSpeed * dt;

    state.fuel = Math.max(0, state.fuel - state.throttle * FLIGHT.fuelBurn * dt);

    // Warnings the pilot can still act on.
    state.warning = '';
    if (state.speed < FLIGHT.stallSpeed + 4) state.warning = 'STALL — NOSE DOWN, POWER UP';
    else if (state.speed > FLIGHT.neverExceed) state.warning = 'OVERSPEED — THROTTLE BACK';
    else if (state.y < 60 && verticalSpeed < -4) state.warning = 'PULL UP — TERRAIN';
    else if (state.fuel < 15) state.warning = 'LOW FUEL';
    if (state.speed > FLIGHT.neverExceed) state.damage += 10 * dt;

    // Rings: fly through the centre and it turns green.
    const ring = nextRing();
    if (ring) {
      const distance = Math.hypot(state.x - ring.x, state.y - ring.y, state.z - ring.z);
      if (distance < FLIGHT.ringRadius) {
        state.ringsHit += 1;
        state.score += FLIGHT.ringScore;
        events |= EVENT_RING;
        state.message = state.ringsHit >= m.rings.length
          ? 'All rings! Bring her home to land.'
          : `Ring ${state.ringsHit} of ${m.rings.length} — nice flying!`;
        if (state.ringsHit >= m.rings.length) state.phase = 'return';
      }
    }

    // The ground, the sea and the runway decide what a touchdown means. A plane that
    // has just lifted off is climbing (vertical speed above zero), so it cannot touch
    // down again until it is actually descending — otherwise every takeoff bounces.
    const ground = terrainHeightAt(state.x, state.z);
    const strip = runwayAt(state.x, state.z);
    if (verticalSpeed < 0 && state.y <= Math.max(ground, strip ? strip.y : 0) + 2) {
      const gentle = verticalSpeed > -7 && state.speed < 58;
      if (strip && gentle && state.gearDown) {
        state.onGround = true;
        state.y = strip.y;
        state.pitch = 0;
        state.roll = 0;
        state.speed = Math.min(state.speed, 40);
        events |= EVENT_TOUCHDOWN;
        const home = strip === WORLD.homeRunway;
        if (state.ringsHit >= m.rings.length && ((m.landAt === 'island' && state.leg === 0 && !home) || home)) {
          if (m.landAt === 'island' && state.leg === 0 && !home) {
            state.leg = 1;
            state.fuel = FLIGHT.fuelCapacity;
            state.message = 'Palm Cay reached — refuelled. Now fly home!';
            events |= EVENT_REFUEL;
            return events;
          }
          const bonus = 500 + Math.round(state.fuel * 5) + Math.max(0, 600 - Math.round(state.time));
          state.score += bonus;
          state.done = true;
          state.phase = 'landed';
          state.message = `Landed! Mission complete — bonus +${bonus}.`;
          return events | EVENT_DONE;
        }
        state.message = 'Down safe. Throttle up to take off again.';
        return events;
      }
      if (strip && !state.gearDown) return crash('Belly landing — gear was up!');
      if (strip && !gentle) return crash('Hard landing — too fast, too steep.');
      if (ground > 2) return crash('Crashed into the hillside.');
      return crash('Ditched in the sea.');
    }
    if (state.damage >= 100) return crash('Airframe overstressed — she broke up.');
    // Climbing through a hill is still hitting the hill.
    if (state.y <= ground) return crash(ground > 2 ? 'Crashed into the hillside.' : 'Ditched in the sea.');
    if (state.y > 900) {
      state.y = 900;
      state.pitch = Math.min(state.pitch, 0);
    }
    return events;
  }

  reset(0);
  return { state, reset, step, mission, nextRing, targetRunway, terrainHeightAt, runwayAt };
}

export { STEP };
