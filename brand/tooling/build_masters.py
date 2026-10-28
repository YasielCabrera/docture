"""Rebuild the cleaned G5 icon and semibold wordmark construction."""
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def ellipse(cx,cy,rx,ry):
    k=.552284749831
    return f'M{cx+rx} {cy}C{cx+rx} {cy+k*ry} {cx+k*rx} {cy+ry} {cx} {cy+ry}C{cx-k*rx} {cy+ry} {cx-rx} {cy+k*ry} {cx-rx} {cy}C{cx-rx} {cy-k*ry} {cx-k*rx} {cy-ry} {cx} {cy-ry}C{cx+k*rx} {cy-ry} {cx+rx} {cy-k*ry} {cx+rx} {cy}Z'


def wordmark():
    d='M53 0H66V92H53V84C47 90 40 93 31 93C13 93 0 79 0 59C0 40 13 26 31 26C40 26 47 29 53 36Z'+ellipse(33,59,20,21)
    o=ellipse(33,59,33,34)+ellipse(33,59,20,21)
    c='M64 44L51 48C48 41 42 38 33 38C21 38 13 47 13 59C13 72 21 81 33 81C42 81 48 77 51 70L64 73C60 86 49 93 33 93C13 93 0 79 0 59C0 40 13 26 33 26C48 26 59 33 64 44Z'
    t='M12 8H25V27H42V39H25V71C25 78 29 81 36 81H42V92C38 93 34 93 31 93C18 93 12 86 12 73V39H0V27H12Z'
    u='M0 27H13V65C13 76 17 81 26 81C39 81 46 73 46 60V27H59V92H46V84C40 90 32 93 23 93C8 93 0 84 0 68Z'
    r='M0 27H13V38C19 30 27 26 39 26H42V39H37C22 39 13 48 13 64V92H0Z'
    e='M62 61H13C14 74 21 82 33 82C41 82 47 79 51 72L62 77C57 87 47 93 33 93C13 93 0 80 0 59C0 39 13 26 32 26C51 26 62 39 62 58V61Z M13 51H49C47 42 41 37 32 37C22 37 16 42 13 51Z'
    paths=''.join(f'<path fill-rule="evenodd" d="{p}" transform="translate({x} 0)"/>' for x,p in zip([0,72,143,211,261,329,377],[d,o,c,t,u,r,e]))
    height=93*392/439
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 392 {height:.6f}"><g fill="currentColor" transform="scale({392/439:.9f})">{paths}</g></svg>\n'


def icon():
    channel='M71.2919 0H80.111L71.3412 15.9758C68.1078 21.866 69.1255 29.1804 73.8441 33.9641L91.0751 51.4331C97.3674 57.8124 96.8044 68.2227 89.8607 73.8861L40.6782 114H31.929L42.0335 95.6988C45.2996 89.7834 44.2684 82.4221 39.5028 77.6318L23.26 61.3047C16.9539 54.9659 17.4548 44.5798 24.3415 38.8772Z'
    left='M28 4C14 4 15 17 15 28C15 37 11 42 4 45.642633C11 49.285266 15 54 15 63C15 74 14 87.285266 28 87.285266'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 91.285266"><g fill="none" stroke="currentColor" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"><path d="{left}"/><path d="{left}" transform="translate(112 0) scale(-1 1)"/></g><path fill="currentColor" d="{channel}" transform="translate(15.5 5.742633) scale(.7)"/></svg>\n'


if __name__=='__main__':
    (ROOT/'masters'/'wordmark-artwork.svg').write_text(wordmark())
    (ROOT/'masters'/'icon-artwork.svg').write_text(icon())
    print('Built the G5 and semibold construction masters.')
