# DSP minimal pour le signal bioelectrique, sans numpy (MicroPython / RP2040).
# Echantillonne une fenetre a cadence fixe puis calcule des features robustes +
# une forme d'onde sous-echantillonnee. Tout est en comptes ADC bruts (0-65535);
# la conversion en uV (si le gain est connu) est faite par l'appelant via to_uv().

import math
import time


def _median(values):
    if not values:
        return 0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def sample_window(adc, rate_hz, total, chunk, feed=None, oversample=1):
    """Acquisition cadencee de `total` echantillons a `rate_hz`.

    L'acquisition est decoupee en paquets de `chunk` echantillons; le watchdog
    est nourri (via `feed`) entre les paquets pour ne jamais depasser sa fenetre.

    `oversample` lectures sont moyennees par echantillon: indispensable avec des
    electrodes directes (source haute impedance) -> la 1ere lecture charge le
    condensateur d'echantillonnage de l'ADC et la moyenne attenue le bruit blanc.
    """
    period_us = max(1, int(1000000 // max(1, rate_hz)))
    over = max(1, int(oversample))
    samples = []
    next_us = time.ticks_us()
    taken = 0
    while taken < total:
        if feed:
            feed()
        burst = min(chunk, total - taken)
        for _ in range(burst):
            # Busy-wait jusqu'au prochain instant d'echantillonnage.
            while time.ticks_diff(next_us, time.ticks_us()) > 0:
                pass
            if over == 1:
                samples.append(adc.read_u16())
            else:
                acc = 0
                for _ in range(over):
                    acc += adc.read_u16()
                samples.append(acc // over)
            next_us = time.ticks_add(next_us, period_us)
            taken += 1
    return samples


def analyze(samples, rate_hz, bias=None, spike_sigma=3.0, waveform_points=64,
            flatline_p2p=30, noisy_std=9000, rail_margin=400, rail_fraction=0.05):
    n = len(samples)
    if n == 0:
        return {"sampleCount": 0, "qualityFlag": "flatline", "waveform": []}

    baseline = bias if (bias is not None and bias > 0) else _median(samples)
    mean_raw = sum(samples) / n
    min_raw = min(samples)
    max_raw = max(samples)
    p2p = max_raw - min_raw

    # Ecart-type (autour de la moyenne) et RMS (autour de la baseline = signal AC).
    var_sum = 0.0
    rms_sum = 0.0
    for s in samples:
        dm = s - mean_raw
        var_sum += dm * dm
        db = s - baseline
        rms_sum += db * db
    std = math.sqrt(var_sum / n)
    rms = math.sqrt(rms_sum / n)

    # Pente (derive lineaire) en comptes/seconde via regression sur l'index.
    t_mean = (n - 1) / 2.0
    num = 0.0
    den = 0.0
    for i in range(n):
        dt = i - t_mean
        num += dt * (samples[i] - mean_raw)
        den += dt * dt
    slope_per_sample = (num / den) if den else 0.0
    slope_per_sec = slope_per_sample * rate_hz

    # Taux de passage par zero (du signal centre) -> proxy de frequence.
    zero_cross = 0
    prev = samples[0] - baseline
    for i in range(1, n):
        cur = samples[i] - baseline
        if (prev <= 0 and cur > 0) or (prev >= 0 and cur < 0):
            zero_cross += 1
        prev = cur
    window_s = n / float(rate_hz)
    zero_cross_rate = zero_cross / window_s if window_s else 0.0

    # Comptage de spikes: franchissements montants du seuil baseline + k*std.
    threshold = std * spike_sigma
    spike_count = 0
    above = False
    for s in samples:
        d = abs(s - baseline)
        if d > threshold and not above:
            spike_count += 1
            above = True
        elif d <= threshold:
            above = False

    # Energies de bande (proxys sans FFT):
    #  - haute: energie des differences successives (contenu rapide).
    #  - basse: variance d'une moyenne glissante (derive lente).
    #  - moyenne: reste de l'energie totale.
    total_energy = rms_sum / n
    diff_energy = 0.0
    for i in range(1, n):
        d = samples[i] - samples[i - 1]
        diff_energy += d * d
    band_high = diff_energy / max(1, n - 1)

    win = max(1, int(rate_hz // 2))
    slow = []
    acc = 0.0
    for i in range(n):
        acc += samples[i]
        if i >= win:
            acc -= samples[i - win]
            slow.append(acc / win)
        elif i == win - 1:
            slow.append(acc / win)
    if slow:
        slow_mean = sum(slow) / len(slow)
        band_low = sum((v - slow_mean) ** 2 for v in slow) / len(slow)
    else:
        band_low = 0.0
    band_mid = total_energy - band_low
    if band_mid < 0:
        band_mid = 0.0

    # Qualite du signal (electrodes directes: detecter une entree flottante/aux rails).
    hi = 65535 - rail_margin
    lo = rail_margin
    rail_hits = sum(1 for s in samples if s >= hi or s <= lo)
    near_rail_dc = baseline >= hi or baseline <= lo
    if rail_hits / n > rail_fraction:
        # Soit l'ampli sature, soit (en direct) l'electrode est flottante/mal en contact.
        quality = "floating" if near_rail_dc and std < noisy_std else "saturated"
    elif p2p < flatline_p2p:
        quality = "flatline"
    elif std > noisy_std:
        quality = "noisy"
    else:
        quality = "ok"

    # Forme d'onde decimee et normalisee 0-1 (sur l'amplitude de la fenetre).
    waveform = []
    points = min(waveform_points, n)
    if points >= 2 and p2p > 0:
        step = n / float(points)
        for k in range(points):
            idx = int(k * step)
            if idx >= n:
                idx = n - 1
            waveform.append(round((samples[idx] - min_raw) / p2p, 4))

    return {
        "sampleCount": n,
        "baselineRaw": round(baseline, 1),
        "meanRaw": round(mean_raw, 1),
        "minRaw": min_raw,
        "maxRaw": max_raw,
        "p2pRaw": p2p,
        "stdRaw": round(std, 2),
        "rmsRaw": round(rms, 2),
        "slopeRawPerSec": round(slope_per_sec, 3),
        "zeroCrossRate": round(zero_cross_rate, 2),
        "spikeCount": spike_count,
        "bandLowEnergy": round(band_low, 2),
        "bandMidEnergy": round(band_mid, 2),
        "bandHighEnergy": round(band_high, 2),
        "qualityFlag": quality,
        "waveform": waveform
    }


def to_uv(value, gain, uv_per_count):
    """Convertit des comptes ADC en uV refere-entree. None si gain inconnu."""
    if value is None or not gain or gain <= 0:
        return None
    return value * uv_per_count / gain
