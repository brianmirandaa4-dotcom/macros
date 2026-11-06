# tail. brand marks: seal (in-app), lockup "tail." (header banner), flip-sequence (home-screen icon)
GOLD="#FFFFFF"; GOLD_D="#8E8E95"; PURP="#FFFFFF"; PURP_D="#000000"; INK="#000000"; TDARK="#111114"
# the logo-2 t: tall stem, foot hooks right, crossbar tilts up
T = lambda w,c: f'<g fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"><path d="M46 19 V63 Q46 78 61 78 L69 76"/><path d="M29 44 L72 36.5"/></g>'
def seal(ring=3.6):
    return f'<circle cx="50" cy="50" r="44" fill="#FFFFFF"/>'+T(11,'#000000')
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
    face = (f'<circle r="27" fill="url(#face)"/><circle r="20.5" fill="none" stroke="#9C9CA3" stroke-width="2.6"/>'
            f'<g transform="translate(-50,-50) scale(.55) translate(41,41)">{T(12,TDARK)}</g>')
    return (f'<g transform="translate(64,40) rotate(-24) scale(1,.52)">'
            f'<g transform="translate(0,9)"><circle r="27" fill="{GOLD_D}"/></g>'
            f'<rect x="-27" y="0" width="54" height="9" fill="{GOLD_D}"/>{face}'
            f'<path d="M-19 -15 A24 24 0 0 1 10 -24" stroke="#FFFFFF" stroke-opacity=".9" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>')
icon = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>'
        f'<radialGradient id="bg" cx=".72" cy=".28" r="1"><stop offset="0" stop-color="#26262B"/><stop offset=".6" stop-color="#0A0A0C"/><stop offset="1" stop-color="#000"/></radialGradient><linearGradient id="face" x1="0" y1="-1" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#E4E4E8"/><stop offset="1" stop-color="#B9B9C0"/></linearGradient>'
        '<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter></defs>'
        '<rect width="100" height="100" fill="url(#bg)"/>'
        f'<g filter="url(#b)"><ellipse cx="40" cy="58" rx="18" ry="7" transform="rotate(-24 40 58)" fill="#FFFFFF" fill-opacity=".22"/>'
        f'<ellipse cx="26" cy="71" rx="15" ry="4.5" transform="rotate(-24 26 71)" fill="#FFFFFF" fill-opacity=".1"/></g>'
        f'{coin()}</svg>')
open("icon.svg","w").write(icon)
# maskable: same art, coin pulled toward centre safe zone
open("icon-mask.svg","w").write(icon.replace('translate(64,40)','translate(58,46)'))
