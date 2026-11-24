# Finner NorKyst v3-datasettene på MET sin THREDDS (katalogen), så strømkartet kan bruke den nyeste prognosen.
# Skriver ut katalogene og de nyeste filene. Bruk: python3 finn.py
import re, sys, urllib.request
B = 'https://thredds.met.no/thredds/catalog/'
def cat(path):
    with urllib.request.urlopen(B + path, timeout=60) as r: x = r.read().decode('utf-8', 'replace')
    refs = re.findall(r'<catalogRef[^>]*xlink:href="([^"]+)"[^>]*xlink:title="([^"]+)"', x)
    ds = re.findall(r'<dataset[^>]*name="([^"]+)"[^>]*urlPath="([^"]+)"', x)
    return refs, ds
refs, ds = cat('fou-hi/catalog.xml')
for h, t in refs:
    if 'norkyst' in (h + t).lower(): print('KATALOG', t, '->', h)
for n, u in ds:
    if 'norkyst' in u.lower(): print('DATASETT', n, u)
