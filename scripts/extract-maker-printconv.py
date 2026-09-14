"""
Extracts maker-note tag tables (names, formats, RawConv skip-classes and
pure-hash PrintConv enums) from the local ExifTool Perl source and writes
src/tags/generated/maker-printconv.json.

The generated tags.json (from `exiftool -listx`) carries tag names but not
their PrintConv enums, and its positional sub-table ids can diverge from the
Perl source. makernotes.ts consumes this file for both names and PrintConv.
Only literal hash PrintConvs (number => string) are extracted; expression
PrintConvs/ValueConvs are ported by hand in makernotes.ts. RawConv filters
are classified into simple skip rules ('skipZero', 'skipNeg1', 'skip0x7fff',
'skipEq127', 'skipNonPositive', 'skipEq0', 'skipNegative').

Conditional list entries (`0xNN => [ {...}, {...} ]`, model variants) resolve
to the first non-Unknown variant.

Usage: python3 scripts/extract-maker-printconv.py [/path/to/ExifTool/lib]
The lib dir must contain Image/ExifTool/<Vendor>.pm. Defaults to the
Homebrew exiftool 13.55 cellar path on macOS.
"""

import json
import os
import re
import sys

DEFAULT_LIB = '/opt/homebrew/Cellar/exiftool/13.55_1/libexec/lib/perl5/Image/ExifTool'

SPEC = {
    'Canon.pm': [
        'Canon::Main', 'Canon::CameraSettings', 'Canon::FocalLength',
        'Canon::ShotInfo', 'Canon::SensorInfo', 'Canon::ColorData1',
        'Canon::Processing', 'Canon::MeasuredColor', 'Canon::MyColors',
        'Canon::Panorama', 'Canon::ColorInfo', 'Canon::FileInfo',
    ],
    'Nikon.pm': ['Nikon::Main', 'Nikon::Type2', 'Nikon::LensData01',
                 'Nikon::LensData00', 'Nikon::ColorBalance0100',
                 'Nikon::ColorBalance0101', 'Nikon::FlashInfo0102'],
    'Sony.pm': ['Sony::Main', 'Sony::Minolta', 'Sony::ShotInfo', 'Sony::CameraInfo',
                'Sony::CameraInfo2', 'Sony::CameraInfo3', 'Sony::MoreSettings',
                'Sony::MoreInfo0201', 'Sony::MoreInfo0401', 'Sony::Tag2010a',
                'Sony::Tag2010b', 'Sony::Tag2010c', 'Sony::Tag2010d'],
    'Olympus.pm': ['Olympus::Main', 'Olympus::Equipment', 'Olympus::CameraSettings',
                   'Olympus::FocusInfo', 'Olympus::ImageProcessing', 'Olympus::RawDev',
                   'Olympus::RawDevelopment', 'Olympus::Olympus', 'Olympus::OMSystem'],
    'Panasonic.pm': ['Panasonic::Main', 'Panasonic::Type2', 'PanasonicRaw::Main',
                     'PanasonicRaw::DistortionInfo'],
    'Pentax.pm': ['Pentax::Main', 'Pentax::PENT', 'Pentax::CameraInfo'],
}

RAWCONV_CLASSES = [
    ('$val == 0x7fff ? undef : $val', 'skip0x7fff'),
    ('$val == 127 ? undef : $val', 'skipEq127'),
    ('$val==-1 ? undef : $val', 'skipNeg1'),
    ('$val == -1 ? undef : $val', 'skipNeg1'),
    ('$val==0 ? undef : $val', 'skipEq0'),
    ('$val > 0 ? $val : undef', 'skipNonPositive'),
    ('$val ? $val : undef', 'skipZero'),
    ('$val >= 0 ? $val : undef', 'skipNegative'),
    ('$val < 40 ? undef : $val', 'skipLt40'),
    ('$val < 0x80 ? $val : undef', 'skip0x80Plus'),
]


def brace_block(src, i):
    """Returns (start, end) inclusive indices of the '{...}' block opening at i."""
    depth = 0
    for j in range(i, len(src)):
        c = src[j]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i, j
    return None


