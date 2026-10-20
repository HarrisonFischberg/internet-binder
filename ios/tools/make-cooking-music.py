#!/usr/bin/env python3
"""Composes and renders the cooking music: ios/App/Music/cooking-*.m4a.

Ten short original instrumentals (cute, fun, quiet, relaxing) that play while someone follows a recipe in
Cooking mode. Every note is written here and every sound is synthesized here (no samples, no downloads), so
the tracks are ours to ship. The output is deterministic: the same script makes the same files.

Needs numpy and ffmpeg (AAC encoder). Run: python3 ios/tools/make-cooking-music.py [--wav DIR] [--only N]
"""
import argparse, os, subprocess, sys, tempfile, wave
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'App', 'Music')
BITRATE = '48k'   # mono AAC-LC: about 6 KB a second, small enough to bundle ten tracks

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def midi(name):
    """'C4' -> 60, 'Bb3' -> 58, 'F#5' -> 78."""
    n = NOTE[name[0]]; i = 1
    while i < len(name) and name[i] in '#b':
        n += 1 if name[i] == '#' else -1; i += 1
    return n + 12 * (int(name[i:]) + 1)
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

QUAL = {'maj7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10], '7': [0, 4, 7, 10], 'maj': [0, 4, 7], 'm': [0, 3, 7],
        'add9': [0, 4, 7, 14], 'm9': [0, 3, 7, 10, 14], 'maj9': [0, 4, 7, 11, 14], '6': [0, 4, 7, 9], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7]}
def chord(sym):
    """'Fmaj7' -> (root pitch class, intervals)."""
    root = sym[0] + (sym[1] if len(sym) > 1 and sym[1] in '#b' else '')
    q = sym[len(root):] or 'maj'
    return midi(root + '0') - 12, QUAL[q]

SCALES = {'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10], 'dorian': [0, 2, 3, 5, 7, 9, 10],
          'penta': [0, 2, 4, 7, 9], 'lydian': [0, 2, 4, 6, 7, 9, 11], 'mixo': [0, 2, 4, 5, 7, 9, 10]}

# ---------------------------------------------------------------- envelopes and helpers

def t_axis(dur): return np.arange(int(dur * SR)) / SR

def adsr(n, a=0.005, d=0.1, s=0.7, r=0.1, hold=None):
    """Attack-decay-sustain over `hold` seconds, then release (n samples total)."""
    hold = n / SR - r if hold is None else hold
    t = np.arange(n) / SR
    env = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = t > hold
    env[rel] *= np.exp(-(t[rel] - hold) / max(r / 4, 1e-4))
    return env

def fade_edges(x, ms=4):
    k = min(len(x) // 2, int(SR * ms / 1000))
    if k > 0:
        x[:k] *= np.linspace(0, 1, k); x[-k:] *= np.linspace(1, 0, k)
    return x

def lowpass(x, cutoff):
    """Gentle FFT low-pass (a soft roll-off rather than a brick wall)."""
    n = len(x); X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR)
    X *= 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, n)

def highpass(x, cutoff):
    n = len(x); X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR)
    X *= 1 / np.sqrt(1 + (cutoff / np.maximum(f, 1)) ** 4)
    return np.fft.irfft(X, n)

# ---------------------------------------------------------------- instruments: f(freq, dur, vel, rng) -> samples

def e_piano(f, dur, vel, rng):
    """A Rhodes-ish tine: FM with a decaying index, a soft bell partial and slow tremolo."""
    tail = 1.2; t = t_axis(dur + tail)
    idx = 1.6 * vel * np.exp(-t * 3.5) + 0.25
    mod = np.sin(2 * np.pi * f * t) * idx
    body = np.sin(2 * np.pi * f * t + mod)
    tine = 0.18 * vel * np.sin(2 * np.pi * f * 7.0 * t) * np.exp(-t * 18)
    env = adsr(len(t), a=0.003, d=1.1, s=0.25, r=0.5, hold=dur)
    trem = 1 + 0.06 * np.sin(2 * np.pi * 4.2 * t)
    return fade_edges((body + tine) * env * trem * vel)

