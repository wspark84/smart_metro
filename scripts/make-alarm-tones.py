# Original alarm tones for 이노치 — synthesized here, no third-party audio.
import numpy as np, wave, sys
SR = 44100
def t(sec): return np.arange(int(SR*sec))/SR
def env(n, attack=0.005, release=0.03):
    e = np.ones(n); a=int(SR*attack); r=int(SR*release)
    if a: e[:a]=np.linspace(0,1,a)
    if r: e[-r:]=np.minimum(e[-r:], np.linspace(1,0,r))
    return e
def tone(freq, sec, harmonics=((1,1.0),), decay=None, attack=0.005, release=0.03):
    x=t(sec); y=sum(a*np.sin(2*np.pi*freq*h*x) for h,a in harmonics)
    if decay: y*=np.exp(-x/decay)
    return y*env(len(x),attack,release)
def silence(sec): return np.zeros(int(SR*sec))
def save(name, y):
    y=y/np.max(np.abs(y))*0.89
    data=(y*32767).astype(np.int16)
    with wave.open(name,'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
    print(name, round(len(y)/SR,2),'s')
sq=((1,1.0),(3,0.33),(5,0.2))   # square-ish, cuts through
# 1. 디지털 비프: 4 quick beeps x 3 groups
grp=np.concatenate([np.concatenate([tone(2000,0.09,sq),silence(0.06)]) for _ in range(4)])
save('inochi_beep.wav', np.concatenate([grp,silence(0.45)]*3))
# 2. 종소리: struck bell with inharmonic partials, three strikes
bell=lambda f: tone(f,1.4,((1,1.0),(2.0,0.6),(2.76,0.45),(5.4,0.25),(8.93,0.12)),decay=0.45,attack=0.002,release=0.05)
save('inochi_bell.wav', np.concatenate([bell(660),bell(660),bell(523)]))
# 3. 점점 올라가는 소리: rising arpeggio C-E-G-C, twice, louder second time
arp=lambda g: np.concatenate([g*tone(f,0.22,((1,1),(2,0.3)),attack=0.01,release=0.05) for f in (523,659,784,1047)])
save('inochi_rise.wav', np.concatenate([arp(0.6),silence(0.25),arp(1.0),silence(0.25),arp(1.0),silence(0.4)]))
# 4. 차임: two-tone marimba-like ding-dong x3
mar=lambda f: tone(f,0.55,((1,1.0),(4,0.25),(10,0.06)),decay=0.18,attack=0.002,release=0.04)
save('inochi_chime.wav', np.concatenate([np.concatenate([mar(988),mar(784),silence(0.35)]) for _ in range(3)]))
# 5. 긴급 사이렌: sweeping tone up/down
x=t(4.2); f=900+400*np.sin(2*np.pi*1.25*x)
ph=2*np.pi*np.cumsum(f)/SR
save('inochi_siren.wav', (np.sin(ph)+0.3*np.sin(3*ph))*env(len(x),0.02,0.08))