def parse_hash(src, i):
    """Parses a Perl hash literal beginning at '{' index i. Values that are
    not literal numbers or strings become the sentinel '__EXPR__'."""
    out = {}
    j = i + 1
    key_re = re.compile(r'-?\+?0x[0-9a-fA-F]+|-?\d+(\.\d+)?')
    str_re = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")
    num_re = re.compile(r'-?\d+(\.\d+)?')
    while j < len(src):
        if src[j] == '#':
            while j < len(src) and src[j] != chr(10):
                j += 1
            continue
        if src[j] == '}':
            return out, j
        m = key_re.match(src, j)
        if m:
            rest = src[m.end():]
            ls = rest.lstrip()
            if ls.startswith('=>'):
                key = m.group(0).lstrip('+')
                k = int(key, 16) if key.lower().startswith('0x') else (
                    float(key) if '.' in key else int(key))
                p = m.end() + (len(rest) - len(ls)) + 2
                while p < len(src) and src[p] in ' \t':
                    p += 1
                if src[p] == '{':
                    sub, end = parse_hash(src, p)
                    out[k] = sub
                    j = end + 1
                else:
                    sm = str_re.match(src[p:])
                    if sm:
                        out[k] = sm.group(1) if sm.group(1) is not None else sm.group(2)
                        j = p + sm.end()
                    else:
                        nm = num_re.match(src[p:])
                        if nm:
                            v = nm.group(0)
                            out[k] = float(v) if '.' in v else int(v)
                            j = p + nm.end()
                        else:
                            out[k] = '__EXPR__'
                            j = p
                while j < len(src) and src[j] not in ',}':
                    j += 1
                j += 1
                continue
        j += 1
    return out, j


def usable(h):
    return bool(h) and all(
        not isinstance(v, dict) and v != '__EXPR__' for v in h.values())


def named_hash(src, name):
    """Extracts `%name = ( ... )` literal lists (values => strings only)."""
    hm = re.search(r'%' + name + r'\s*=\s*\(', src)
    if not hm:
        return {}
    open_paren = hm.end() - 1
    depth = 0
    end = None
    in_str = False
    for j in range(open_paren, len(src)):
        c = src[j]
        if in_str:
            if c == "'" and src[j - 1] != chr(92):
                in_str = False
            continue
        if c == '#':
            while j < len(src) and src[j] != chr(10):
                j += 1
            continue
        if c == "'":
            in_str = True
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                end = j
                break
    if end is None:
        return {}
    h = {}
    j = open_paren + 1
    key_re = re.compile(r"-?\+?(?:'[^']*'|0x[0-9a-fA-F]+|-?\d+(?:\.\d+)?)")
    str_re = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")
    while j < end:
        if src[j] == '#':
            while j < end and src[j] != chr(10):
                j += 1
            continue
        m = key_re.match(src, j)
        if m:
            rest = src[m.end():end]
            ls = rest.lstrip()
            if ls.startswith('=>'):
                raw = m.group(0)
                if raw.startswith("'"):
                    k = raw[1:-1]
                else:
                    k = raw.lstrip('+')
                    if k.lower().startswith('0x'):
                        k = str(int(k, 16))
                    elif '.' not in k:
                        k = str(int(k))
                p = m.end() + (len(rest) - len(ls)) + 2
                while p < end and src[p] in ' \t':
                    p += 1
                sm = str_re.match(src[p:])
                if sm:
                    v = sm.group(1) if sm.group(1) is not None else sm.group(2)
                    h[k] = v
                    j = p + sm.end()
                else:
                    j = p
            else:
                j = m.end()
        else:
            j += 1
    return h if h and all(not isinstance(v, dict) and v != '__EXPR__' for v in h.values()) else {}


def classify_rawconv(expr):
    expr = ' '.join(expr.split())
    for pat, cls in RAWCONV_CLASSES:
        if pat in expr:
            return cls
    return 'custom'


def extract_entry(src, ent, info):
    nm = re.search(r"Name => '(.*?)'", ent)
    if not nm:
        return None
    info = dict(info)
    info['name'] = nm.group(1)
    if re.search(r"Unknown => [0-9]", ent) or re.search(r"Flags => ..[^]]*'Unknown'", ent):
        info['unknown'] = 1
    wm = re.search(r"Writable => '(\w+)'", ent)
    if wm:
        info['fmt'] = wm.group(1)
    fm = re.search(r"Format => '(\w+)\[(\d+)\]'", ent)
    if fm:
        if fm.group(1) == 'string':
            info['str'] = int(fm.group(2))
        else:
            info['count'] = int(fm.group(2))
    rc = re.search(r"RawConv => (.+?),\n(?:\s+)", ent)
    if rc:
        info['raw'] = classify_rawconv(rc.group(1))
    if re.search(r'Priority => 0', ent):
        info['prio'] = 0
    pi = ent.find('PrintConv =>')
    if pi >= 0:
        pc = ent[pi + len('PrintConv =>'):].lstrip()
        if pc.startswith('{'):
            blk = brace_block(ent, pi + len('PrintConv =>') + (len(pc) - len(pc.lstrip())))
            if blk:
                h, _ = parse_hash(ent, blk[0])
                if usable(h):
                    info['pc'] = h
        else:
            hn = re.match(r'\\%(\w+)', pc)
            if hn:
                h = named_hash(src, hn.group(1))
                if usable(h):
                    info['pc'] = h
    return info


