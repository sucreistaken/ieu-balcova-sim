"""Fetch a regional elevation grid (EU-DEM 25 m via opentopodata.org public API).

Output: data/dem_world.json, row-major, row 0 = south edge, col 0 = west edge.
"""
import json, subprocess, time, sys

LAT0, LAT1 = 38.3760, 38.4060
LON0, LON1 = 27.0280, 27.0620
ROWS, COLS = 95, 85

pts = [(LAT0 + (LAT1 - LAT0) * i / (ROWS - 1), LON0 + (LON1 - LON0) * j / (COLS - 1))
       for i in range(ROWS) for j in range(COLS)]

def fetch(chunk):
    url = 'https://api.opentopodata.org/v1/eudem25m?locations=' + '|'.join(f'{a:.6f},{b:.6f}' for a, b in chunk)
    for attempt in range(6):
        out = subprocess.run(['curl', '-sS', '-m', '60', '-A', 'ieu-campus-sim/0.1', url],
                             capture_output=True, text=True).stdout
        try:
            j = json.loads(out)
            if j.get('status') == 'OK':
                return [r['elevation'] for r in j['results']]
        except Exception:
            pass
        time.sleep(3 + attempt * 2)
    raise RuntimeError('DEM chunk failed')

vals = []
for k in range(0, len(pts), 100):
    vals += fetch(pts[k:k + 100])
    print(f'{len(vals)}/{len(pts)}', flush=True)
    time.sleep(1.2)

nulls = sum(v is None for v in vals)
vals = [0.0 if v is None else round(float(v), 2) for v in vals]
json.dump({'lat0': LAT0, 'lat1': LAT1, 'lon0': LON0, 'lon1': LON1, 'rows': ROWS, 'cols': COLS,
           'source': 'EU-DEM 25m via opentopodata.org (eudem25m)', 'nulls_replaced_with_0': nulls,
           'values': vals}, open('data/dem_world.json', 'w'))
print('done', len(vals), 'nulls', nulls, 'min', min(vals), 'max', max(vals))
