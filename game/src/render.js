// Skylark Run — the renderer: a chase camera over a lagoon, and the instruments a pilot reads.
// Everything is drawn on one canvas: sky, sea, islands, runway, rings, the Skylark herself,
// then the HUD — altitude, speed, heading, throttle, fuel and the next ring — big enough to
// read when the screenshot is shrunk to a contact sheet.
import { FLIGHT, MISSIONS, SCREENS, VIEW_H, VIEW_W, WORLD } from './config.js';
import { terrainHeightAt } from './world.js';

const FOCAL = (VIEW_H / 2) / Math.tan((28 * Math.PI) / 180);
const DEG = Math.PI / 180;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function createRenderer(canvas) {
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext('2d');

  function cameraBasis(state) {
    const heading = state.heading * DEG;
    const pitch = state.pitch * DEG;
    // The chase camera leans into the bank, but only halfway: the horizon stays
    // readable while the plane still shows its roll.
    const roll = state.roll * 0.45 * DEG;
    const forward = {
      x: Math.sin(heading) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(heading) * Math.cos(pitch),
    };
    const rightFlat = { x: Math.cos(heading), y: 0, z: Math.sin(heading) };
    const upFlat = { x: 0, y: 1, z: 0 };
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    const right = {
      x: rightFlat.x * cosR + upFlat.x * sinR,
      y: rightFlat.y * cosR + upFlat.y * sinR,
      z: rightFlat.z * cosR + upFlat.z * sinR,
    };
    const up = {
      x: upFlat.x * cosR - rightFlat.x * sinR,
      y: upFlat.y * cosR - rightFlat.y * sinR,
      z: upFlat.z * cosR - rightFlat.z * sinR,
    };
    const cam = {
      x: state.x - forward.x * 26 - up.y * 0 + up.x * 6.5,
      y: state.y - forward.y * 26 + 6.5,
      z: state.z - forward.z * 26,
    };
    return { forward, right, up, cam };
  }

  function project(point, basis) {
    const dx = point.x - basis.cam.x;
    const dy = point.y - basis.cam.y;
    const dz = point.z - basis.cam.z;
    const xc = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
    const yc = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
    const zc = dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z;
    if (zc < 3) return null;
    const scale = FOCAL / zc;
    return { x: VIEW_W / 2 + xc * scale, y: VIEW_H * 0.44 - yc * scale, scale, depth: zc };
  }

  function drawSky(state, basis) {
    const horizonY = VIEW_H * 0.44 + Math.tan(state.pitch * DEG) * FOCAL * 0.9;
    const sky = ctx.createLinearGradient(0, 0, 0, Math.max(0, horizonY));
    sky.addColorStop(0, '#1d5fb8');
    sky.addColorStop(0.7, '#6fb2e8');
    sky.addColorStop(1, '#cfe9f7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, Math.max(0, horizonY));
    // Sun, high ahead and to the right of the nose, clear of the HUD panels.
    const sun = project(
      { x: basis.cam.x + 1500, y: basis.cam.y + 1500, z: basis.cam.z - 2600 },
      basis,
    );
    if (sun) {
      const glow = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 130);
      glow.addColorStop(0, 'rgba(255,246,200,0.95)');
      glow.addColorStop(0.25, 'rgba(255,220,120,0.55)');
      glow.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sun.x - 140, sun.y - 140, 280, 280);
      ctx.fillStyle = '#fff7d0';
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, 26, 0, Math.PI * 2);
      ctx.fill();
    }
    return horizonY;
  }

  function drawSea(horizonY) {
    const sea = ctx.createLinearGradient(0, horizonY, 0, VIEW_H);
    sea.addColorStop(0, '#2f7fb8');
    sea.addColorStop(0.45, '#1d6aa8');
    sea.addColorStop(1, '#0d4d84');
    ctx.fillStyle = sea;
    ctx.fillRect(0, Math.max(0, horizonY), VIEW_W, VIEW_H - Math.max(0, horizonY));
    // Sun glitter on the water.
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 26; i += 1) {
      const y = horizonY + 30 + ((i * 53) % Math.max(1, VIEW_H - horizonY - 40));
      const w = 40 + ((i * 37) % 120);
      ctx.fillRect(VIEW_W * 0.18 + ((i * 97) % 500), y, w, 2);
    }
  }

  function drawClouds(state, basis) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const cloud of state.clouds) {
      const p = project(cloud, basis);
      if (!p) continue;
      const r = cloud.r * p.scale;
      if (r < 9) continue;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.x - r * 0.5, p.y + r * 0.08, r * 0.6, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.x + r * 0.5, p.y + r * 0.06, r * 0.55, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function ringPoints(cx, cz, radius, count) {
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      points.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
    }
    return points;
  }

  function drawIsland(island, basis) {
    const rim = ringPoints(island.x, island.z, island.radius, 26).map((p) => ({
      ...p,
      y: terrainHeightAt(p.x, p.z),
    }));
    const projected = rim.map((p) => project(p, basis)).filter(Boolean);
    if (projected.length < 3) return;
    ctx.beginPath();
    projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = '#e8d49a';
    ctx.fill();
    const inner = ringPoints(island.x, island.z, island.radius * 0.8, 26).map((p) => ({
      ...p,
      y: terrainHeightAt(p.x, p.z) + 1,
    }));
    const innerP = inner.map((p) => project(p, basis)).filter(Boolean);
    if (innerP.length >= 3) {
      ctx.beginPath();
      innerP.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = '#3f9e4d';
      ctx.fill();
    }
    // The hilltop, a darker green dome, offset from the runway corridor.
    const hillX = island.x + island.radius * 0.32;
    const hillZ = island.z - island.radius * 0.38;
    const hillTop = terrainHeightAt(hillX, hillZ);
    const top = project({ x: hillX, y: hillTop + 4, z: hillZ }, basis);
    const base = project({ x: hillX, y: 6, z: hillZ }, basis);
    if (top && base) {
      const w = Math.abs(base.x - top.x) + island.radius * 0.55 * base.scale;
      ctx.fillStyle = '#2c7a38';
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, Math.max(4, w / 2), Math.max(3, (base.y - top.y) * 0.9), 0, Math.PI, 0);
      ctx.fill();
    }
  }

  function runwayCorners(runway) {
    const angle = ((runway.heading - 90) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const halfL = runway.length / 2;
    const halfW = runway.width / 2;
    const corners = [];
    for (const [a, b] of [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]]) {
      corners.push({
        x: runway.x + a * cos - b * sin,
        y: runway.y + 0.6,
        z: runway.z + a * sin + b * cos,
      });
    }
    return corners;
  }

  function drawRunway(runway, basis, label) {
    const pts = runwayCorners(runway).map((p) => project(p, basis));
    if (pts.some((p) => !p)) return;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = '#3a3f46';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Centre dashes.
    ctx.fillStyle = '#ffffff';
    const angle = ((runway.heading - 90) * Math.PI) / 180;
    for (let d = -runway.length / 2 + 40; d < runway.length / 2 - 20; d += 60) {
      const cx = runway.x + Math.cos(angle) * d;
      const cz = runway.z + Math.sin(angle) * d;
      const a = project({ x: cx - Math.cos(angle) * 12, y: runway.y + 1, z: cz - Math.sin(angle) * 12 }, basis);
      const b = project({ x: cx + Math.cos(angle) * 12, y: runway.y + 1, z: cz + Math.sin(angle) * 12 }, basis);
      if (!a || !b) continue;
      ctx.lineWidth = Math.max(2, 3 * a.scale);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const centre = project({ x: runway.x, y: runway.y + 2, z: runway.z }, basis);
    if (centre && centre.scale > 0.25) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(clamp(26 * centre.scale, 10, 30))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, centre.x, centre.y - 8);
    }
  }

  function drawRings(state, basis, mission) {
    mission.rings.forEach((ring, index) => {
      const centre = project(ring, basis);
      if (!centre) return;
      const radius = FLIGHT.ringRadius * centre.scale;
      if (radius < 2) return;
      const done = index < state.ringsHit;
      const next = index === state.ringsHit;
      ctx.save();
      ctx.lineWidth = Math.max(3, radius * 0.14);
      if (done) {
        ctx.strokeStyle = '#37d67a';
        ctx.globalAlpha = 0.85;
      } else if (next) {
        ctx.strokeStyle = '#ffc21c';
        ctx.shadowColor = '#ff9d00';
        ctx.shadowBlur = 22;
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = '#bfe9ff';
        ctx.globalAlpha = 0.55;
      }
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (next) {
        ctx.fillStyle = '#ffc21c';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`RING ${index + 1}`, centre.x, centre.y - radius - 12);
      }
    });
  }

  function drawPalms(state, basis) {
    ctx.strokeStyle = '#2c7a38';
    ctx.lineWidth = 2;
    for (const palm of state.palms) {
      const base = project(palm, basis);
      if (!base || base.scale < 0.12) continue;
      const h = 16 * base.scale;
      if (h < 3) continue;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(base.x + palm.lean * h, base.y - h);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(base.x + palm.lean * h, base.y - h, h * 0.45, Math.PI * 0.9, Math.PI * 2.1);
      ctx.stroke();
    }
  }

  /** The Skylark, big in the frame, banking with the stick. Rear view from
   *  above: nose up-screen, tail down-screen. The silhouette has to read as a
   *  plane in one glance — long slim fuselage, dark glass canopy on the nose,
   *  a tall swept tail fin at the rear, tapered wings, small tailplane. */
  function drawPlane(state) {
    const cx = VIEW_W / 2;
    const cy = VIEW_H * 0.56 + state.pitch * 1.2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-state.roll * Math.PI) / 180);
    ctx.scale(1.22, 1.22);
    // Main wings — tapered and swept slightly back: wide chord at the root,
    // narrow at the tips, so the planform reads as wings, not a plank.
    ctx.fillStyle = '#e8eef4';
    ctx.strokeStyle = '#8fa3b5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-252, 10);
    ctx.lineTo(-60, -14);
    ctx.lineTo(60, -14);
    ctx.lineTo(252, 10);
    ctx.lineTo(252, 22);
    ctx.lineTo(60, 26);
    ctx.lineTo(-60, 26);
    ctx.lineTo(-252, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Orange wingtip stripes.
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(-252, 10);
    ctx.lineTo(-228, 8);
    ctx.lineTo(-228, 21);
    ctx.lineTo(-252, 22);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(252, 10);
    ctx.lineTo(228, 8);
    ctx.lineTo(228, 21);
    ctx.lineTo(252, 22);
    ctx.closePath();
    ctx.fill();
    // Tailplane — small, clearly at the tail end, behind the main wings.
    ctx.fillStyle = '#d7e0e8';
    ctx.beginPath();
    ctx.moveTo(-96, 74);
    ctx.lineTo(-28, 62);
    ctx.lineTo(28, 62);
    ctx.lineTo(96, 74);
    ctx.lineTo(96, 84);
    ctx.lineTo(28, 88);
    ctx.lineTo(-28, 88);
    ctx.lineTo(-96, 84);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Fuselage — long and slim now (was a short fat capsule): pointed nose,
    // widest at the wing root, tapering to a rounded tail.
    const fus = ctx.createLinearGradient(-34, 0, 34, 0);
    fus.addColorStop(0, '#0f7d8c');
    fus.addColorStop(0.5, '#17a8b8');
    fus.addColorStop(1, '#0b6b7a');
    ctx.fillStyle = fus;
    ctx.beginPath();
    ctx.moveTo(0, -152);
    ctx.quadraticCurveTo(-26, -140, -30, -90);
    ctx.quadraticCurveTo(-34, -20, -30, 60);
    ctx.quadraticCurveTo(-28, 100, 0, 108);
    ctx.quadraticCurveTo(28, 100, 30, 60);
    ctx.quadraticCurveTo(34, -20, 30, -90);
    ctx.quadraticCurveTo(26, -140, 0, -152);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0a4a55';
    ctx.stroke();
    // Vertical tail fin — tall, swept, orange, at the rear: base at the tail,
    // tip rising past the wing line toward the nose. The one-glance cue.
    ctx.fillStyle = '#ff7a1a';
    ctx.strokeStyle = '#b34d00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-15, 98);
    ctx.lineTo(0, 6);
    ctx.lineTo(15, 98);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Canopy — big dark glass teardrop on the nose half, with a white glint.
    ctx.fillStyle = '#0d2f4d';
    ctx.strokeStyle = '#7fd8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -96, 17, 36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.translate(0, -96);
    ctx.rotate(-0.45);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(-3, -26, 6, 40);
    ctx.restore();
    // Registration, moved to the nose so the fin owns the tail.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SKY-7', 0, -36);
    // Nav lights.
    ctx.fillStyle = '#ff2d2d';
    ctx.beginPath();
    ctx.arc(-252, 16, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2dff5e';
    ctx.beginPath();
    ctx.arc(252, 16, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(8, 20, 32, 0.92)';
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
  }

  function hudText(x, y, label, value, color = '#eaf7ff') {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7fd8ff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(label, x, y);
    ctx.fillStyle = color;
    ctx.font = 'bold 30px monospace';
    ctx.fillText(value, x, y + 32);
  }

  function drawHud(state, mission, ui) {
    const altFt = Math.round(state.y * 3.28084);
    const speedKt = Math.round(state.speed * 1.94384);
    const vsi = Math.round(Math.sin((state.pitch * Math.PI) / 180) * state.speed * 196.85);
    panel(18, 16, 240, 92);
    hudText(32, 40, 'ALTITUDE  FT', String(altFt));
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7fd8ff';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(`V/S ${vsi >= 0 ? '+' : ''}${vsi}`, 244, 96);
    panel(268, 16, 240, 92);
    hudText(282, 40, 'AIRSPEED  KT', String(speedKt));
    // Compass tape, centred on the screen.
    panel(VIEW_W / 2 - 122, 16, 244, 92);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7fd8ff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('HEADING', VIEW_W / 2, 40);
    const headings = [0, 45, 90, 135, 180, 225, 270, 315];
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = '#ffffff';
    const hdg = Math.round(((state.heading % 360) + 360) % 360);
    ctx.fillText(`${String(hdg).padStart(3, '0')}° ${names[headings.reduce((a, b) => (Math.abs(b - hdg) < Math.abs(a - hdg) ? b : a))] || ''}`, VIEW_W / 2, 76);
    ctx.fillStyle = '#ffc21c';
    ctx.beginPath();
    ctx.moveTo(VIEW_W / 2 - 8, 92);
    ctx.lineTo(VIEW_W / 2 + 8, 92);
    ctx.lineTo(VIEW_W / 2, 104);
    ctx.closePath();
    ctx.fill();
    // Mission panel.
    panel(VIEW_W - 268, 16, 250, 92);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffc21c';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(mission.name, VIEW_W - 252, 42);
    ctx.fillStyle = '#eaf7ff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(`RING ${state.ringsHit}/${mission.rings.length}`, VIEW_W - 252, 74);
    ctx.fillStyle = '#7fd8ff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`SCORE ${state.score}`, VIEW_W - 34, 74);
    ctx.textAlign = 'left';
    // Artificial horizon, bottom left.
    const hx = 96;
    const hy = VIEW_H - 106;
    panel(18, VIEW_H - 176, 168, 158);
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, hy, 62, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(hx, hy);
    ctx.rotate((-state.roll * Math.PI) / 180);
    ctx.translate(0, state.pitch * 1.4);
    ctx.fillStyle = '#3d9bd6';
    ctx.fillRect(-70, -70, 140, 70);
    ctx.fillStyle = '#8a6b3d';
    ctx.fillRect(-70, 0, 140, 70);
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffc21c';
    ctx.fillRect(hx - 22, hy - 2, 44, 4);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7fd8ff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(state.gearDown ? 'GEAR DOWN' : 'GEAR UP', hx, VIEW_H - 26);
    // Throttle + fuel, bottom right.
    panel(VIEW_W - 268, VIEW_H - 176, 250, 158);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7fd8ff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('THROTTLE', VIEW_W - 252, VIEW_H - 150);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(VIEW_W - 252, VIEW_H - 138, 218, 16);
    ctx.fillStyle = state.throttle > 0.85 ? '#ff9d00' : '#37d67a';
    ctx.fillRect(VIEW_W - 252, VIEW_H - 138, 218 * state.throttle, 16);
    ctx.fillStyle = '#7fd8ff';
    ctx.fillText('FUEL', VIEW_W - 252, VIEW_H - 100);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(VIEW_W - 252, VIEW_H - 88, 218, 16);
    ctx.fillStyle = state.fuel < 20 ? '#ff4d4d' : '#2fb7ff';
    ctx.fillRect(VIEW_W - 252, VIEW_H - 88, 218 * (state.fuel / 100), 16);
    ctx.fillStyle = '#eaf7ff';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(`${Math.round(state.fuel)}%   ${Math.round(state.throttle * 100)}% THR`, VIEW_W - 252, VIEW_H - 56);
    ctx.fillStyle = state.damage > 40 ? '#ff4d4d' : '#7fd8ff';
    ctx.fillText(`HULL ${Math.round(100 - state.damage)}%`, VIEW_W - 252, VIEW_H - 32);
    // Next-ring pointer.
    const ring = state.ringsHit < mission.rings.length ? mission.rings[state.ringsHit] : null;
    if (ring && !state.onGround) {
      const basis = cameraBasis(state);
      const p = project(ring, basis);
      const dist = Math.round(Math.hypot(state.x - ring.x, state.y - ring.y, state.z - ring.z));
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffc21c';
      ctx.font = 'bold 22px sans-serif';
      if (p && p.x > 60 && p.x < VIEW_W - 60 && p.y > 130 && p.y < VIEW_H - 190) {
        ctx.fillText(`NEXT RING  ${dist} m`, VIEW_W / 2, 132);
      } else {
        const angle = p ? Math.atan2(p.y - VIEW_H / 2, p.x - VIEW_W / 2) : 0;
        const ax = VIEW_W / 2 + Math.cos(angle) * 300;
        const ay = VIEW_H / 2 + Math.sin(angle) * 180;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(18, 0);
        ctx.lineTo(-12, -12);
        ctx.lineTo(-12, 12);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillText(`RING ${state.ringsHit + 1}  •  ${dist} m`, VIEW_W / 2, 132);
      }
    }
    // Message + warning banners.
    if (state.message) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,20,32,0.72)';
      const w = Math.min(720, ctx.measureText(state.message).width + 48);
      ctx.beginPath();
      ctx.roundRect(VIEW_W / 2 - w / 2, VIEW_H - 62, w, 40, 8);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 19px sans-serif';
      ctx.fillText(state.message, VIEW_W / 2, VIEW_H - 35);
    }
    if (state.warning && ui.blink) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff4d4d';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText(`⚠ ${state.warning}`, VIEW_W / 2, 168);
    }
  }

  function drawTitle(state, best, ui) {
    ctx.fillStyle = 'rgba(6, 18, 34, 0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 84px sans-serif';
    ctx.fillText('SKYLARK RUN', VIEW_W / 2, 168);
    ctx.fillStyle = '#ffc21c';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('Take off. Thread the rings. Bring her home.', VIEW_W / 2, 210);
    ctx.fillStyle = '#bfe9ff';
    ctx.font = '20px sans-serif';
    ctx.fillText('A 3D island flight game  •  Arrows fly  •  W/S throttle  •  G gear  •  Mouse drag steers', VIEW_W / 2, 246);
    ui.cards = [];
    MISSIONS.forEach((mission, index) => {
      const x = 190 + index * 310;
      const y = 300;
      const selected = ui.selectedMission === index;
      ctx.fillStyle = selected ? 'rgba(255,194,28,0.92)' : 'rgba(8, 26, 44, 0.88)';
      ctx.strokeStyle = selected ? '#ffffff' : 'rgba(120,220,255,0.6)';
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, 280, 190, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = selected ? '#1a2a3a' : '#ffc21c';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(mission.name, x + 140, y + 48);
      ctx.fillStyle = selected ? '#1a2a3a' : '#eaf7ff';
      ctx.font = '17px sans-serif';
      const words = mission.tag.split(' ');
      let line = '';
      let ly = y + 84;
      for (const word of words) {
        if ((line + ' ' + word).trim().length > 24) {
          ctx.fillText(line.trim(), x + 140, ly);
          line = word;
          ly += 24;
        } else line += ` ${word}`;
      }
      ctx.fillText(line.trim(), x + 140, ly);
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = selected ? '#1a2a3a' : '#7fd8ff';
      ctx.fillText(`${mission.rings.length} RINGS  •  PRESS ${index + 1}`, x + 140, y + 158);
      ui.cards.push({ x, y, w: 280, h: 190, index });
    });
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('Press SPACE or click a mission to fly', VIEW_W / 2, 560);
    ctx.fillStyle = '#bfe9ff';
    ctx.font = '18px sans-serif';
    ctx.fillText('Land gently on the runway, gear down, under 58 kt — or swim home.', VIEW_W / 2, 594);
    if (best > 0) {
      ctx.fillStyle = '#ffc21c';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(`BEST SCORE  ${best}`, VIEW_W / 2, 636);
    }
  }

  function drawEnd(state, best, screen) {
    ctx.fillStyle = 'rgba(6, 18, 34, 0.62)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    if (screen === SCREENS.DONE) {
      ctx.fillStyle = '#37d67a';
      ctx.font = 'bold 72px sans-serif';
      ctx.fillText('MISSION COMPLETE', VIEW_W / 2, 300);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText(`Score ${state.score}   •   Best ${Math.max(best, state.score)}`, VIEW_W / 2, 360);
      ctx.font = '22px sans-serif';
      ctx.fillText(state.message, VIEW_W / 2, 404);
    } else {
      ctx.fillStyle = '#ff4d4d';
      ctx.font = 'bold 72px sans-serif';
      ctx.fillText('CRASHED', VIEW_W / 2, 300);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(state.crashReason || 'The lagoon keeps what it takes.', VIEW_W / 2, 360);
      ctx.font = '22px sans-serif';
      ctx.fillText(`Score ${state.score}  •  Rings ${state.ringsHit}/${MISSIONS[state.missionIndex].rings.length}`, VIEW_W / 2, 404);
    }
    ctx.fillStyle = '#bfe9ff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('Press R to fly again  •  1 / 2 / 3 to change mission', VIEW_W / 2, 470);
  }

  function draw(state, screen, best, ui) {
    const mission = MISSIONS[state.missionIndex];
    const basis = cameraBasis(state);
    const horizonY = drawSky(state, basis);
    drawSea(horizonY);
    drawClouds(state, basis);
    for (const island of WORLD.islands) drawIsland(island, basis);
    drawRunway(WORLD.homeRunway, basis, '09');
    drawRunway(WORLD.islandStrip, basis, '02');
    drawPalms(state, basis);
    drawRings(state, basis, mission);
    if (screen !== SCREENS.TITLE) drawPlane(state);
    if (screen === SCREENS.PLAY || screen === SCREENS.PAUSED) drawHud(state, mission, ui);
    if (screen === SCREENS.PAUSED) {
      ctx.fillStyle = 'rgba(6,18,34,0.55)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 64px sans-serif';
      ctx.fillText('PAUSED', VIEW_W / 2, VIEW_H / 2);
      ctx.font = '22px sans-serif';
      ctx.fillText('Press P to keep flying', VIEW_W / 2, VIEW_H / 2 + 44);
    }
    if (screen === SCREENS.TITLE) drawTitle(state, best, ui);
    if (screen === SCREENS.DONE || screen === SCREENS.CRASHED) drawEnd(state, best, screen);
  }

  return { draw, project, cameraBasis };
}
