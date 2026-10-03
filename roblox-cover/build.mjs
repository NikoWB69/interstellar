// Generates the Roblox thumbnail (1920x1080) and icon (512x512) as SVG,
// then renders both to PNG with headless Chromium.
//
//   node roblox-cover/build.mjs
//
// Edit TITLE / TAGLINE below to rename the game.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TITLE = 'IRON TIDE';
const TAGLINE = 'HOLD THE LINE';

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const font = readFileSync(join(here, 'fonts/RussoOne-Regular.woff2')).toString('base64');

const C = {
  skyTop: '#08111d',
  skyMid: '#152539',
  skyLow: '#3b2f45',
  sunTop: '#ffd27a',
  sunLow: '#ff5e3a',
  sea: '#070d16',
  steel: '#05080e',
  seam: '#1b2634',
  amber: '#ffb35c',
  amberHot: '#fff4dc',
  cyan: '#4ff3ff',
  cyanDeep: '#00b4ff',
  text: '#eef3f7',
};

// --- helpers --------------------------------------------------------------

const pts = (p) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const poly = (p, a = '') => `<polygon points="${pts(p)}" ${a}/>`;
const mirror = (p) => p.map(([x, y]) => [-x, y]).reverse();
const pair = (p, a = '') => poly(p, a) + poly(mirror(p), a);

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- jaeger (origin = chest reactor) --------------------------------------

const J = {
  head: [[-54, -100], [-60, -142], [-45, -176], [45, -176], [60, -142], [54, -100]],
  crest: [[-10, -174], [0, -198], [10, -174]],
  chest: [[-165, -108], [165, -108], [190, -70], [178, 40], [120, 140], [-120, 140], [-178, 40], [-190, -70]],
  abdomen: [[-105, 132], [105, 132], [92, 232], [-92, 232]],
  pelvis: [[-140, 225], [140, 225], [160, 300], [120, 380], [-120, 380], [-160, 300]],
  leg: [[-150, 340], [-40, 340], [-40, 520], [-150, 520]],
  shoulder: [[-150, -108], [-200, -140], [-292, -130], [-334, -80], [-326, -8], [-250, 12], [-172, -18]],
  upperArm: [[-302, -20], [-238, -20], [-242, 124], [-298, 124]],
  forearm: [[-322, 128], [-218, 128], [-204, 238], [-224, 292], [-312, 292], [-334, 238]],
  fist: [[-314, 288], [-220, 288], [-226, 356], [-308, 356]],
};

function jaegerSilhouette() {
  return [
    pair(J.leg), poly(J.pelvis), poly(J.abdomen),
    pair(J.upperArm), `<circle cx="-270" cy="126" r="30"/><circle cx="270" cy="126" r="30"/>`,
    pair(J.forearm), pair(J.fist),
    poly(J.chest), pair(J.shoulder), poly(J.head), poly(J.crest),
  ].join('');
}

function jaegerDetails(sid) {
  const spokes = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return `<line x1="${(Math.cos(a) * 14).toFixed(1)}" y1="${(Math.sin(a) * 14).toFixed(1)}" x2="${(Math.cos(a + 0.5) * 40).toFixed(1)}" y2="${(Math.sin(a + 0.5) * 40).toFixed(1)}"/>`;
  }).join('');
  return `
    <g fill="none" stroke="${C.seam}" stroke-width="2.5" stroke-linejoin="round">
      <polyline points="-120,-108 -80,-40 80,-40 120,-108"/>
      <line x1="-98" y1="165" x2="98" y2="165"/>
      <line x1="-95" y1="198" x2="95" y2="198"/>
      <polyline points="-140,290 0,320 140,290"/>
      <line x1="-318" y1="-60" x2="-180" y2="-60"/>
      <line x1="318" y1="-60" x2="180" y2="-60"/>
    </g>
    <circle r="150" fill="url(#${sid}-reactorHalo)"/>
    <circle r="62" fill="#0b121c" stroke="#2b3644" stroke-width="3"/>
    <circle r="44" fill="url(#${sid}-reactorCore)" filter="url(#${sid}-glow)"/>
    <g stroke="#b4561e" stroke-opacity=".45" stroke-width="3" stroke-linecap="round">${spokes}</g>
    <circle r="11" fill="${C.amberHot}"/>
    ${poly([[-45, -150], [45, -150], [40, -135], [-40, -135]], `fill="${C.amber}" filter="url(#${sid}-glow)"`)}
    <g fill="${C.amber}" opacity=".85" filter="url(#${sid}-glow)">
      ${pair([[-312, 186], [-236, 186], [-234, 194], [-314, 194]])}
      ${pair([[-310, 206], [-238, 206], [-236, 214], [-312, 214]])}
    </g>`;
}

function jaeger(sid, x, y, s) {
  return `
  <g transform="translate(${x} ${y}) scale(${s})">
    <defs><g id="${sid}-jsil">${jaegerSilhouette()}</g></defs>
    <use href="#${sid}-jsil" transform="translate(${3.5 / s} ${-1.5 / s})" fill="${C.amber}" opacity=".75"/>
    <use href="#${sid}-jsil" fill="${C.steel}" stroke="${C.seam}" stroke-width="2.5" stroke-linejoin="round"/>
    ${jaegerDetails(sid)}
  </g>`;
}