def music_box(f, dur, vel, rng):
    """Comb-like tines: a bright strike that rings out regardless of note length."""
    t = t_axis(2.4)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 1.6)
         + 0.35 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t * 4.5)
         + 0.12 * np.sin(2 * np.pi * f * 5.93 * t) * np.exp(-t * 9))
    x[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return fade_edges(x * vel * 0.8)

def celesta(f, dur, vel, rng):
    t = t_axis(min(dur, 1.0) + 1.4)
    x = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 7)) * np.exp(-t * 2.2)
    x[:int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
    return fade_edges(x * vel * 0.8)

def marimba(f, dur, vel, rng):
    t = t_axis(1.0)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 5)
         + 0.3 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t * 22)
         + 0.08 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 60))
    x[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return fade_edges(x * vel)

def kalimba(f, dur, vel, rng):
    t = t_axis(1.8)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 2.4)
         + 0.22 * np.sin(2 * np.pi * f * 5.95 * t) * np.exp(-t * 26)
         + 0.05 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 6))
    x[:int(0.0015 * SR)] *= np.linspace(0, 1, int(0.0015 * SR))
    return fade_edges(x * vel)

def pluck(f, dur, vel, rng, bright=0.5):
    """Karplus-Strong string, computed one period at a time (a nylon-ish guitar)."""
    total = int((dur + 0.8) * SR); p = max(2, int(round(SR / f)))
    burst = rng.uniform(-1, 1, p)
    burst = np.convolve(burst, np.hanning(max(3, int(p * (0.3 - 0.25 * bright)))), mode='same')   # a soft fingertip, not a pick
    burst /= np.max(np.abs(burst)) + 1e-9
    y = np.zeros(total + 1); y[1:p + 1] = burst   # y[0] is a silent sample before the burst
    decay = 0.996
    i = p + 1
    while i <= total:
        k = min(p, total + 1 - i)
        y[i:i + k] = decay * 0.5 * (y[i - p:i - p + k] + y[i - p - 1:i - p - 1 + k])
        i += k
    y = y[1:]
    env = np.ones(total); rel = int(dur * SR)
    env[rel:] = np.exp(-np.arange(total - rel) / (0.12 * SR))
    return fade_edges(y * env * vel * 0.9)

def guitar(f, dur, vel, rng): return pluck(f, dur, vel, rng, bright=0.35)

def piano(f, dur, vel, rng):
    """Additive soft piano: slightly stretched partials, higher ones fading first, a felt hammer."""
    tail = 1.5; t = t_axis(dur + tail); x = np.zeros_like(t)
    B = 0.0004
    for k in range(1, 9):
        fk = f * k * np.sqrt(1 + B * k * k)
        if fk > 9000: break
        amp = (0.9 ** k) / k ** (1.2 - 0.4 * vel)
        x += amp * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) * np.exp(-t * (0.9 + 0.55 * k) * (1 + f / 900))
    env = adsr(len(t), a=0.004, d=2.0, s=1.0, r=0.35, hold=dur)
    return fade_edges(x * env * vel * 0.7)

def pad(f, dur, vel, rng):
    """Warm string-machine pad: detuned additive voices, slow attack and release."""
    rel = 1.6; t = t_axis(dur + rel); x = np.zeros_like(t)
    for det in (-0.12, 0.0, 0.11):
        fd = f * 2 ** (det / 12); ph = rng.uniform(0, 6.28)
        for k in range(1, 7):
            x += (1 / k ** 1.7) * np.sin(2 * np.pi * fd * k * t + ph * k)
    env = np.minimum(1, t / 0.9)
    tail = t > dur
    env[tail] *= np.exp(-(t[tail] - dur) / (rel / 3.5))
    lfo = 1 + 0.08 * np.sin(2 * np.pi * 0.23 * t + rng.uniform(0, 6))
    return fade_edges(x * env * lfo * vel * 0.22, 30)

def bass(f, dur, vel, rng):
    t = t_axis(dur + 0.25)
    x = np.sin(2 * np.pi * f * t) + 0.28 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 4) + 0.08 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 8)
    env = adsr(len(t), a=0.008, d=0.6, s=0.55, r=0.18, hold=dur)
    return fade_edges(x * env * vel)

