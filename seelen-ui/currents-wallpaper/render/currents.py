#!/usr/bin/env python3
"""Procedural, seamlessly looping "Currents"-style wallpaper renderer.

A chrome ball sits on a striped plane. Laminar stripes flow past it and break
into a turbulent wake, with a red streak running into the ball and an orange
ribbon trailing out of it. Every moving part is exactly periodic in the loop
length, so the last frame flows straight back into the first.

Usage:
  python3 currents.py still OUT.png [--w 1920 --h 1080 --t 0.0]
  python3 currents.py video OUT.mp4 [--w 1920 --h 1080 --fps 30 --seconds 24]

Needs numpy (and Pillow for stills); videos are encoded with ffmpeg.
"""
import argparse
import os
import subprocess
import sys
from multiprocessing import Pool

import numpy as np

F = np.float32

# ---------------------------------------------------------------- palette
GAP = np.array([8, 2, 14], F) / 255
LAV = np.array([172, 140, 190], F) / 255
LAV_HI = np.array([236, 214, 246], F) / 255
FAR = np.array([30, 20, 36], F) / 255
RED = np.array([245, 45, 12], F) / 255
PINK = np.array([238, 128, 170], F) / 255
ORANGE = np.array([250, 140, 30], F) / 255
POOL = np.array([228, 58, 70], F) / 255
POOL_DARK = np.array([120, 18, 34], F) / 255

# ---------------------------------------------------------------- scene
STRIPE = 0.19                 # stripe period, in ball radii
POOL_R = 0.98                 # radius of the red pool (also the flow obstacle)
CAM_H = 12.0                  # camera height (ball radius = 1)
PITCH = np.radians(36)        # camera tilt below the horizon
FOV_V = np.radians(34)
FLOW_ANG = np.radians(-38)    # flow direction on the ground plane
BALL_SCREEN = (-0.30, 0.06)   # ball centre on screen (x in units of height, y up)
LIGHT_2D = np.array([-0.62, -0.78], F)  # key light on screen, from upper left