// --- kaiju (absolute coords, thumbnail only) ------------------------------

function kaiju(sid, horizon) {
  const P0 = [1388, 462], P1 = [1560, 248], P2 = [1950, 476];
  const B = (t) => [0, 1].map((k) => (1 - t) ** 2 * P0[k] + 2 * (1 - t) * t * P1[k] + t * t * P2[k]);
  const dB = (t) => [0, 1].map((k) => 2 * (1 - t) * (P1[k] - P0[k]) + 2 * t * (P2[k] - P1[k]));

  const head = [
    [1236, horizon + 20], [1244, 690], [1256, 632], [1214, 614], [1150, 602],
    [1206, 589], [1104, 574], [1146, 552], [1204, 528], [1290, 480], [1368, 432],
    [1352, 470], [1388, 462],
  ];
  const back = Array.from({ length: 41 }, (_, i) => B(i / 40));
  const body = [...head, ...back, [1960, horizon + 20]];

  const r = rng(7);
  const spikes = [];
  const spots = [];
  for (let i = 0; i < 12; i++) {
    const t = 0.05 + i * 0.075;
    const [bx, by] = B(t);
    const [dx, dy] = dB(t);
    const len = Math.hypot(dx, dy);
    const T = [dx / len, dy / len];
    const N = [T[1], -T[0]];
    const h = 34 + 70 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + r() * 14;
    const w = 30 + 22 * Math.sin(Math.PI * t);
    spikes.push(poly([
      [bx - T[0] * w / 2 - N[0] * 6, by - T[1] * w / 2 - N[1] * 6],
      [bx + N[0] * h + T[0] * h * 0.55, by + N[1] * h + T[1] * h * 0.55],
      [bx + T[0] * w / 2 - N[0] * 6, by + T[1] * w / 2 - N[1] * 6],
    ]));
    if (i > 0 && i < 11) {
      const [sx, sy] = B(t + 0.037);
      spots.push(`<circle cx="${(sx - N[0] * 26).toFixed(1)}" cy="${(sy - N[1] * 26).toFixed(1)}" r="${(3 + r() * 3).toFixed(1)}"/>`);
    }
  }

  return `
  <defs><g id="${sid}-ksil">${poly(body)}${spikes.join('')}</g></defs>
  <use href="#${sid}-ksil" transform="translate(-4 -2)" fill="#ff8a4a" opacity=".7"/>
  <use href="#${sid}-ksil" fill="${C.steel}"/>
  <g fill="${C.cyan}" filter="url(#${sid}-glow)">
    ${poly([[1112, 575], [1206, 590], [1154, 599]], 'opacity=".95"')}
    ${poly([[1192, 557], [1222, 547], [1232, 555], [1204, 563]])}
    <g opacity=".8">${spots.join('')}</g>
  </g>
  <g stroke="${C.cyan}" stroke-width="5" stroke-linecap="round" fill="none" filter="url(#${sid}-glow)" opacity=".85">
    <path d="M1292 548 q8 26 4 50"/><path d="M1318 536 q9 28 5 54"/><path d="M1344 526 q9 28 5 56"/>
  </g>`;
}

// --- scene ---------------------------------------------------------------

function defs(id, W, H, horizon, sun) {
  return `
  <style>
    @font-face { font-family: 'Russo One'; src: url(data:font/woff2;base64,${font}) format('woff2'); }
  </style>
  <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="${horizon}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${C.skyTop}"/>
    <stop offset=".6" stop-color="${C.skyMid}"/>
    <stop offset="1" stop-color="${C.skyLow}"/>
  </linearGradient>
  <radialGradient id="${id}-haze" cx="${sun.x}" cy="${horizon}" r="${sun.r * 2.6}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ff7a45" stop-opacity=".55"/>
    <stop offset=".45" stop-color="#ff7a45" stop-opacity=".16"/>
    <stop offset="1" stop-color="#ff7a45" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="${id}-sun" x1="0" y1="${horizon - sun.r}" x2="0" y2="${horizon}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${C.sunTop}"/>
    <stop offset="1" stop-color="${C.sunLow}"/>
  </linearGradient>
  <linearGradient id="${id}-sea" x1="0" y1="${horizon}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${C.sea}" stop-opacity=".25"/>
    <stop offset=".55" stop-color="${C.sea}" stop-opacity=".8"/>
    <stop offset="1" stop-color="${C.sea}" stop-opacity=".97"/>
  </linearGradient>
  <radialGradient id="${id}-reactorHalo">
    <stop offset="0" stop-color="${C.amber}" stop-opacity=".55"/>
    <stop offset=".5" stop-color="${C.amber}" stop-opacity=".12"/>
    <stop offset="1" stop-color="${C.amber}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="${id}-reactorCore">
    <stop offset="0" stop-color="${C.amberHot}"/>
    <stop offset=".55" stop-color="#ffc56e"/>
    <stop offset="1" stop-color="#ff7a2e"/>
  </radialGradient>
  <radialGradient id="${id}-vignette" cx="${W / 2}" cy="${H * 0.55}" r="${Math.hypot(W, H) * 0.6}" gradientUnits="userSpaceOnUse">
    <stop offset=".55" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity=".6"/>
  </radialGradient>
  <filter id="${id}-glow" x="-100%" y="-100%" width="300%" height="300%">
    <feGaussianBlur stdDeviation="5" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="${id}-reflect" x="-5%" y="-5%" width="110%" height="110%">
    <feGaussianBlur stdDeviation="1.5 4"/>
  </filter>
  <clipPath id="${id}-above"><rect width="${W}" height="${horizon}"/></clipPath>
  <clipPath id="${id}-below"><rect y="${horizon}" width="${W}" height="${H - horizon}"/></clipPath>`;
}