def flute(f, dur, vel, rng):
    """Breathy sine flute with delayed vibrato."""
    t = t_axis(dur + 0.25)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.0 * t) * np.minimum(1, t / 0.4)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    x = np.sin(ph) + 0.12 * np.sin(2 * ph)
    breath = lowpass(rng.normal(0, 1, len(t)), 2500) * 0.06
    env = adsr(len(t), a=0.06, d=0.3, s=0.85, r=0.2, hold=dur)
    return fade_edges((x + breath) * env * vel * 0.6)

INSTR = dict(e_piano=e_piano, music_box=music_box, celesta=celesta, marimba=marimba, kalimba=kalimba,
             guitar=guitar, pluck=pluck, piano=piano, pad=pad, bass=bass, flute=flute)

# ---------------------------------------------------------------- drums

def kick(vel, rng):
    t = t_axis(0.35)
    f = 48 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) * vel

def brush(vel, rng):
    t = t_axis(0.22)
    n = lowpass(rng.normal(0, 1, len(t)), 5000)
    return highpass(n, 600) * np.exp(-t * 18) * vel * 0.35

def snare(vel, rng):
    t = t_axis(0.2)
    n = highpass(lowpass(rng.normal(0, 1, len(t)), 6000), 900) * np.exp(-t * 26)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 35)
    return (n * 0.45 + body * 0.35) * vel

def shaker(vel, rng):
    t = t_axis(0.07)
    n = highpass(rng.normal(0, 1, len(t)), 5000)
    env = np.minimum(1, t / 0.012) * np.exp(-t * 55)
    return n * env * vel * 0.3

def rim(vel, rng):
    t = t_axis(0.06)
    return (np.sin(2 * np.pi * 1750 * t) * 0.5 + highpass(rng.normal(0, 1, len(t)), 2000) * 0.25) * np.exp(-t * 90) * vel

def clap(vel, rng):
    t = t_axis(0.25); x = np.zeros_like(t)
    n = highpass(lowpass(rng.normal(0, 1, len(t)), 4000), 800)
    for off in (0, 0.011, 0.022):
        s = int(off * SR); e = np.exp(-(t[:len(t) - s]) * (70 if off < 0.02 else 22))
        x[s:] += n[s:] * e
    return x * vel * 0.25

def tick(vel, rng):
    t = t_axis(0.03)
    return np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 200) * vel * 0.4

DRUM = dict(kick=kick, brush=brush, snare=snare, shaker=shaker, rim=rim, clap=clap, tick=tick)

# ---------------------------------------------------------------- the score

class Track:
    def __init__(s, spec):
        s.spec = spec; s.bpm = spec['bpm']; s.beats = spec.get('meter', 4)
        s.beat = 60 / s.bpm; s.bar = s.beat * s.beats
        s.swing = spec.get('swing', 0.0)
        s.rng = np.random.default_rng(spec['seed'])
        s.prog = spec['form']   # list of chord symbols, one per bar
        s.length = len(s.prog) * s.bar + 3.0
        s.parts = {}

    def at(s, bar, beat):
        """Seconds for a beat position, with swing on the off-eighths and a hair of human timing."""
        frac = beat % 1.0
        if s.swing and abs(frac - 0.5) < 1e-6: beat += s.swing / 2
        return bar * s.bar + beat * s.beat + s.rng.normal(0, 0.004)

    def note(s, part, inst, t, m, dur, vel):
        s.parts.setdefault(part, []).append((inst, max(0, t), hz(m), dur, vel))

    def hit(s, part, drum, t, vel):
        s.parts.setdefault(part, []).append((drum, max(0, t), None, 0, vel))

def voicing(sym, center=60, n=4):
    """Close voicing of a chord around `center`, keeping the top notes near the middle."""
    root, iv = chord(sym)
    notes = []
    for i in iv[:n]:
        m = root + i
        while m < center - 6: m += 12
        while m > center + 7: m -= 12
        notes.append(m)
    return sorted(set(notes))

def scale_notes(key, scale, lo, hi):
    pc = [(midi(key + '0') - 12 + i) % 12 for i in SCALES[scale]]
    return [m for m in range(lo, hi + 1) if m % 12 in pc]