def smoothstep(a, b, x):
    t = np.clip((x - a) / F(b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    """Blend RGB rows a -> b by t (per-row weights)."""
    return a + (b - a) * np.asarray(t, F)[..., None]


def band(dist, half, fw):
    """Anti-aliased mask for |dist| < half; fw is dist-units per pixel."""
    e = np.maximum(fw, F(1e-5))
    return smoothstep(half + e, half - e, np.abs(dist))


# ---------------------------------------------------------------- noise
_rng = np.random.default_rng(7)
_PERM = _rng.permutation(256).astype(np.int32)
_ANG = _rng.uniform(0, 2 * np.pi, 256)
_GX = np.cos(_ANG).astype(F)
_GY = np.sin(_ANG).astype(F)


def perlin(x, y, period):
    """2D gradient noise, periodic in x with an integer lattice period."""
    xi = np.floor(x)
    yi = np.floor(y)
    xf = (x - xi).astype(F)
    yf = (y - yi).astype(F)
    xi = xi.astype(np.int32)
    yi = yi.astype(np.int32)
    h0 = _PERM[np.mod(xi, period) & 255]
    h1 = _PERM[np.mod(xi + 1, period) & 255]
    y0 = yi & 255
    y1 = (yi + 1) & 255

    def g(hx, iy, dx, dy):
        h = _PERM[(hx + iy) & 255]
        return _GX[h] * dx + _GY[h] * dy

    n00 = g(h0, y0, xf, yf)
    n10 = g(h1, y0, xf - 1, yf)
    n01 = g(h0, y1, xf, yf - 1)
    n11 = g(h1, y1, xf - 1, yf - 1)
    u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    a = n00 + u * (n10 - n00)
    b = n01 + u * (n11 - n01)
    return a + v * (b - a)


def fbm(x, y, period, octaves=4, gain=0.5, yoff=0.0):
    s = 0.0
    amp = 1.0
    norm = 0.0
    f = 1
    for o in range(octaves):
        s = s + amp * perlin(x * f + 7 * o, y * f + yoff + 13.37 * o, period * f)
        norm += amp
        amp *= gain
        f *= 2
    return s / F(norm)


# ---------------------------------------------------------------- flow field
def wake_amp(u, v):
    """How strongly the flow is disturbed at (u, v); zero upstream of the ball.

    Returns (turbulence amplitude, weight of the axis wiggle, wake envelope).
    """
    up = np.maximum(u, 0)
    sig = 0.85 + 0.36 * up
    env = smoothstep(-0.4, 3.2, u) * np.exp(-0.5 * (v / sig) ** 2)
    env = env * (1 - 0.35 * smoothstep(18, 40, u))
    broad = 0.16 * smoothstep(-3.0, 14.0, u) * smoothstep(-1.0, 6.0, -np.abs(v) + 0.25 * up + 4.0)
    # calmer right along the axis so the stripes hug the ribbon
    calm = 1 - 0.72 * np.exp(-0.5 * (v / (0.35 + 0.03 * up)) ** 2)
    amp = 1.05 * env * calm + broad
    wa = smoothstep(-0.2, 2.5, u) * np.exp(-0.5 * (v / (0.9 + 0.05 * up)) ** 2)
    return amp.astype(F), wa.astype(F), env.astype(F)


def axis_disp(u, t):
    """Smooth sideways wiggle of the wake's centre line (the ribbon path)."""
    up = np.maximum(u, 0)
    a = smoothstep(0.2, 5.0, u) * (0.75 + 0.025 * np.minimum(up, 20))
    return (a * fbm(u * 0.5 - 10 * t, np.full_like(u, 3.3), 10, 3, gain=0.45) * 2.0).astype(F)


def turb_noise(u, v, t):
    """Domain-warped noise drifting downstream; exactly periodic in t (0..1)."""
    # layer A: slow warp field, drifts 3 cells (~11.5 radii) per loop
    fa, pa = 0.26, 3
    xa = u * fa - pa * t
    ya = v * fa
    qx = fbm(xa, ya, pa, 2)
    qy = fbm(xa, ya, pa, 2, yoff=31.7)
    # layer B: the eddies, drift 10 cells (20 radii) per loop
    fb, pb = 0.50, 10
    xb = u * fb - pb * t + 3.0 * qx
    yb = v * fb * 1.2 + 3.0 * qy
    return fbm(xb, yb, pb, 3, gain=0.42) * F(2.2)


def potential(u, v):
    """Stream function of laminar flow around the pool (a cylinder)."""
    r2 = np.maximum(u * u + v * v, POOL_R * POOL_R * 0.25)
    return (v * (1 - POOL_R * POOL_R / r2)).astype(F)


def disturb(u, v, amp, wa, t):
    return wa * axis_disp(u, t) + amp * turb_noise(u, v, t)


def stream(u, v, t):
    psi = potential(u, v)
    amp, wa, _ = wake_amp(u, v)
    act = (amp > 1e-3) | (wa > 1e-3)
    if np.any(act):
        psi[act] += disturb(u[act], v[act], amp[act], wa[act], t)
    return psi


# ---------------------------------------------------------------- static geometry
class Static:
    """Everything that does not change between frames, built once per process."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        aspect = w / h
        f = 1.0 / np.tan(FOV_V / 2)
        O = np.array([0.0, 0.0, CAM_H])
        cp, sp = np.cos(PITCH), np.sin(PITCH)
        fwd = np.array([0.0, cp, -sp])
        right = np.array([1.0, 0.0, 0.0])
        up = np.array([0.0, sp, cp])

        def ray(sx, sy):
            d = fwd * f + right * sx[..., None] + up * sy[..., None]
            return d / np.linalg.norm(d, axis=-1, keepdims=True)

        # ball centre: the chosen screen point cast onto the plane z = 1
        d = ray(np.array(BALL_SCREEN[0] * aspect), np.array(BALL_SCREEN[1]))
        C = O + (1.0 - CAM_H) / d[2] * d
        self.foot = C[:2]
        self.flow = np.array([np.cos(FLOW_ANG), np.sin(FLOW_ANG)])
        self.side = np.array([-self.flow[1], self.flow[0]])

        ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
        sx = ((xs + 0.5) / w * 2 - 1) * aspect
        sy = 1 - (ys + 0.5) / h * 2
        D = ray(sx, sy).reshape(-1, 3)

        # ground plane hit
        tg = -O[2] / np.minimum(D[:, 2], -1e-4)
        u, v = self.to_flow(O[0] + tg * D[:, 0], O[1] + tg * D[:, 1])
        self.psi0 = potential(u, v)
        amp, wa, env = wake_amp(u, v)
        self.act = np.flatnonzero((amp > 1e-3) | (wa > 1e-3))
        self.u_act, self.v_act = u[self.act], v[self.act]
        self.amp_act, self.wa_act = amp[self.act], wa[self.act]
        self.far = (smoothstep(16, 40, tg) * 0.85).astype(F)

        # red streak coming in from upstream
        z = np.flatnonzero((u < 0.5) & (np.abs(v) < 1.8))
        self.up_idx = z
        self.up_fade = smoothstep(0.3, -0.6, u[z]).astype(F)
        near = smoothstep(-5.5, -0.8, u[z])
        self.up_col = mix(np.broadcast_to(RED, (len(z), 3)), PINK, near * 0.85).astype(F)

        # orange ribbon trailing downstream
        z = np.flatnonzero((u > -1.5) & (np.abs(v) < 5.0))
        self.rz_idx = z
        self.rz_u = u[z].astype(F)
        self.rz_v = v[z].astype(F)
        dn = np.minimum(np.maximum(self.rz_u, 0), 12)
        self.rz_w = (STRIPE * (0.62 + 0.06 * dn)).astype(F)
        self.rz_swell_w = smoothstep(1, 5, self.rz_u).astype(F)
        self.rz_black = (STRIPE * (0.3 + 0.07 * dn) * (0.7 + 0.6 * env[z])).astype(F)
        self.rz_down = smoothstep(-0.2, 0.9, self.rz_u).astype(F)
        hue = smoothstep(1.0, 7.0, self.rz_u)
        self.rz_col = mix(np.broadcast_to(RED, (len(z), 3)), ORANGE, hue)
        self.rz_far = self.far[z]

        # red pool around the ball + contact shadow (static)
        rho = np.sqrt(u * u + v * v)
        rho2 = rho.reshape(h, w)
        gy, gx = np.gradient(rho2)
        pfw = (np.sqrt(gx * gx + gy * gy) + 1e-6).ravel()
        ao = smoothstep(POOL_R + 0.35, POOL_R, rho) * 0.55
        self.ao_idx = np.flatnonzero(ao > 0)
        self.ao = (1 - ao[self.ao_idx]).astype(F)
        pool_m = smoothstep(POOL_R + pfw, POOL_R - pfw, rho)
        z = np.flatnonzero(pool_m > 0)
        self.pool_idx = z
        self.pool_a = pool_m[z].astype(F)
        rim = smoothstep(POOL_R - 0.28, POOL_R, rho[z])
        lit = 0.5 + 0.5 * np.cos(np.arctan2(v[z], u[z]) - np.radians(150))
        pc = mix(np.broadcast_to(POOL_DARK, (len(z), 3)), POOL, 0.55 + 0.45 * lit)
        pc = mix(pc, PINK * 1.05, smoothstep(0.75, 1.0, lit) * (1 - rim) * 0.6)
        self.pool_col = mix(pc, POOL_DARK, rim * 0.55).astype(F)

        # chrome ball
        Cv = np.array([C[0], C[1], 1.0])
        tc = D @ (Cv - O)
        dperp = np.linalg.norm(O + tc[:, None] * D - Cv, axis=-1)
        pix = tc * (2.0 / h) / f
        cov = np.clip((1.0 - dperp) / pix + 0.5, 0, 1)
        z = np.flatnonzero(cov > 0)
        self.ball_idx = z
        self.ball_a = cov[z].astype(F)
        Dm = D[z]
        tm = tc[z] - np.sqrt(np.clip(1 - dperp[z] ** 2, 0, None))
        P = O + tm[:, None] * Dm
        N = P - Cv
        N /= np.linalg.norm(N, axis=-1, keepdims=True)
        R = Dm - 2 * np.sum(Dm * N, axis=-1, keepdims=True) * N
        cosv = np.clip(-np.sum(Dm * N, axis=-1), 0, 1)
        self.ball_fres = (0.62 + 0.38 * (1 - cosv) ** 3).astype(F)
        sky = R[:, 2] > 0
        self.ball_sky = sky
        self.ball_skycol = self._sky(R[sky])
        r, p = R[~sky], P[~sky]
        tr = -p[:, 2] / np.minimum(r[:, 2], -1e-4)
        self.ref_u, self.ref_v = self.to_flow(p[:, 0] + tr * r[:, 0], p[:, 1] + tr * r[:, 1])
        # fade reflected stripes where they get finer than a couple of pixels
        gidx = z[~sky]
        rows, cols = gidx // w, gidx % w
        r0, c0 = rows.min(), cols.min()
        box = np.full((rows.max() - r0 + 1, cols.max() - c0 + 1), np.nan)
        box[rows - r0, cols - c0] = self.ref_v
        by, bx = np.gradient(box)
        cyc = np.nan_to_num(np.hypot(bx, by), nan=1.0)[rows - r0, cols - c0] / STRIPE
        blur = 0.55 + 0.45 * smoothstep(0.5, 4, tr)
        self.ref_blur = np.maximum(blur, smoothstep(0.12, 0.35, cyc)).astype(F)

        # vignette, darker towards the far top edge
        vx = (xs / w - 0.5) * 2
        vy = (ys / h - 0.5) * 2
        vig = 1 - 0.28 * np.clip(vx * vx * 0.6 + vy * vy * 0.5, 0, 1) ** 1.4
        top = 1 - 0.45 * smoothstep(0.15, -1.0, -vy) ** 1.6
        self.grade = (vig * top).astype(F).ravel()

    def to_flow(self, X, Y):
        dx = X - self.foot[0]
        dy = Y - self.foot[1]
        u = dx * self.flow[0] + dy * self.flow[1]
        v = dx * self.side[0] + dy * self.side[1]
        return u.astype(F), v.astype(F)

    @staticmethod
    def _sky(r):
        """Dark studio dome with a big soft key light and a smaller fill."""
        base = mix(np.broadcast_to(np.array([0.36, 0.32, 0.38]), r.shape),
                   np.array([0.07, 0.05, 0.08]), np.clip(r[:, 2] * 1.6, 0, 1))
        L1 = np.array([-0.62, -0.62, 0.48])
        L1 /= np.linalg.norm(L1)
        L2 = np.array([-0.05, -0.80, 0.60])
        L2 /= np.linalg.norm(L2)
        s1 = np.clip(r @ L1, 0, 1)
        s2 = np.clip(r @ L2, 0, 1)
        lightc = np.clip(smoothstep(0.86, 0.965, s1) * 1.7 + smoothstep(0.955, 0.985, s2) * 0.9, 0, 1.7)
        glow = s1 ** 8 * 0.45 + s2 ** 10 * 0.2
        return (base + (lightc + glow)[:, None] * np.array([1.0, 0.98, 1.0])).astype(F)


# ---------------------------------------------------------------- per-frame shading
def shade_stripes(psi, gdot, fw, far):
    """Raised, glossy lavender tubes along the contour lines of psi."""
    x = psi / F(STRIPE)
    ph = x - np.floor(x)                        # 0..1 across one stripe
    n = (ph - 0.5) / F(0.34)                    # -1..1 across a tube
    nz = np.sqrt(np.clip(1 - n * n, 0, 1))
    cyc = fw / F(STRIPE)                        # stripe cycles per pixel
    edge = np.clip(cyc * 1.6, 0.02, 0.5)
    cov = smoothstep(0.34 + edge, 0.34 - edge, np.abs(ph - 0.5))
    ng = n * gdot
    lam = np.clip(0.35 + 0.55 * nz + 0.55 * ng, 0, 1)
    spec = np.clip(nz * 0.6 + ng * 0.8, 0, 1) ** 6
    blur = smoothstep(0.18, 0.42, cyc)          # finer than ~2.5px: fade to average
    avg = GAP + (LAV * 0.62 - GAP) * 0.62
    out = np.empty(psi.shape + (3,), F)
    for c in range(3):
        tube = LAV[c] * (0.55 + 0.45 * lam) + (LAV_HI[c] - LAV[c]) * 0.9 * spec
        col = GAP[c] + (tube - GAP[c]) * cov
        col += (avg[c] - col) * blur
        col += (FAR[c] - col) * far
        out[:, c] = col
    return out


def render(st, t):
    h, w = st.h, st.w
    psi = st.psi0.copy()
    psi[st.act] += disturb(st.u_act, st.v_act, st.amp_act, st.wa_act, t)

    gy, gx = np.gradient(psi.reshape(h, w))
    gmag = (np.sqrt(gx * gx + gy * gy) + 1e-9).ravel()
    gdot = ((gx * LIGHT_2D[0] + gy * LIGHT_2D[1]).ravel() / gmag).astype(F)
    col = shade_stripes(psi, gdot, gmag, st.far)

    # red streak
    z = st.up_idx
    p, fw = psi[z], gmag[z]
    up_w = F(STRIPE * 0.72)
    gap_m = band(p, up_w + STRIPE * 0.22, fw) * st.up_fade
    red_m = band(p, up_w, fw) * st.up_fade
    rn = np.clip(p / up_w, -1, 1)
    rsh = 0.82 + 0.25 * np.sqrt(np.clip(1 - rn * rn, 0, 1)) + 0.15 * rn * gdot[z]
    sub = mix(col[z], GAP, gap_m * 0.9)
    col[z] = mix(sub, st.up_col * rsh[:, None], red_m)

    # orange ribbon: rides the wiggling centre line of the wake
    z = st.rz_idx
    zero = np.zeros_like(st.rz_u)
    pr_z = st.rz_v + axis_disp(st.rz_u, t)
    swell = fbm(st.rz_u * 0.55 - 11 * t, zero + 5.5, 11, 2)
    pr = np.full(h * w, 100.0, F)
    pr[z] = pr_z
    ry, rx = np.gradient(pr.reshape(h, w))
    rfw = np.clip(np.sqrt(rx * rx + ry * ry).ravel()[z], 1e-5, 0.5)
    rib_w = st.rz_w * (1 + 0.9 * swell * st.rz_swell_w)
    blk = band(pr_z, rib_w + st.rz_black, rfw) * st.rz_down
    rib = band(pr_z, rib_w, rfw) * st.rz_down
    rn = np.clip(pr_z / np.maximum(rib_w, 1e-4), -1, 1)
    rsh = 0.86 + 0.18 * np.sqrt(np.clip(1 - rn * rn, 0, 1)) - 0.1 * rn
    rc = mix(st.rz_col * rsh[:, None], FAR, st.rz_far)
    sub = mix(col[z], GAP * 0.4, blk)
    col[z] = mix(sub, rc, rib)

    # pool and its soft shadow
    col[st.ao_idx] *= st.ao[:, None]
    z = st.pool_idx
    col[z] = mix(col[z], st.pool_col, st.pool_a)

    # chrome ball: sky reflection is static, the floor reflection moves
    ref = np.empty((len(st.ball_idx), 3), F)
    ref[st.ball_sky] = st.ball_skycol
    rpsi = stream(st.ref_u, st.ref_v, t)
    x = rpsi / F(STRIPE)
    stripes = 0.5 + 0.5 * np.cos(2 * np.pi * (x - np.floor(x)))
    sv = stripes * (1 - st.ref_blur) + 0.5 * st.ref_blur
    g = mix(np.broadcast_to(GAP, (len(sv), 3)), LAV * 1.05, sv)
    rho = np.sqrt(st.ref_u ** 2 + st.ref_v ** 2)
    g = mix(g, POOL * 0.95, smoothstep(POOL_R + 0.15, POOL_R - 0.15, rho))
    redm = smoothstep(STRIPE * 0.9, STRIPE * 0.5, np.abs(rpsi)) * smoothstep(0.3, -0.6, st.ref_u)
    ref[~st.ball_sky] = mix(g, RED, redm * (1 - st.ref_blur) * 0.9)
    ball = ref * st.ball_fres[:, None] * np.array([0.92, 0.9, 0.95], F) + 0.025
    z = st.ball_idx
    col[z] = mix(col[z], ball, st.ball_a)

    col *= st.grade[:, None]
    return (np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8).reshape(h, w, 3)


# ---------------------------------------------------------------- cli
_ST = None


def _init(w, h):
    global _ST
    _ST = Static(w, h)


def _frame(t):
    return render(_ST, t).tobytes()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["still", "video"])
    ap.add_argument("out")
    ap.add_argument("--w", type=int, default=1920)
    ap.add_argument("--h", type=int, default=1080)
    ap.add_argument("--t", type=float, default=0.0, help="loop phase for stills, 0..1")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--seconds", type=float, default=24.0)
    ap.add_argument("--crf", type=int, default=18)
    ap.add_argument("--jobs", type=int, default=os.cpu_count())
    a = ap.parse_args()

    if a.mode == "still":
        from PIL import Image
        Image.fromarray(render(Static(a.w, a.h), a.t)).save(a.out)
        return

    n = int(round(a.fps * a.seconds))
    ff = subprocess.Popen([
        "ffmpeg", "-y", "-v", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{a.w}x{a.h}", "-r", str(a.fps), "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf), "-tune", "film",
        "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", a.out,
    ], stdin=subprocess.PIPE)
    with Pool(a.jobs, initializer=_init, initargs=(a.w, a.h)) as pool:
        for i, buf in enumerate(pool.imap(_frame, [i / n for i in range(n)])):
            ff.stdin.write(buf)
            if i % 60 == 0:
                print(f"frame {i}/{n}", file=sys.stderr, flush=True)
    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit("ffmpeg failed")


if __name__ == "__main__":
    main()