function ripples(id, W, H, horizon, seed) {
  const r = rng(seed);
  const lines = [];
  for (let y = horizon + 3; y < H; ) {
    const depth = (y - horizon) / (H - horizon);
    const gap = 4 + depth * 16 + r() * 4;
    const thick = 1.5 + depth * 6 + r() * 2;
    lines.push(`<rect y="${y.toFixed(1)}" width="${W}" height="${thick.toFixed(1)}"/>`);
    y += gap + thick;
  }
  return `<g fill="${C.sea}" opacity=".9">${lines.join('')}</g>`;
}

function rain(W, H, n, seed) {
  const r = rng(seed);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const x = r() * (W + 200) - 100, y = r() * H, len = 26 + r() * 60;
    const o = (0.05 + r() * 0.12).toFixed(3);
    lines.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - len * 0.22).toFixed(1)}" y2="${(y + len).toFixed(1)}" stroke-opacity="${o}"/>`);
  }
  return `<g stroke="#cfe6ff" stroke-width="1.6" stroke-linecap="round">${lines.join('')}</g>`;
}

function scene({ id, W, H, horizon, sun, mech, withKaiju, rainCount, overlay = '' }) {
  const world = `
    <rect width="${W}" height="${horizon}" fill="url(#${id}-sky)"/>
    <rect width="${W}" height="${horizon}" fill="url(#${id}-haze)"/>
    <circle cx="${sun.x}" cy="${horizon}" r="${sun.r}" fill="url(#${id}-sun)"/>
    ${jaeger(id, mech.x, mech.y, mech.s)}
    ${withKaiju ? kaiju(id, horizon) : ''}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${defs(id, W, H, horizon, sun)}</defs>
  <rect width="${W}" height="${H}" fill="${C.sea}"/>
  <g id="${id}-world" clip-path="url(#${id}-above)">${world}</g>
  <g clip-path="url(#${id}-below)">
    <use href="#${id}-world" transform="matrix(1 0 0 -1 0 ${2 * horizon})" filter="url(#${id}-reflect)" opacity=".55"/>
    <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#${id}-sea)"/>
    ${ripples(id, W, H, horizon, 3)}
  </g>
  <rect y="${horizon - 1}" width="${W}" height="2" fill="#ffb07a" opacity=".35"/>
  ${rain(W, H, rainCount, 11)}
  <rect width="${W}" height="${H}" fill="url(#${id}-vignette)"/>
  ${overlay}
</svg>
`;
}

// --- outputs -------------------------------------------------------------

function title(W) {
  const size = 150, spacing = 14, tagSpacing = 16;
  return `
  <g font-family="'Russo One', sans-serif" text-anchor="middle">
    <text x="${W / 2 + spacing / 2}" y="200" font-size="${size}" letter-spacing="${spacing}" fill="${C.text}">${TITLE}</text>
    <rect x="${W / 2 - 34}" y="236" width="68" height="4" fill="${C.amber}"/>
    <text x="${W / 2 + tagSpacing / 2}" y="292" font-size="30" letter-spacing="${tagSpacing}" fill="${C.amber}">${TAGLINE}</text>
  </g>`;
}

const outputs = [
  {
    name: 'thumbnail',
    svg: scene({
      id: 't', W: 1920, H: 1080, horizon: 770,
      sun: { x: 1050, r: 310 },
      mech: { x: 580, y: 520, s: 1.2 },
      withKaiju: true, rainCount: 260,
      overlay: title(1920),
    }),
    size: [1920, 1080],
  },
  {
    name: 'icon',
    svg: scene({
      id: 'i', W: 512, H: 512, horizon: 436,
      sun: { x: 256, r: 236 },
      mech: { x: 256, y: 300, s: 0.58 },
      withKaiju: false, rainCount: 70,
    }),
    size: [512, 512],
  },
];

for (const { name, svg, size } of outputs) {
  const svgPath = join(here, `${name}.svg`);
  writeFileSync(svgPath, svg);
  execFileSync(CHROME, [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${size.join(',')}`,
    '--virtual-time-budget=2000',
    `--screenshot=${join(here, `${name}.png`)}`, `file://${svgPath}`,
  ], { stdio: 'ignore' });
  console.log(`wrote ${name}.svg + ${name}.png`);
}