def table_def(src, table):
    m = re.search(r'%Image::ExifTool::' + re.escape(table) + r' = \(', src)
    if not m:
        return None
    start = m.end()
    end = src.index('\n);', start)
    body = src[start:end]
    fm = re.search(r"FORMAT => '(.*?)'", body)
    fe = re.search(r'FIRST_ENTRY => (-?\d+)', body)
    tags = {}
    for mm in re.finditer(r"^    (-?0x[0-9a-fA-F]+|\d+) => (\{|\[|'[^']*')", body, re.M):
        raw = mm.group(1)
        key = int(raw, 16) if raw.lower().startswith('0x') else int(raw)
        kind = mm.group(2)
        if kind.startswith("'"):
            tags[str(key)] = {'name': kind[1:-1]}
            continue
        b = brace_block(body, mm.end() - 1)
        if not b:
            continue
        # Conditional lists (`0xNN => [ {...}, {...} ]`) hold model variants;
        # every variant maps to the same id, so take the first usable one.
        candidates = [(b[0], b[1])]
        if kind == '[':
            candidates = []
            pos = b[0] + 1
            while pos < b[1]:
                ob = body.find('{', pos)
                if ob < 0 or ob >= b[1]:
                    break
                blk = brace_block(body, ob)
                if not blk:
                    pos = ob + 1
                    continue
                candidates.append((blk[0], blk[1]))
                pos = blk[1] + 1
        for cs, ce in candidates:
            info = extract_entry(src, body[cs:ce + 1], {})
            if info is None:
                continue
            if len(candidates) > 1 and info.get('unknown'):
                continue
            tags[str(key)] = info
            break
    return {
        'format': fm.group(1) if fm else None,
        'firstEntry': int(fe.group(1)) if fe else 0,
        'tags': tags,
    }


ROUTING_SPEC = {
    'Canon.pm': ['Canon::Main'],
    'Nikon.pm': ['Nikon::Main'],
    'Sony.pm': ['Sony::Main'],
    'Olympus.pm': ['Olympus::Main'],
    'Panasonic.pm': ['Panasonic::Main', 'PanasonicRaw::Main'],
    'Pentax.pm': ['Pentax::Main'],
}


def table_routing(src, table):
    """Extracts key -> short TagTable name for SubDirectory entries of a
    main table (e.g. 0x2010 -> 'Olympus::Equipment')."""
    m = re.search(r'%Image::ExifTool::' + re.escape(table) + r' = \(', src)
    if not m:
        return {}
    start = m.end()
    end = src.index('\n);', start)
    body = src[start:end]
    routing = {}
    for mm in re.finditer(r'^    (-?0x[0-9a-fA-F]+|\d+) => (\{|\[)', body, re.M):
        raw = mm.group(1)
        key = int(raw, 16) if raw.lower().startswith('0x') else int(raw)
        b = brace_block(body, mm.end() - 1)
        if not b:
            continue
        ent = body[b[0]:b[1] + 1]
        tt = re.search(r"TagTable => 'Image::ExifTool::(.*?)'", ent)
        if tt:
            routing[str(key)] = tt.group(1)
    return routing


def main():
    lib = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_LIB
    out = {}
    for pm, tables in SPEC.items():
        src = open(os.path.join(lib, pm)).read()
        for t in tables:
            d = table_def(src, t)
            if d:
                out[t] = d
    routing = {}
    for pm, tables in ROUTING_SPEC.items():
        src = open(os.path.join(lib, pm)).read()
        for t in tables:
            r = table_routing(src, t)
            if r:
                routing[t] = r
    # Nikon decryption tables (Nikon.pm @xlat, 2 x 256 byte arrays)
    nikon_src = open(os.path.join(lib, 'Nikon.pm')).read()
    xm = re.search(r'my @xlat = \((.*?)\n\);', nikon_src, re.S)
    nikon_xlat = None
    if xm:
        rows = re.findall(r'\[(.*?)\]', xm.group(1), re.S)
        nikon_xlat = [[int(v, 16) for v in re.findall(r'0x([0-9a-fA-F]{2})', row)]
                      for row in rows]
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                        'src', 'tags', 'generated', 'maker-printconv.json')
    with open(dest, 'w') as f:
        json.dump({'tables': out, 'routing': routing, 'nikonXlat': nikon_xlat},
                  f, indent=1, sort_keys=True)
    total = sum(len(v['tags']) for v in out.values())
    print(f'wrote {os.path.normpath(dest)}: {len(out)} tables, {total} tags, '
          f'{sum(len(v) for v in routing.values())} routing entries')


if __name__ == '__main__':
    main()