def melody(tr, inst, part, key, scale, lo, hi, rhythms, vel=0.6, every=2, rest_bars=(), octave=0, legato=0.9):
    """A melody built from short motifs: the rhythm repeats each phrase while the pitches follow the chords,
    strong beats land on chord tones and the rest move by step. Phrases end on a held chord tone."""
    rng = tr.rng; pool = scale_notes(key, scale, lo, hi)
    prev = pool[len(pool) // 2]
    nbars = len(tr.prog)
    contour = None
    for b0 in range(0, nbars, every):
        rhythm = rhythms[(b0 // every) % len(rhythms)]
        if (b0 // every) % 2 == 0 or contour is None or len(contour) != len(rhythm):
            contour = [int(rng.choice([-2, -1, -1, 1, 1, 2, 0])) for _ in rhythm]
        for j, (beat, dur) in enumerate(rhythm):
            b = b0 + int(beat // tr.beats); bb = beat % tr.beats
            if b >= nbars or b in rest_bars: continue
            root, iv = chord(tr.prog[b]); tones = {(root + i) % 12 for i in iv}
            strong = bb % 2 == 0 or dur >= 1.5
            idx = pool.index(min(pool, key=lambda m: abs(m - prev)))
            idx = max(0, min(len(pool) - 1, idx + contour[j]))
            m = pool[idx]
            if strong:
                cands = [x for x in pool if x % 12 in tones]
                m = min(cands, key=lambda x: abs(x - m) + (0.5 if x == prev else 0))
            v = vel * (1.0 if strong else 0.8) * rng.uniform(0.9, 1.05)
            tr.note(part, inst, tr.at(b, bb), m + octave, dur * tr.beat * legato, v)
            prev = m

def comp(tr, inst, part, pattern, center=60, vel=0.4, n=4, roll=0.0, bars=None):
    """Chords on the given beats: pattern = [(beat, length in beats), ...]."""
    for b, sym in enumerate(tr.prog):
        if bars and b not in bars: continue
        vs = voicing(sym, center, n)
        for beat, d in pattern:
            for k, m in enumerate(vs):
                tr.note(part, inst, tr.at(b, beat) + k * roll, m, d * tr.beat, vel * tr.rng.uniform(0.85, 1.0))

def arp(tr, inst, part, pattern, center=64, step=0.5, vel=0.4, length=None, bars=None):
    """Broken chords: pattern indexes into the voicing (an index past the top climbs an octave)."""
    for b, sym in enumerate(tr.prog):
        if bars and b not in bars: continue
        vs = voicing(sym, center, 4)
        for k, ix in enumerate(pattern):
            if ix is None: continue
            m = vs[ix % len(vs)] + 12 * (ix // len(vs))
            tr.note(part, inst, tr.at(b, k * step), m, (length or step * 1.6) * tr.beat, vel * tr.rng.uniform(0.8, 1.0))

def bassline(tr, pattern, octave=36, vel=0.55, inst='bass', bars=None):
    """pattern = [(beat, length, interval above the root)]; the interval 'oct' climbs an octave."""
    for b, sym in enumerate(tr.prog):
        if bars and b not in bars: continue
        root, iv = chord(sym)
        r = root
        while r < octave: r += 12
        while r >= octave + 12: r -= 12
        for beat, d, i in pattern:
            tr.note('bass', inst, tr.at(b, beat), r + (12 if i == 'oct' else i), d * tr.beat, vel * tr.rng.uniform(0.9, 1.0))

def drums(tr, pattern, bars=None, vel=1.0):
    """pattern = {drum: [(beat, velocity), ...]}, repeated each bar."""
    for b in range(len(tr.prog)):
        if bars and b not in bars: continue
        for d, hits in pattern.items():
            for beat, v in hits:
                tr.hit('drums', d, tr.at(b, beat), v * vel * tr.rng.uniform(0.8, 1.0))

def eighths(v): return [(i * 0.5, v * (1 if i % 2 == 0 else 0.6)) for i in range(8)]

# ---------------------------------------------------------------- the ten tracks

def butter_and_toast(tr):
    """Lo-fi hip hop: dusty Rhodes, lazy swing, a soft kick and brush."""
    comp(tr, 'e_piano', 'keys', [(0, 1.5), (1.75, 0.5), (2.5, 1.4)], center=60, vel=0.42, n=4, roll=0.012)
    bassline(tr, [(0, 1.5, 0), (2.5, 0.5, 7), (3, 1, 0)], vel=0.5)
    drums(tr, {'kick': [(0, .8), (2.5, .55)], 'brush': [(1, .7), (3, .7)], 'shaker': eighths(.5)}, bars=range(2, 30))
    melody(tr, 'music_box', 'lead', 'F', 'major', 69, 84, [[(0, 1), (1, .5), (1.5, 1.5), (4, .5), (4.5, .5), (5, 2)],
                                                          [(0.5, .5), (1, 1), (2, .5), (2.5, 2.5), (6, 1)]],
           vel=0.32, rest_bars=(0, 1, 30, 31))

def simmer(tr):
    """Ambient: slow pads breathing under a scattered music box, no drums."""
    for b, sym in enumerate(tr.prog):
        if b % 2 == 0:
            for m in voicing(sym, 57, 4): tr.note('pad', 'pad', b * tr.bar, m, tr.bar * 2, 0.5)
            r, _ = chord(sym); tr.note('bass', 'pad', b * tr.bar, r + 36 if r + 36 >= 36 else r + 48, tr.bar * 2, 0.5)
    melody(tr, 'music_box', 'lead', 'D', 'major', 66, 86, [[(0, 2), (2.5, 1.5), (5, 3)], [(1, 1), (2, 1), (3, 5)]],
           vel=0.3, rest_bars=(0, 1), legato=1.0)
    arp(tr, 'celesta', 'arp', [0, None, 2, None, 3, None, 1, None], center=74, step=0.5, vel=0.12, bars=range(8, 24))

def little_whisk(tr):
    """Bouncy marimba with a shaker and a skipping bass, bright and cute."""
    arp(tr, 'marimba', 'arp', [0, 2, 1, 3, 2, 4, 3, 2], center=62, step=0.5, vel=0.38)
    bassline(tr, [(0, .5, 0), (1, .5, 7), (2, .5, 'oct'), (3, .5, 7)], vel=0.5)
    drums(tr, {'shaker': eighths(.6), 'kick': [(0, .55), (2, .45)], 'clap': [(1, .4), (3, .4)]}, bars=range(4, 32))
    melody(tr, 'kalimba', 'lead', 'C', 'major', 67, 84, [[(0, .5), (.5, .5), (1, 1), (2, .5), (3, 1), (4, .5), (4.5, .5), (5, .5), (6, 2)],
                                                        [(0, 1), (1.5, .5), (2, .5), (2.5, 1.5), (4, 1), (5, .5), (5.5, 2.5)]],
           vel=0.42, rest_bars=(0, 1, 2, 3))

def lemon_zest(tr):
    """Bossa nova: nylon guitar comping, rim clicks and a flute line."""
    comp(tr, 'guitar', 'gtr', [(0, .5), (1.5, .5), (2.5, .5), (3.5, .5)], center=57, vel=0.33, n=4, roll=0.018)
    bassline(tr, [(0, 1.5, 0), (1.5, .5, 7), (2, 1.5, 7), (3.5, .5, 0)], vel=0.5)
    drums(tr, {'rim': [(0, .5), (1.5, .5), (3, .5)], 'shaker': [(i * 0.5, .45) for i in range(8)], 'kick': [(0, .4), (1.5, .3), (2, .4), (3.5, .3)]})
    melody(tr, 'flute', 'lead', 'G', 'major', 67, 83, [[(0, 1.5), (1.5, .5), (2, 2), (4.5, .5), (5, .5), (5.5, 2.5)],
                                                      [(.5, .5), (1, .5), (1.5, 2.5), (4, 1), (5, 3)]],
           vel=0.3, rest_bars=(0, 1, 46, 47))

def sunday_dough(tr):
    """A slow waltz: oom-pah piano, a sustained pad and a celesta tune."""
    bassline(tr, [(0, 1, 0)], vel=0.42, inst='piano')
    comp(tr, 'piano', 'keys', [(1, .9), (2, .9)], center=60, vel=0.24, n=3)
    for b, sym in enumerate(tr.prog):
        if b % 4 == 0 and 8 <= b < 56:
            for m in voicing(sym, 64, 3): tr.note('pad', 'pad', b * tr.bar, m, tr.bar * 4, 0.25)
    melody(tr, 'celesta', 'lead', 'Bb', 'major', 65, 84, [[(0, 2), (2, 1), (3, 1.5), (4.5, 1.5)], [(0, 1), (1, 1), (2, 1), (3, 3)]],
           vel=0.38, rest_bars=(0, 1))

def tea_kettle(tr):
    """Quiet fingerpicked guitar in A minor, a little rain of ticks."""
    arp(tr, 'guitar', 'gtr', [0, 2, 1, 3, 2, 1, 3, 2], center=57, step=0.5, vel=0.36, length=1.6)
    bassline(tr, [(0, 2, 0), (2, 2, 7)], vel=0.42, inst='guitar', octave=40)
    melody(tr, 'piano', 'lead', 'A', 'minor', 64, 81, [[(0, 1), (1, 1), (2, 2), (4, 1.5), (5.5, .5), (6, 2)], [(0, 3), (3, 1), (4, 4)]],
           vel=0.3, rest_bars=(0, 1, 2, 3, 30, 31))
    drums(tr, {'tick': [(1, .3), (3, .3)]}, bars=range(8, 28))

def pantry_parade(tr):
    """A little march for the cupboard: kalimba, plucky bass, claps and a whistle-ish lead."""
    comp(tr, 'marimba', 'keys', [(0.5, .5), (1.5, .5), (2.5, .5), (3.5, .5)], center=62, vel=0.26, n=3)
    bassline(tr, [(0, .5, 0), (1, .5, 'oct'), (2, .5, 7), (3, .5, 'oct')], vel=0.52)
    drums(tr, {'kick': [(0, .6), (2, .5)], 'clap': [(1, .45), (3, .45)], 'shaker': eighths(.45)}, bars=range(2, 32))
    melody(tr, 'kalimba', 'lead', 'F', 'major', 65, 84, [[(0, .5), (.5, .5), (1, .5), (1.5, .5), (2, 1), (3, 1), (4, .5), (4.5, .5), (5, 1), (6, 2)],
                                                        [(0, 1), (1, .5), (1.5, .5), (2, 1), (3, .5), (3.5, .5), (4, 2), (6, 1), (7, 1)]],
           vel=0.44, rest_bars=(0, 1))
    melody(tr, 'flute', 'lead2', 'F', 'major', 72, 89, [[(0, 2), (2, 2), (4, 4)]], vel=0.18, rest_bars=tuple(range(0, 16)) + (30, 31))

def cinnamon_steam(tr):
    """Lo-fi in E flat: smoky Rhodes chords, a round bass, crackle and swing."""
    comp(tr, 'e_piano', 'keys', [(0, 2.5), (2.75, 1.0)], center=62, vel=0.38, n=5, roll=0.02)
    bassline(tr, [(0, 2, 0), (2.75, .75, 0), (3.5, .5, 7)], vel=0.5)
    drums(tr, {'kick': [(0, .7), (1.75, .4), (2.5, .5)], 'snare': [(1, .45), (3, .45)], 'shaker': eighths(.35)}, bars=range(4, 30))
    melody(tr, 'e_piano', 'lead', 'Eb', 'major', 67, 82, [[(0, .5), (.5, 1), (1.5, .5), (2, 2), (5, 1), (6, 2)], [(1, .5), (1.5, .5), (2, 2), (4.5, 3.5)]],
           vel=0.36, rest_bars=(0, 1, 2, 3, 30, 31))
    tr.crackle = 0.012

def herb_garden(tr):
    """Pentatonic kalimba patterns over a soft pad, like a sunny windowsill."""
    arp(tr, 'kalimba', 'arp', [0, 1, 2, 3, 2, 1, 4, 2], center=67, step=0.5, vel=0.3)
    for b, sym in enumerate(tr.prog):
        if b % 2 == 0:
            for m in voicing(sym, 55, 3): tr.note('pad', 'pad', b * tr.bar, m, tr.bar * 2, 0.32)
    bassline(tr, [(0, 3, 0), (3, 1, 7)], vel=0.4)
    drums(tr, {'shaker': [(1, .35), (3, .35), (3.5, .2)], 'kick': [(0, .35)]}, bars=range(8, 30))
    melody(tr, 'flute', 'lead', 'G', 'penta', 67, 84, [[(0, 1.5), (1.5, .5), (2, 2), (4, 1), (5, 3)], [(0, .5), (.5, .5), (1, 3), (4, 4)]],
           vel=0.26, rest_bars=tuple(range(0, 8)))

def slow_stir(tr):
    """Very quiet solo piano at 60 bpm: low open fifths, a few high notes, lots of room."""
    for b, sym in enumerate(tr.prog):
        root, iv = chord(sym); r = root
        while r < 40: r += 12
        tr.note('keys', 'piano', tr.at(b, 0), r, tr.bar, 0.42)
        tr.note('keys', 'piano', tr.at(b, 0.5), r + 7, tr.bar * 0.9, 0.3)
        for k, m in enumerate(voicing(sym, 62, 3)): tr.note('keys', 'piano', tr.at(b, 1.5) + k * 0.04, m, 2.2 * tr.beat, 0.22)
    melody(tr, 'piano', 'lead', 'E', 'major', 68, 86, [[(0, 2), (2, 1), (3, 5)], [(0, 1), (1, 1), (2, 2), (4, 4)]],
           vel=0.32, rest_bars=(0, 1), legato=1.0)

TRACKS = [  # file name, title, composer, spec
 ('cooking-01-butter-and-toast', 'Butter & Toast', butter_and_toast,
  dict(bpm=78, swing=0.32, seed=11, form=['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'] * 4 + ['Bbmaj7', 'Am7', 'Gm7', 'C7'] * 2 + ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'] * 2,
       mix=dict(keys=.9, bass=.9, drums=.7, lead=.8), reverb=.22)),
 ('cooking-02-simmer', 'Simmer', simmer,
  dict(bpm=64, seed=22, form=['Dmaj9', 'Dmaj9', 'Bm7', 'Bm7', 'Gmaj7', 'Gmaj7', 'Asus4', 'A'] * 3,
       mix=dict(pad=.9, bass=.6, lead=.9, arp=.7), reverb=.38)),
 ('cooking-03-little-whisk', 'Little Whisk', little_whisk,
  dict(bpm=104, seed=33, form=['C', 'Am', 'F', 'G'] * 6 + ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'],
       mix=dict(arp=.8, bass=.8, drums=.6, lead=.9), reverb=.18)),
 ('cooking-04-lemon-zest', 'Lemon Zest', lemon_zest,
  dict(bpm=124, seed=44, form=['Gmaj7', 'Gmaj7', 'Am7', 'D7', 'Bm7', 'E7', 'Am7', 'D7'] * 6,
       mix=dict(gtr=.9, bass=.8, drums=.5, lead=.85), reverb=.2)),
 ('cooking-05-sunday-dough', 'Sunday Dough', sunday_dough,
  dict(bpm=132, meter=3, seed=55, form=['Bb', 'Bb', 'Gm', 'Gm', 'Eb', 'F', 'Bb', 'F'] * 8,
       mix=dict(bass=.8, keys=.8, pad=.6, lead=.9), reverb=.3)),
 ('cooking-06-tea-kettle', 'Tea Kettle', tea_kettle,
  dict(bpm=76, seed=66, form=['Am', 'Am', 'F', 'F', 'C', 'C', 'G', 'G'] * 2 + ['Dm', 'Am', 'F', 'E'] * 2 + ['Am', 'F', 'C', 'G', 'Am', 'F', 'Esus4', 'Am'],
       mix=dict(gtr=.9, bass=.7, lead=.8, drums=.5), reverb=.3)),
 ('cooking-07-pantry-parade', 'Pantry Parade', pantry_parade,
  dict(bpm=112, seed=77, form=['F', 'C', 'Dm', 'Bb'] * 4 + ['Bb', 'C', 'Am', 'Dm', 'Bb', 'C', 'F', 'F'] * 2,
       mix=dict(keys=.7, bass=.85, drums=.6, lead=.9, lead2=.8), reverb=.2)),
 ('cooking-08-cinnamon-steam', 'Cinnamon Steam', cinnamon_steam,
  dict(bpm=72, swing=0.3, seed=88, form=['Ebmaj7', 'Cm9', 'Abmaj7', 'Bb7'] * 4 + ['Fm7', 'Gm7', 'Abmaj7', 'Bb7'] * 2 + ['Ebmaj7', 'Cm9', 'Abmaj7', 'Ebmaj7'] * 2,
       mix=dict(keys=.9, bass=.9, drums=.6, lead=.75), reverb=.25)),
 ('cooking-09-herb-garden', 'Herb Garden', herb_garden,
  dict(bpm=84, seed=99, form=['Gadd9', 'Em7', 'Cmaj7', 'Dsus2'] * 8,
       mix=dict(arp=.8, pad=.7, bass=.6, drums=.5, lead=.85), reverb=.3)),
 ('cooking-10-slow-stir', 'Slow Stir', slow_stir,
  dict(bpm=60, seed=110, form=['Emaj7', 'C#m7', 'Amaj7', 'B'] * 3 + ['Amaj7', 'G#m7', 'F#m7', 'B'] * 2 + ['Emaj7', 'C#m7', 'Amaj7', 'Emaj7'],
       mix=dict(keys=.8, lead=.9), reverb=.4)),
]

# ---------------------------------------------------------------- rendering

def reverb_ir(seconds, seed):
    rng = np.random.default_rng(seed); t = t_axis(seconds)
    ir = rng.normal(0, 1, len(t)) * np.exp(-t / (seconds / 6.5))
    ir = lowpass(ir, 4200)
    ir[:int(0.012 * SR)] = 0   # a little pre-delay
    return ir / np.sqrt(np.sum(ir ** 2))

def convolve(x, h):
    n = len(x) + len(h) - 1; N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(h, N), N)[:len(x)]

def render(spec_row):
    name, title, compose, spec = spec_row
    tr = Track(spec); tr.crackle = 0.0
    compose(tr)
    n = int(tr.length * SR); mix = np.zeros(n); rng = np.random.default_rng(spec['seed'] + 1)
    for part, events in tr.parts.items():
        buf = np.zeros(n)
        for inst, t, f, dur, vel in events:
            sig = DRUM[inst](vel, rng) if f is None else INSTR[inst](f, dur, vel, rng)
            s = int(t * SR); e = min(n, s + len(sig))
            if s < n: buf[s:e] += sig[:e - s]
        mix += buf * spec['mix'].get(part, 0.8)
    wet = convolve(mix, reverb_ir(2.6, spec['seed']))
    out = mix * (1 - spec['reverb'] * 0.5) + wet * spec['reverb'] * 2.2
    if tr.crackle:
        pops = (rng.random(n) < 0.00035) * rng.normal(0, 1, n)
        hiss = highpass(rng.normal(0, 1, n), 3000) * 0.004
        out += (lowpass(pops, 3500) * 3 + hiss) * tr.crackle * 20 * np.max(np.abs(out)) / 4
    out = lowpass(highpass(out, 45), 11000)   # a touch of warmth; nothing below the phone speaker's floor
    # Gentle fade in over the first beat, fade out over the last two seconds.
    fi = int(tr.beat * SR); out[:fi] *= np.linspace(0, 1, fi) ** 2
    fo = int(2.5 * SR); out[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    # Level: quiet background music. Soft-clip, then set the RMS near -17 dBFS with peaks below -1 dB.
    out /= np.max(np.abs(out)) + 1e-9
    out = np.tanh(out * 1.4) / np.tanh(1.4)
    rms = np.sqrt(np.mean(out[fi:-fo] ** 2))
    out *= min(0.14 / rms, 0.89 / np.max(np.abs(out)))
    return out, tr

def write_wav(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wav', help='also keep the WAVs in this folder')
    ap.add_argument('--only', type=int, help='render one track (1-10)')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    rows = [TRACKS[a.only - 1]] if a.only else TRACKS
    total = 0
    with tempfile.TemporaryDirectory() as tmp:
        for row in rows:
            name, title = row[0], row[1]
            x, tr = render(row)
            wav = os.path.join(a.wav or tmp, name + '.wav')
            if a.wav: os.makedirs(a.wav, exist_ok=True)
            write_wav(wav, x)
            m4a = os.path.join(OUT, name + '.m4a')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', BITRATE, '-ac', '1',
                            '-map_metadata', '-1', '-metadata', f'title={title}', '-metadata', 'artist=Keepsake',
                            '-movflags', '+faststart', m4a], check=True)
            size = os.path.getsize(m4a); total += size
            print(f'{name}.m4a  {title:16s} {len(x) / SR:5.1f}s  {size / 1024:6.0f} KB')
    print(f'total {total / 1024 / 1024:.1f} MB')

if __name__ == '__main__':
    main()
