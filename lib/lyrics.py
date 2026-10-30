"""Lyrics file -> lines and screens.

    [pallavi] / [charanam 1] ... label a block. Without an [order] block the blocks are used in file order (so a repeated
    [Pallavi] is simply sung again). With [order], each label's lines are defined once and repeated as listed.
    A line with a comma is shown as two display lines (split at the comma); other lines are paired, two per screen.
    A line that is too long for one display line (more than LONG base characters) gets a screen of its own, split into two display lines.
    An [Aalap] block (also Alap, ఆలాప్, आलाप) marks where she sings without words. Each of its lines becomes a screen of its own showing what she
    wrote (for example ఓ...ఓ...ఓ....), timed from where the voice is sung there, not by matching words. List it in [order] as Aalap. A bare line
    (Aalap) shows ♪ Aalap ♪.
"""
import re
import unicodedata

LONG = 28            # base characters (marks that sit on a letter are not counted) above which one lyric line needs two display lines
AALAP_WORDS = {"aalap", "alap", "aalaap", "alaap", "aalapana", "alapana", "ఆలాప్", "ఆలాప", "ఆలాపన", "ఆలాపనం", "आलाप", "आलाप्", "आलापना", "ஆலாப்", "ಆಲಾಪ್", "ആലാപ്"}


def aalap_text(line):
    """The word she wrote for an aalap (e.g. "Aalap"), or None if the line is an ordinary lyric line."""
    inner = re.sub(r"^[\(\[\{~♪\s]+|[\)\]\}~♪\s.]+$", "", (line or "").strip())
    return inner if inner and inner.lower() in AALAP_WORDS else None


def base_len(s):
    return sum(1 for c in s if unicodedata.category(c) not in ("Mn", "Mc", "Me", "Cf"))


def split_long(line):
    """Two display lines for a long line: at a double space (how a clause break is usually typed), else at the space nearest the middle."""
    parts = [x.strip() for x in re.split(r"\s{2,}", line.strip()) if x.strip()]
    if len(parts) == 2:
        return parts
    words = line.split()
    if len(words) < 2:
        return [line.strip()]
    best = min(range(1, len(words)), key=lambda i: abs(base_len(" ".join(words[:i])) - base_len(" ".join(words[i:]))))
    return [" ".join(words[:best]), " ".join(words[best:])]


def parse(text):
    blocks, cur, order = [], None, None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"\[(.+)\]", line)
        if m:
            lab = m.group(1).strip()
            cur = {"label": lab, "lines": []}
            if lab.lower() == "order":
                order = []
                cur = None
            else:
                blocks.append(cur)
            continue
        if order is not None and cur is None:
            order += [x.strip() for x in line.split(",") if x.strip()]
        elif cur is not None:
            cur["lines"].append(line)
    if order:
        defs = {}
        for b in blocks:
            defs.setdefault(b["label"].lower(), b)
        blocks = [{"label": defs[o.lower()]["label"], "lines": defs[o.lower()]["lines"]} if o.lower() in defs else {"label": "aalap", "lines": [o]}
                  for o in order if o.lower() in defs or aalap_text(o)]
    return blocks


def split_commas(line):
    parts = [p.strip() for p in re.split(r"[,，]", line) if p.strip()]
    return parts if len(parts) == 2 else [line.replace(",", "").strip()]


def screens(text, per=2, drop=(), breaks=()):
    """[{'section', 'lines': [display lines], 'src': [indexes into the flat line list]}] and the flat list of sung lines."""
    flat, out = [], []
    for b in parse(text):
        pend = []

        def flush():
            if pend:
                out.append({"section": b["label"], "lines": [l for _, d in pend for l in d], "src": [i for i, _ in pend]})
                pend.clear()
        for ln in b["lines"]:
            i = len(flat)
            flat.append(ln)
            if i in drop:
                continue
            if i in breaks:                          # sung far apart from the line before it: its own screen
                flush()
            aal = aalap_text(ln)
            if aal or aalap_text(f"[{b['label']}]"):  # an aalap (a block called Aalap, or a line saying so): a screen of its own showing what she wrote
                flush()
                out.append({"section": b["label"], "lines": [f"♪ {aal} ♪" if aal else ln], "src": [i], "aalap": True})
                continue
            disp = split_commas(ln)
            long_line = per >= 2 and len(disp) == 1 and base_len(disp[0]) > LONG and len(disp[0].split()) > 1
            if long_line:
                disp = split_long(disp[0])
            if (len(disp) == 2 and per >= 2) or len(ln.replace(",", " ").split()) <= 1:   # a comma line, a long line, or a one-word filler (ओजीहो): a screen by itself
                flush()
                pend.append((i, disp))
                flush()
            else:
                pend.append((i, disp))
                if len(pend) >= per:
                    flush()
        flush()
    return out, flat
