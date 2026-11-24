# Finner NorKyst v3-datasettene på MET sin THREDDS (katalogen), så strømkartet kan bruke den nyeste prognosen.
import re, urllib.request
B = 'https://thredds.met.no/thredds/catalog/'
def cat(path):
    try:
        with urllib.request.urlopen(B + path, timeout=60) as r: x = r.read().decode('utf-8', 'replace')
    except Exception as e: print('FEIL', path, e); return [], []
    refs = re.findall(r'<catalogRef[^>]*xlink:href="([^"]+)"', x)
    ds = re.findall(r'<dataset[^>]*urlPath="([^"]+)"', x)
    return refs, ds
for p in ['catalog.xml', 'fou-hi/norkystv3_his_files/catalog.xml', 'fou-hi/norkystv3_800m_m00_be/catalog.xml', 'fou-hi/norkyst800v3/catalog.xml']:
    refs, ds = cat(p); print('==', p); [print('  REF', r) for r in refs if 'norkyst' in r.lower() or p != 'catalog.xml'][:40]; [print('  DS', d) for d in ds[:20]]
# gå ned til nyeste dag i his_files
p = 'fou-hi/norkystv3_his_files/'
for _ in range(3):
    refs, ds = cat(p + 'catalog.xml')
    if not refs: break
    num = sorted(r for r in refs if r.split('/')[0].isdigit())
    if not num: break
    p = p + num[-1].replace('catalog.xml', '')
refs, ds = cat(p + 'catalog.xml'); print('== nyeste', p); [print('  DS', d) for d in ds]
