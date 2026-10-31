"""Extra ("trending") transitions made with ffmpeg's xfade custom expressions. P = progress 0..1, X/Y = pixel, W/H = size, A(x,y)/B(x,y) = the two pictures."""

# a stable pseudo-random value 0..1 from a number
def _rnd(v):
    return f"st(9,sin({v}*12.9898)*43758.5453);ld(9)-floor(ld(9))"

CUSTOM = {
    # rows of the picture flip to the next one at random moments, with a sideways jolt: the classic glitch
    "glitchrows": f"st(0,floor(Y/(H/28)));st(1,sin(ld(0)*12.9898)*43758.5453);st(1,ld(1)-floor(ld(1)));"
                  "if(gt(P,ld(1)),B(X,Y),A(X+(ld(1)-0.5)*W*0.25*sin(P*PI),Y))",
    # random blocks flip over, like a mosaic dissolving
    "mosaic": "st(0,floor(X/(W/16))*7+floor(Y/(H/28))*131);st(1,sin(ld(0)*12.9898)*43758.5453);st(1,ld(1)-floor(ld(1)));if(gt(P,ld(1)),B(X,Y),A(X,Y))",
    # big blocks with an offset: glitchy blocks
    "glitchblocks": "st(0,floor(X/(W/6))*17+floor(Y/(H/10))*57);st(1,sin(ld(0)*12.9898)*43758.5453);st(1,ld(1)-floor(ld(1)));"
                    "if(gt(P,ld(1)),B(X,Y),A(X+(ld(1)-0.5)*40*sin(P*PI),Y))",
    # window blinds, vertical and horizontal
    "blindsv": "if(lt(mod(X,W/10)/(W/10),P),B(X,Y),A(X,Y))",
    "blindsh": "if(lt(mod(Y,H/12)/(H/12),P),B(X,Y),A(X,Y))",
    "checker": "if(gt(P,mod(floor(X/(W/8))+floor(Y/(H/14)),2)*0.5+0.25*(1-mod(floor(X/(W/8)),2))*0+0.0),B(X,Y),A(X,Y))",
    # a diamond grows from the middle
    "diamond": "if(lt(abs(X-W/2)/(W/2)+abs(Y-H/2)/(H/2),P*2),B(X,Y),A(X,Y))",
    # fast whip pan: the old picture is pushed off sideways, the new one whips in
    "whipleft": "st(0,P*P*(3-2*P));if(lt(X,W*(1-ld(0))),A(X+W*ld(0),Y),B(X-W*(1-ld(0)),Y))",
    "whipright": "st(0,P*P*(3-2*P));if(gt(X,W*ld(0)),A(X-W*ld(0),Y),B(X+W*(1-ld(0)),Y))",
    "whipup": "st(0,P*P*(3-2*P));if(lt(Y,H*(1-ld(0))),A(X,Y+H*ld(0)),B(X,Y-H*(1-ld(0))))",
    # the old picture rushes towards the viewer and fades into the new one, which settles from slightly large
    "zoomthrough": "st(1,1+P*0.6);st(2,1.25-P*0.25);(1-P)*A(W/2+(X-W/2)/ld(1),H/2+(Y-H/2)/ld(1))+P*B(W/2+(X-W/2)/ld(2),H/2+(Y-H/2)/ld(2))",
    "zoomout": "st(1,1-P*0.35);st(2,0.75+P*0.25);(1-P)*A(W/2+(X-W/2)/ld(1),H/2+(Y-H/2)/ld(1))+P*B(W/2+(X-W/2)/ld(2),H/2+(Y-H/2)/ld(2))",
    # wavy: both pictures ripple while they cross-fade
    "ripple": "st(1,sin(Y/(H/18)+P*12)*W*0.03*sin(P*PI));(1-P)*A(X+ld(1),Y)+P*B(X+ld(1),Y)",
    # a flash: dips through bright white very quickly
    "flash": "st(0,1-abs(2*P-1));st(1,pow(ld(0),3));(1-P)*A(X,Y)*(1-ld(1))+P*B(X,Y)*(1-ld(1))+ld(1)*if(eq(PLANE,0),255,128)",
    # split into thin vertical bars that slide up and down in opposite directions
    "barslide": "st(0,mod(floor(X/(W/10)),2));if(eq(ld(0),0),if(lt(Y,H*(1-P)),A(X,Y+H*P),B(X,Y-H*(1-P))),if(gt(Y,H*P),A(X,Y-H*P),B(X,Y+H*(1-P))))",
}


import re


def _plane(fn, args):
    """xfade samples a picture per colour plane with a0/a1/a2 (and b0/b1/b2); this picks the right one for the plane being computed."""
    return f"if(eq(PLANE,0),{fn}0({args}),if(eq(PLANE,1),{fn}1({args}),{fn}2({args})))"


def _expand(expr):
    """Replace every A(x,y) / B(x,y) (arguments may contain any nested brackets) by the plane-aware sampler."""
    out, i = "", 0
    while i < len(expr):
        m = re.match(r"([AB])\(", expr[i:])
        if m and (i == 0 or not (expr[i - 1].isalnum() or expr[i - 1] == "_")):
            j, depth = i + 2, 1
            while depth:
                depth += {"(": 1, ")": -1}.get(expr[j], 0)
                j += 1
            out += _plane(m.group(1).lower(), _expand(expr[i + 2:j - 1]))
            i = j
        else:
            out += expr[i]
            i += 1
    return out


def _top_split(expr, sep):
    out, depth, cur = [], 0, ""
    for ch in expr:
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if ch == sep and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    return out + [cur]


def inline_registers(expr):
    """xfade runs a custom expression on several threads at once, and st()/ld() memory is shared between them, so stored values
    get mixed up between pixels (measured: three runs gave three different videos). Write every ld(n) out as the expression that
    was stored in it, leaving no st()/ld() at all."""
    reg = {}

    def sub(e):
        return re.sub(r"ld\((\d+)\)", lambda m: reg[m.group(1)], e)
    parts = _top_split(expr, ";")
    for st in parts[:-1]:
        m = re.fullmatch(r"\s*st\((\d+),(.*)\)\s*", st, re.S)
        reg[m.group(1)] = "(" + sub(m.group(2)) + ")"
    return sub(parts[-1])


def forward(expr):
    """The expressions above are written with P running 0 -> 1 (old picture -> new picture), but xfade's P runs 1 -> 0
    (measured: P*255 gives 255 on the first transition frame). Swap every bare P for (1-P); PI and PLANE are left alone."""
    return re.sub(r"(?<![A-Za-z_])P(?![A-Za-z_0-9])", "(1-P)", expr)


def xfade_arg(name):
    """The value for xfade's transition option, plus any extra option text: ("circleopen", "") or ("custom", ":expr='...'")."""
    if name == "cut":                                 # no transition: a three-frame fade (pipeline.tdur), seen as a straight cut
        return "fade", ""
    if name in CUSTOM:
        return "custom", ":expr='" + _expand(forward(inline_registers(CUSTOM[name]))).replace("'", "") + "'"
    return name, ""
