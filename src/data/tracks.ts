/**
 * Track definitions.
 *
 * Points are control points of a closed Catmull-Rom spline in world metres:
 * [x, y, z]. Index 0 is the start/finish line and the racing direction is the
 * order of the array.
 *
 * Design intent per circuit is written on each entry — the shape is meant to
 * shape decisions (where to lift, where to commit to a drift), not just to be
 * a loop.
 */

export type ScenerySpecies = 'tree' | 'rock' | 'sign' | 'building';

export interface TrackDef {
  id: string;
  name: string;
  /** One-line pitch shown in the track select. */
  blurb: string;
  difficulty: 1 | 2 | 3;
  points: Array<[number, number, number]>;
  /** Full road width in metres. */
  width: number;
  widthVariation?: { amount: number; frequency: number };
  palette: {
    road: number;
    ground: number;
    sky: number;
    horizon: number;
    fog: number;
    scenery: number;
    accent: number;
  };
  scenery: {
    species: ScenerySpecies;
    count: number;
    /** Distance range from the centreline where instances may spawn. */
    offset: [number, number];
    scale: [number, number];
  }[];
  /** Lap targets in seconds: [gold, silver, bronze]. */
  targets: [number, number, number];
  /** Deterministic seed for scenery placement so a track always looks the same. */
  seed: number;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'sunset-loop',
    name: 'Sunset Loop',
    blurb: 'Wide, forgiving sweepers. Learn the drift here.',
    difficulty: 1,
    // Rounded circuit with long radius corners: every turn can be taken
    // flat-out once you trust the grip, so the track teaches commitment
    // before it asks for precision.
    points: [
      [0, 0, 0],
      [58, 0, 14],
      [104, 0, 56],
      [118, 0, 118],
      [96, 0, 178],
      [40, 0, 208],
      [-28, 0, 210],
      [-86, 0, 182],
      [-116, 0, 126],
      [-112, 0, 62],
      [-72, 0, 18],
      [-32, 0, -2],
    ],
    width: 15,
    widthVariation: { amount: 1.5, frequency: 3 },
    palette: {
      road: 0x3b3b42,
      ground: 0xc2a86a,
      sky: 0xffb375,
      horizon: 0xffd9a8,
      fog: 0xffc79a,
      scenery: 0x6b7f4a,
      accent: 0xff7a3d,
    },
    scenery: [
      { species: 'tree', count: 90, offset: [12, 46], scale: [0.85, 1.5] },
      { species: 'rock', count: 40, offset: [11, 30], scale: [0.6, 1.3] },
      { species: 'sign', count: 16, offset: [9.5, 11], scale: [1, 1] },
    ],
    // Calibrated against the autopilot's best lap (21.9 s, see
    // tests/bot-playtest.spec.ts). The bot never drifts, so its pace is the
    // silver line and gold deliberately requires banking drift boost.
    targets: [20, 22, 25],
    seed: 1337,
  },
  {
    id: 'ridge-run',
    name: 'Ridge Run',
    blurb: 'Crests and dips. The car goes light exactly where you want grip.',
    difficulty: 2,
    // Elevation is the antagonist: the two fastest corners sit on a crest and
    // in a compression, so the grip you have is not the grip you expect.
    points: [
      [0, 0, 0],
      [52, 2.5, 26],
      [96, 8, 68],
      [104, 12, 128],
      [70, 9, 176],
      [16, 3.5, 196],
      [-44, 1, 188],
      [-92, 5, 148],
      [-120, 11, 92],
      [-108, 13, 34],
      [-70, 7.5, -8],
      [-30, 2, -14],
    ],
    width: 13.5,
    widthVariation: { amount: 2, frequency: 4 },
    palette: {
      road: 0x35363d,
      ground: 0x53703f,
      sky: 0x7ec4f2,
      horizon: 0xd7ecfb,
      fog: 0xbdd9ea,
      scenery: 0x33562c,
      accent: 0x36c2ff,
    },
    scenery: [
      { species: 'tree', count: 140, offset: [11, 52], scale: [0.9, 1.8] },
      { species: 'rock', count: 60, offset: [10, 34], scale: [0.7, 1.6] },
      { species: 'sign', count: 18, offset: [9, 10.5], scale: [1, 1] },
    ],
    // Autopilot best lap: 33.1 s.
    targets: [30, 33, 37],
    seed: 24601,
  },
  {
    id: 'harbor-twist',
    name: 'Harbor Twist',
    blurb: 'Back-to-back hairpins. Chain the drifts or lose the lap.',
    difficulty: 3,
    // Tight, technical, and deliberately rhythmic: the hairpin pairs reward
    // linking one drift's exit boost into the next entry.
    points: [
      [0, 0, 0],
      [44, 0, 8],
      [72, 0, 36],
      [64, 0, 68],
      [28, 0, 78],
      [4, 0, 100],
      [16, 0, 134],
      [56, 0, 150],
      [86, 0, 132],
      [92, 0, 96],
      [118, 0, 70],
      [124, 0, 28],
      [96, 0, -14],
      [42, 0, -30],
      [-14, 0, -26],
      [-56, 0, -4],
      [-72, 0, 34],
      [-58, 0, 74],
      [-24, 0, 92],
      [-30, 0, 52],
      [-16, 0, 22],
    ],
    width: 11.5,
    widthVariation: { amount: 1.2, frequency: 6 },
    palette: {
      road: 0x33343a,
      ground: 0x8a8f99,
      sky: 0x2b3a55,
      horizon: 0x5d7fa8,
      fog: 0x4a5f7d,
      scenery: 0x4a5260,
      accent: 0xffd23d,
    },
    scenery: [
      { species: 'building', count: 54, offset: [12, 40], scale: [0.9, 2.4] },
      { species: 'rock', count: 30, offset: [9, 24], scale: [0.5, 1] },
      { species: 'sign', count: 22, offset: [8, 9.5], scale: [1, 1] },
    ],
    // Autopilot best lap: 41.0 s.
    targets: [37, 41, 45.5],
    seed: 90210,
  },
];

export function trackById(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
