export const ANCHORS = [
  { id: "airlock", p: [0, 0, 4], name: "气闸扶手", sector: "气闸外缘" },
  { id: "rail-1", p: [0, 0, -14], name: "01 · 外壁扶手", sector: "空间站外壁" },
  { id: "rail-2", p: [3, 3, -37], name: "02 · 翼板避难点", sector: "断裂翼板" },
  {
    id: "rail-3",
    p: [2, 2, -60],
    name: "03 · 中继维护架",
    sector: "陨石穿越区",
  },
  { id: "rail-4", p: [4, 0, -82], name: "04 · 补给扶手", sector: "外部作业区" },
  {
    id: "rail-5",
    p: [2, 1, -104],
    name: "05 · 回收平台",
    sector: "培养舱附近",
  },
];
export const anchorGrip = (a) => [a.p[0] - 0.8, a.p[1] - 0.35, a.p[2] - 0.65];
export const BOXES = [
  ...ANCHORS.flatMap((a) => [
    {
      id: a.id + "-shield",
      p: [a.p[0] + 1.8, a.p[1] + 0.1, a.p[2] - 0.3],
      size: [0.18, 2.7, 2.8],
      kind: "shelter",
    },
    {
      id: a.id + "-roof",
      p: [a.p[0], a.p[1] + 1.7, a.p[2] - 0.3],
      size: [3.5, 0.12, 2.8],
      kind: "shelter",
    },
  ]),
  ...[3, -18, -39, -65, -88, -108].map((z, i) => ({
    id: "solar-" + i,
    p: [5, 4, z],
    size: [9, 0.16, 10],
    kind: "solar",
  })),
  ...[3, -18, -39, -65, -88, -108].map((z, i) => ({
    id: "hull-" + i,
    p: [-9, -1, z],
    size: [10, 10, 18],
    kind: "hull",
  })),
  { id: "broken-panel", p: [0, -2, -32], size: [7, 4, 1.2], kind: "panel" },
  { id: "broken-truss", p: [1, 4.5, -67], size: [8, 3, 1], kind: "truss" },
  { id: "broken-fin", p: [-2, -1, -94], size: [5, 8, 1], kind: "panel" },
];
export const PACKS = [
  { id: "pack-0", p: [1.1, -0.15, 1], name: "气闸应急包", oxygen: 20, tape: 1 },
  {
    id: "pack-1",
    p: [1.2, -0.15, -14.8],
    name: "外壁应急包",
    oxygen: 28,
    tape: 1,
  },
  {
    id: "pack-2",
    p: [4.2, 2.85, -37.8],
    name: "翼板维修包",
    oxygen: 28,
    tape: 1,
  },
  {
    id: "pack-3",
    p: [3.2, 1.85, -60.8],
    name: "中继应急包",
    oxygen: 28,
    tape: 1,
  },
  {
    id: "pack-4",
    p: [5.2, -0.15, -82.8],
    name: "回收维修包",
    oxygen: 28,
    tape: 1,
  },
  {
    id: "pack-side-1",
    p: [9, 5, -23],
    name: "漂浮补给箱",
    oxygen: 45,
    tape: 2,
    optional: true,
  },
  {
    id: "pack-side-2",
    p: [10, -4, -72],
    name: "漂浮维修箱",
    oxygen: 45,
    tape: 2,
    optional: true,
  },
];
export const ROCKS = [
  { id: "rock-0", p: [1.5, 0.4, -8], mass: 4, r: 0.65 },
  { id: "rock-1", p: [4, 1, -24], mass: 5, r: 0.8 },
  { id: "rock-2", p: [3, 3, -48], mass: 4, r: 0.7 },
  { id: "rock-3", p: [4, -1, -76], mass: 6, r: 0.85 },
  { id: "rock-4", p: [3, 2, -99], mass: 4, r: 0.6 },
];
export const METEORS = Array.from({ length: 14 }, (_, i) => ({
  id: "meteor-" + i,
  z: -19 - i * 6.2,
  y: [0, 1.5, 3, -1, 2, -0.3, 1][i % 7],
  r: [0.55, 0.8, 0.6, 1, 0.7][i % 5],
  phase: i * 1.73,
  period: 12 + (i % 3),
  speed: 4.5 + (i % 3) * 0.65,
}));
export function meteorPosition(m, time, assist = 0) {
  const t = (time * (assist >= 2 ? 0.65 : 1) + m.phase) % m.period;
  return [
    23 - t * m.speed,
    m.y + Math.sin(t * 0.35 + m.phase) * 0.5,
    m.z + Math.sin(t * 0.2) * 1.2,
  ];
}
export function podPosition(time) {
  return [
    3 + time * 0.018,
    1 + Math.sin(time * 0.05) * 0.15,
    -119 - time * 0.055,
  ];
}
