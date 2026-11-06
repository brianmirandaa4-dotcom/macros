# tail. brand marks: seal (in-app), lockup "tail." (header banner), flip-sequence (home-screen icon)
GOLD="#E7C46A"; GOLD_D="#B98F3A"; PURP="#2B1466"; PURP_D="#1C0E3D"; INK="#0E0D12"; TDARK="#5B3B10"
# the logo-2 t: tall stem, foot hooks right, crossbar tilts up
T = lambda w,c: f'<g fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"><path d="M46 19 V63 Q46 78 61 78 L69 76"/><path d="M29 44 L72 36.5"/></g>'
def seal(ring=3.6):
    return f'<circle cx="50" cy="50" r="44" fill="{PURP}"/><circle cx="50" cy="50" r="{44-ring/2}" fill="none" stroke="{GOLD}" stroke-width="{ring}"/>'+T(11,GOLD)
open("seal.svg","w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{seal()}</svg>')
# lockup: seal + "ail." drawn as strokes (clean straight stems, variant B), cap height ~ seal
ail = (f'<g fill="none" stroke="{GOLD}" stroke-width="9.5" stroke-linecap="round">'
       '<circle cx="128" cy="62" r="17"/><path d="M145 46 V79"/>'          # a
       '<path d="M168 48 V79"/>'                                             # i stem
       '<path d="M190 20 V79"/></g>'                                         # l
       f'<circle cx="168" cy="29" r="6" fill="{GOLD}"/><circle cx="210" cy="78" r="6" fill="{GOLD}"/>')  # i dot, period
open("lockup.svg","w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 100">{seal()}{ail}</svg>')
# flip-sequence icon: tilted gold coin, engraved t, motion trails, deep violet
def coin():
    face = (f'<circle r="27" fill="{GOLD}"/><circle r="20.5" fill="none" stroke="{GOLD_D}" stroke-width="2.6"/>'
            f'<g transform="translate(-50,-50) scale(.55) translate(41,41)">{T(12,TDARK)}</g>')
    return (f'<g transform="translate(64,40) rotate(-24) scale(1,.52)">'
            f'<g transform="translate(0,9)"><circle r="27" fill="{GOLD_D}"/></g>'
            f'<rect x="-27" y="0" width="54" height="9" fill="{GOLD_D}"/>{face}'
            f'<path d="M-19 -15 A24 24 0 0 1 10 -24" stroke="#FFF3C8" stroke-opacity=".55" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>')
icon = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>'
        f'<radialGradient id="bg" cx=".7" cy=".3" r="1"><stop offset="0" stop-color="#2A1559"/><stop offset="1" stop-color="{PURP_D}"/></radialGradient>'
        '<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>'
        '<rect width="100" height="100" fill="url(#bg)"/>'
        f'<g filter="url(#b)"><ellipse cx="40" cy="58" rx="18" ry="7" transform="rotate(-24 40 58)" fill="{GOLD}" fill-opacity=".38"/>'
        f'<ellipse cx="26" cy="71" rx="15" ry="4.5" transform="rotate(-24 26 71)" fill="{GOLD}" fill-opacity=".2"/></g>'
        f'{coin()}</svg>')
open("icon.svg","w").write(icon)
# maskable: same art, coin pulled toward centre safe zone
open("icon-mask.svg","w").write(icon.replace('translate(64,40)','translate(58,46)'))
