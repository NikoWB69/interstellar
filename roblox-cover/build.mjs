// Generates the Roblox thumbnail (1920x1080) and icon (512x512) as SVG,
// then renders both to PNG with headless Chromium.
//
//   node roblox-cover/build.mjs
//
// Edit TITLE below to rename the game.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TITLE = 'DRIFT PROTOCOL';

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const font = readFileSync(join(here, 'fonts/Orbitron-SemiBold.woff2')).toString('base64');

const C = {
  sky: '#16263c',
  sea: '#0b1625',
  sun: '#ff6a3d',
  ink: '#04070d',
  amber: '#ffb35c',
  cyan: '#4ff3ff',
  text: '#eef3f7',
};

// --- helpers --------------------------------------------------------------

const pts = (p) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const poly = (p, a = '') => `<polygon points="${pts(p)}" ${a}/>`;
const mirror = (p) => p.map(([x, y]) => [-x, y]).reverse();
const pair = (p, a = '') => poly(p, a) + poly(mirror(p), a);

// --- mech (origin = chest reactor) ----------------------------------------

const J = {
  head: [[-54, -100], [-60, -142], [-45, -176], [45, -176], [60, -142], [54, -100]],
  crest: [[-10, -174], [0, -198], [10, -174]],
  chest: [[-165, -108], [165, -108], [190, -70], [178, 40], [120, 140], [-120, 140], [-178, 40], [-190, -70]],
  abdomen: [[-105, 132], [105, 132], [92, 232], [-92, 232]],
  pelvis: [[-140, 225], [140, 225], [160, 300], [120, 380], [-120, 380], [-160, 300]],
  shoulder: [[-150, -108], [-200, -140], [-292, -130], [-334, -80], [-326, -8], [-250, 12], [-172, -18]],
  upperArm: [[-302, -20], [-238, -20], [-242, 132], [-298, 132]],
  forearm: [[-322, 128], [-218, 128], [-204, 238], [-224, 292], [-312, 292], [-334, 238]],
  fist: [[-314, 288], [-220, 288], [-226, 356], [-308, 356]],
};

function mech(x, y, s) {
  return `
  <g transform="translate(${x} ${y}) scale(${s})">
    <g fill="${C.ink}">
      ${poly(J.pelvis)}${poly(J.abdomen)}
      ${pair(J.upperArm)}
      ${pair(J.forearm)}${pair(J.fist)}
      ${poly(J.chest)}${pair(J.shoulder)}${poly(J.head)}${poly(J.crest)}
    </g>
    <circle r="58" fill="none" stroke="${C.amber}" stroke-opacity=".35" stroke-width="4"/>
    <circle r="40" fill="${C.amber}" filter="url(#glow)"/>
    ${poly([[-45, -150], [45, -150], [40, -137], [-40, -137]], `fill="${C.amber}" filter="url(#glow)"`)}
  </g>`;
}

// --- kaiju (absolute coords, thumbnail only) ------------------------------

function kaiju(horizon) {
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

  const spikes = [];
  for (let i = 0; i < 6; i++) {
    const t = 0.1 + i * 0.155;
    const [bx, by] = B(t);
    const [dx, dy] = dB(t);
    const len = Math.hypot(dx, dy);
    const T = [dx / len, dy / len];
    const N = [T[1], -T[0]];
    const h = 50 + 70 * Math.sin(Math.PI * Math.min(1, t * 1.15));
    const w = 36 + 18 * Math.sin(Math.PI * t);
    spikes.push(poly([
      [bx - T[0] * w / 2 - N[0] * 6, by - T[1] * w / 2 - N[1] * 6],
      [bx + N[0] * h + T[0] * h * 0.55, by + N[1] * h + T[1] * h * 0.55],
      [bx + T[0] * w / 2 - N[0] * 6, by + T[1] * w / 2 - N[1] * 6],
    ]));
  }

  return `
  <g fill="${C.ink}">${poly(body)}${spikes.join('')}</g>
  <g fill="${C.cyan}" filter="url(#glow)">
    ${poly([[1112, 575], [1206, 590], [1154, 599]])}
    ${poly([[1192, 557], [1222, 547], [1232, 555], [1204, 563]])}
  </g>`;
}

// --- scene ---------------------------------------------------------------

function scene({ W, H, horizon, sun, figures, overlay = '' }) {
  const bars = sun.bars.map(([dy, w], i) =>
    `<rect x="${sun.x - w / 2}" y="${horizon + dy}" width="${w}" height="${sun.barH}" rx="${sun.barH / 2}" opacity="${1 - i * 0.22}"/>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      @font-face { font-family: 'Orbitron'; font-weight: 600; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    </style>
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="above"><rect width="${W}" height="${horizon}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.sea}"/>
  <g clip-path="url(#above)">
    <rect width="${W}" height="${horizon}" fill="${C.sky}"/>
    <circle cx="${sun.x}" cy="${horizon}" r="${sun.r}" fill="${C.sun}"/>
    ${figures}
  </g>
  <g fill="${C.sun}">${bars}</g>
  ${overlay}
</svg>
`;
}

// --- outputs -------------------------------------------------------------

const title = (W, y, size) => `
  <text x="${W / 2 + size * 0.14}" y="${y}" text-anchor="middle" font-family="Orbitron, sans-serif" font-weight="600"
        font-size="${size}" letter-spacing="${size * 0.28}" fill="${C.text}">${TITLE}</text>`;

const outputs = [
  {
    name: 'thumbnail',
    size: [1920, 1080],
    svg: scene({
      W: 1920, H: 1080, horizon: 770,
      sun: { x: 1000, r: 290, barH: 8, bars: [[34, 420], [74, 300], [118, 180], [166, 70]] },
      figures: mech(560, 530, 1.12) + kaiju(770),
      overlay: title(1920, 190, 84),
    }),
  },
  {
    name: 'icon',
    size: [512, 512],
    svg: scene({
      W: 512, H: 512, horizon: 436,
      sun: { x: 256, r: 236, barH: 5, bars: [[22, 150], [46, 80]] },
      figures: mech(256, 300, 0.58),
    }),
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
