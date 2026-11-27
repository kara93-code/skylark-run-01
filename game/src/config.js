// Skylark Run — shared constants: flight envelope, missions and the world layout.
// One file, one job: every number the flight model and the renderer agree on lives here.
export const STEP = 1 / 60;
export const BEST_KEY = 'skylark-run-best';
export const VIEW_W = 1280;
export const VIEW_H = 800;

// Flight envelope (metres, metres/second, degrees where noted).
export const FLIGHT = {
  stallSpeed: 26,
  cruiseSpeed: 58,
  maxSpeed: 82,
  neverExceed: 88,
  minThrottle: 0,
  maxThrottle: 1,
  climbRate: 14,
  turnRate: 42,
  rollRate: 95,
  pitchRate: 38,
  fuelBurn: 0.22,
  fuelCapacity: 100,
  ringRadius: 20,
  ringScore: 250,
  landingScore: 500,
};

// The world: three islands in a blue lagoon, one home runway, one short island strip.
export const WORLD = {
  seaLevel: 0,
  homeRunway: { x: 0, z: 0, heading: 90, length: 720, width: 42, y: 2 },
  islandStrip: { x: -1180, z: 760, heading: 20, length: 420, width: 30, y: 2 },
  islands: [
    { x: 0, z: 0, radius: 880, peak: 95, name: 'Skylark Isle' },
    { x: 1500, z: -620, radius: 520, peak: 70, name: 'Gull Rock' },
    { x: -1180, z: 760, radius: 430, peak: 55, name: 'Palm Cay' },
    { x: -350, z: -1350, radius: 300, peak: 45, name: 'Turtle Shoal' },
    { x: 1700, z: 100, radius: 250, peak: 45, name: 'Beacon Rock' },
  ],
};

// Scenery landmarks, pure decoration — no collision, no flight-model effect.
// A striped lighthouse on Beacon Rock, dead ahead on the cover shot's line of
// flight, and boats at anchor in the lagoon.
export const LIGHTHOUSE = { x: 1700, z: 100, height: 50 };
export const BOATS = [
  { x: 1400, z: -80, heading: 40 },
  { x: 1500, z: 300, heading: 140 },
  { x: 800, z: 520, heading: 95 },
];

// Missions: same loop (take off, fly the rings, land) with a different goal each time.
export const MISSIONS = [
  {
    id: 'ring-run',
    name: 'RING RUN',
    tag: '8 golden rings over the lagoon',
    briefing: 'Take off, thread all 8 rings in order, then bring her home.',
    rings: [
      { x: 420, z: -260, y: 170 }, { x: 900, z: -480, y: 210 },
      { x: 1380, z: -300, y: 240 }, { x: 1150, z: 320, y: 190 },
      { x: 520, z: 620, y: 220 }, { x: -220, z: 880, y: 180 },
      { x: -900, z: 420, y: 230 }, { x: -640, z: -420, y: 200 },
    ],
    landAt: 'home',
    wind: 0,
  },
  {
    id: 'coast-patrol',
    name: 'COAST PATROL',
    tag: 'Low, fast and close to the water',
    briefing: 'Stay low over the coast, clip all 6 patrol rings, mind the gusts.',
    rings: [
      { x: 300, z: 480, y: 95 }, { x: 760, z: 700, y: 110 },
      { x: 1180, z: 240, y: 90 }, { x: 1420, z: -420, y: 120 },
      { x: 700, z: -760, y: 100 }, { x: 60, z: -620, y: 110 },
    ],
    landAt: 'home',
    wind: 6,
  },
  {
    id: 'island-hop',
    name: 'ISLAND HOP',
    tag: 'Land on Palm Cay, then fly home',
    briefing: 'Take off, land on the short strip at Palm Cay, then fly home and land again.',
    rings: [
      { x: 260, z: 380, y: 180 }, { x: -420, z: 640, y: 200 },
      { x: -950, z: 700, y: 160 },
    ],
    landAt: 'island',
    wind: 2,
  },
];

export const SCREENS = {
  TITLE: 'title',
  PLAY: 'play',
  PAUSED: 'paused',
  DONE: 'done',
  CRASHED: 'crashed',
};
