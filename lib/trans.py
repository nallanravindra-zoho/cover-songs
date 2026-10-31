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
    # --- more, after CapCut / InShot (motion graphics, camera, light, distortion, shapes); the preview draws the same in lib/fx.js ---
    # the old picture splits in the middle like two doors and slides apart / the new one closes in from both sides
    "doorsopen": "st(0,P*P*(3-2*P));if(lt(X,W/2),if(lt(X,W/2*(1-ld(0))),A(X+W/2*ld(0),Y),B(X,Y)),if(gt(X,W/2+W/2*ld(0)),A(X-W/2*ld(0),Y),B(X,Y)))",
    "doorsclose": "st(0,P*P*(3-2*P));if(lt(X,W/2*ld(0)),B(X+W/2*(1-ld(0)),Y),if(gt(X,W-W/2*ld(0)),B(X-W/2*(1-ld(0)),Y),A(X,Y)))",
    "whipdown": "st(0,P*P*(3-2*P));if(gt(Y,H*ld(0)),A(X,Y-H*ld(0)),B(X,Y+H*(1-ld(0))))",
    # the new picture comes in through the dark parts of the old one first
    "lumafade": "if(gt(P*1.2-0.1,(a0(X,Y)-16)/219),B(X,Y),A(X,Y))",
    # shapes that grow from the middle
    "heart": "st(3,W*0.36*(P*2.4+0.001));st(1,(X-W/2)/ld(3));st(2,-(Y-H*0.47)/ld(3));if(lte(pow(ld(1)*ld(1)+ld(2)*ld(2)-1,3)-ld(1)*ld(1)*ld(2)*ld(2)*ld(2),0),B(X,Y),A(X,Y))",
    "star": "if(lt(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2),P*1.6*(0.62+0.38*cos(5*atan2(Y-H/2,X-W/2)))),B(X,Y),A(X,Y))",
    "cross": "if(gt(lt(abs(X-W/2)/W,P*0.75)+lt(abs(Y-H/2)/H,P*0.75),0),B(X,Y),A(X,Y))",
    "circlegrid": "st(0,W/7);if(lt(hypot(X-(floor(X/ld(0))+0.5)*ld(0),Y-(floor(Y/ld(0))+0.5)*ld(0))/ld(0),P*0.75),B(X,Y),A(X,Y))",
    "diagstripes": "if(lt(mod((X+Y)/(W/6),1),P),B(X,Y),A(X,Y))",
    # the new picture slides in and bounces
    "bounceslide": "st(0,1-(1-P)*(1-P)*cos(P*3*PI));if(gte(X,W*(1-ld(0))),B(X-W*(1-ld(0)),Y),A(X+W*ld(0),Y))",
    # the old picture spins away getting smaller, the new one spins in
    "spin": "st(0,if(lt(P,0.5),1-P*1.6,0.2+(P-0.5)*1.6));st(1,if(lt(P,0.5),P*PI,(P-1)*PI));"
            "st(2,W/2+((X-W/2)*cos(ld(1))+(Y-H/2)*sin(ld(1)))/ld(0));st(3,H/2+(-(X-W/2)*sin(ld(1))+(Y-H/2)*cos(ld(1)))/ld(0));"
            "if(between(ld(2),0,W-1)*between(ld(3),0,H-1),if(lt(P,0.5),A(ld(2),ld(3)),B(ld(2),ld(3))),if(eq(PLANE,0),16,128))",
    # a whirlpool in the middle while one picture fades into the other
    "twirl": "st(0,12.566*P*(1-P)*max(0,1-hypot(X-W/2,Y-H/2)/hypot(W/2,H/2)));st(1,W/2+(X-W/2)*cos(ld(0))-(Y-H/2)*sin(ld(0)));st(2,H/2+(X-W/2)*sin(ld(0))+(Y-H/2)*cos(ld(0)));"
             "(1-P)*A(ld(1),ld(2))+P*B(ld(1),ld(2))",
    # like a strip of film: the old frame rolls up, a black bar, the new frame
    "filmroll": "st(0,H*1.08*P*P*(3-2*P));if(lt(Y,H-ld(0)),A(X,Y+ld(0)),if(lt(Y,H*1.08-ld(0)),if(eq(PLANE,0),16,128),B(X,Y-(H*1.08-ld(0)))))",
    "blackflash": "st(0,pow(1-abs(2*P-1),3));((1-P)*A(X,Y)+P*B(X,Y))*(1-ld(0))+ld(0)*if(eq(PLANE,0),16,128)",
    # a hard cut hidden in a shake / in a white flash
    "shakecut": "st(0,sin(P*40)*W*0.03*(1-abs(2*P-1)));if(lt(P,0.5),A(X+ld(0),Y),B(X+ld(0),Y))",
    "flashcut": "st(0,exp(-((P-0.5)/0.12)*((P-0.5)/0.12)));if(lt(P,0.5),A(X,Y),B(X,Y))*(1-ld(0))+ld(0)*if(eq(PLANE,0),235,128)",
    # rows slide away one after another, each at its own moment
    "slicesslide": "st(5,floor(Y/(H/12)));st(4,clip((P-(sin((ld(5)*7+3)*12.9898)*43758.5453-floor(sin((ld(5)*7+3)*12.9898)*43758.5453))*0.4)/0.6,0,1));st(4,ld(4)*ld(4)*(3-2*ld(4)));if(lt(X,W*(1-ld(4))),A(X+W*ld(4),Y),B(X-W*(1-ld(4)),Y))",
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
