"""Generate the Docture brand kit from the reviewed vector masters."""
from pathlib import Path
from io import BytesIO
import base64
import hashlib
import html
import json
import re
import xml.etree.ElementTree as ET
import zipfile

from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from reportlab.pdfgen import canvas
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg
import resvg_py

ROOT = Path(__file__).resolve().parents[1]
INK = '#171717'
PAPER = '#FCFCFC'
ORANGE = '#BF4300'
AMBER = '#F99549'
MUTED = '#666666'
LINE = '#DEDAD5'
SW = 560
SH = 128
XMLNS = 'http://www.w3.org/2000/svg'


def body(path):
    text = path.read_text()
    return re.sub(r'^.*?<svg[^>]*>', '', text, count=1, flags=re.S).rsplit('</svg>', 1)[0]


ICON = body(ROOT/'masters'/'icon-artwork.svg')
WORD = body(ROOT/'masters'/'wordmark-artwork.svg')
WORD_H = float(ET.parse(ROOT/'masters'/'wordmark-artwork.svg').getroot().attrib['viewBox'].split()[3])
fonts = {name: TTFont(ROOT/'fonts'/file) for name, file in {
    'regular': 'geist-400.ttf', 'semibold': 'geist-600.ttf', 'mono': 'geist-mono-400.ttf'
}.items()}


def txt(text, x, y, size=16, color=INK, face='regular', spacing=0):
    font = fonts[face]
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size/font['head'].unitsPerEm
    cursor = 0
    paths = []
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        if pen.getCommands():
            paths.append(f'<path transform="translate({cursor:.4f} 0)" d="{pen.getCommands()}"/>')
        cursor += glyphs[name].width + spacing/scale
    return f'<g fill="{color}" transform="translate({x} {y}) scale({scale} {-scale})">'+''.join(paths)+'</g>'


def icon(x=0, y=0, size=128, color=ORANGE, micro=False):
    art = ICON.replace('stroke-width="7.5"', 'stroke-width="9"') if micro else ICON
    return f'<g style="color:{color}" transform="translate({x} {y}) scale({size/128})"><g transform="translate(8 18.357367)">{art}</g></g>'


def wordmark(x=0, y=0, width=392, color=INK):
    return f'<g style="color:{color}" transform="translate({x} {y}) scale({width/392})">{WORD}</g>'


def lockup(x=0, y=0, width=SW, mark=ORANGE, text=INK):
    return f'<g transform="translate({x} {y}) scale({width/SW})">'+icon(color=mark)+wordmark(152,(128-WORD_H)/2,color=text)+'</g>'


def svg(width, height, content, title, desc='', background=None):
    bg = f'<rect width="{width}" height="{height}" fill="{background}"/>' if background else ''
    description = f'<desc>{html.escape(desc)}</desc>' if desc else ''
    return f'<svg xmlns="{XMLNS}" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}"><title>{html.escape(title)}</title>{description}{bg}{content}</svg>\n'


def write(path, text):
    path = ROOT/path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def png(path, source, width=None, height=None, background=None):
    dest = ROOT/path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(resvg_py.svg_to_bytes(svg_string=source,width=width,height=height,background=background))
    return dest


def layouts(mark, text):
    return {
        'icon-micro': (128,128,icon(color=mark,micro=True)),
        'horizontal': (SW,SH,lockup(mark=mark,text=text)),
        'stacked': (424,254,icon(148,0,128,mark)+wordmark(16,154,392,text)),
        'wordmark': (424,WORD_H+32,wordmark(16,16,392,text)),
        'icon': (128,128,icon(color=mark)),
        'endorsed': (SW,158,lockup(mark=mark,text=text)+txt('by Powerhouse',152,148,17,text)),
    }


def make_logos():
    themes = {
        'primary': (ORANGE,INK), 'on-dark':(AMBER,PAPER), 'black':('#000000','#000000'),
        'white':('#FFFFFF','#FFFFFF'), 'brand':(ORANGE,ORANGE), 'current-color':('currentColor','currentColor')
    }
    for theme,(mark,text) in themes.items():
        for kind,(w,h,content) in layouts(mark,text).items():
            source = svg(w,h,content,f'Docture {kind} logo',f'G5 icon with the approved semibold outlined wordmark. {theme} variant.')
            write(Path('logos')/kind/f'docture-{kind}-{theme}.svg',source)
            if theme!='current-color':
                for width in ([16,24,32,48,64] if kind=='icon-micro' else [128,256,512,1024] if kind=='icon' else [560,1120,2240]):
                    png(Path('png')/kind/f'docture-{kind}-{theme}-{width}.png',source,width=width)


def make_favicons():
    art = icon(micro=True, color='currentColor')
    theme = '<style>svg{color:'+ORANGE+'}@media(prefers-color-scheme:dark){svg{color:'+AMBER+'}}</style>'
    write('favicons/favicon.svg',svg(128,128,theme+art,'Docture'))
    base=svg(128,128,icon(micro=True),'Docture',background=PAPER)
    for size in [16,32,48,96]:
        png(f'favicons/favicon-{size}x{size}.png',base,width=size)
    ico=Image.open(BytesIO(resvg_py.svg_to_bytes(svg_string=base,width=256))).convert('RGBA')
    ico.save(ROOT/'favicons'/'favicon.ico',sizes=[(16,16),(32,32),(48,48)])
    for size,name in [(180,'apple-touch-icon'),(192,'android-chrome-192x192'),(512,'android-chrome-512x512')]:
        png(f'favicons/{name}.png',svg(128,128,icon(8,8,112),'Docture',background=PAPER),width=size)
    maskable=svg(512,512,icon(96,96,320,PAPER),'Docture maskable app icon',background=ORANGE)
    png('favicons/maskable-icon-512x512.png',maskable)
    write('favicons/mask-icon.svg',svg(128,128,icon(color='#000000'),'Docture pinned tab'))
    manifest={
        'name':'Docture', 'short_name':'Docture', 'description':'Structured data from documents.',
        'start_url':'/', 'display':'standalone', 'theme_color':ORANGE, 'background_color':PAPER,
        'icons':[
            {'src':'android-chrome-192x192.png','sizes':'192x192','type':'image/png','purpose':'any'},
            {'src':'android-chrome-512x512.png','sizes':'512x512','type':'image/png','purpose':'any'},
            {'src':'maskable-icon-512x512.png','sizes':'512x512','type':'image/png','purpose':'maskable'},
        ]}
    write('favicons/site.webmanifest',json.dumps(manifest,indent=2)+'\n')
    write('favicons/head.html','''<!-- Copy this directory's public files into the site's public root. -->
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
<link rel="mask-icon" href="/mask-icon.svg" color="#BF4300">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#FCFCFC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171717" media="(prefers-color-scheme: dark)">
''')


def make_social():
    for theme,bg,mark,text in [('light',PAPER,ORANGE,INK),('dark',INK,AMBER,PAPER)]:
        for width,height,name in [(1200,630,'open-graph'),(1280,640,'github-social'),(1600,900,'presentation-cover')]:
            lw=width*.66
            content=lockup((width-lw)/2,height*.34,lw,mark,text)
            content+=txt('Structured data from documents.',width*.17,height*.64,width*.023,text)
            content+=txt('by Powerhouse',width*.17,height*.86,width*.015,text,'mono')
            source=svg(width,height,content,'Docture',background=bg)
            write(f'social/{name}-{theme}.svg',source)
            png(f'social/{name}-{theme}.png',source)
        avatar=svg(1024,1024,icon(128,128,768,mark),'Docture avatar',background=bg)
        write(f'social/avatar-{theme}.svg',avatar)
        png(f'social/avatar-{theme}.png',avatar)
    avatar=svg(1024,1024,icon(128,128,768,PAPER),'Docture avatar',background=ORANGE)
    write('social/avatar-brand.svg',avatar)
    png('social/avatar-brand.png',avatar)


def rect(x,y,w,h,fill,rx=0,stroke=None):
    border=f' stroke="{stroke}"' if stroke else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{border}/>'


def make_sheet():
    w,h=1440,1920
    a=[]
    a += [txt('DOCTURE',64,64,13,ORANGE,'mono',2),txt('Brand reference',64,126,46,INK,'semibold'),txt('G5 + semibold wordmark',64,159,18,MUTED),txt('01 / IDENTITY',1150,64,12,MUTED,'mono')]
    a += [rect(64,197,1312,274,'#F2EFEA',18),lockup(260,265,920)]
    a += [txt('01',64,526,13,ORANGE,'mono'),txt('Signature system',111,526,25,INK,'semibold')]
    a += [rect(64,551,640,240,PAPER,14,LINE),lockup(108,618,552),txt('Primary / light surfaces',88,763,14,MUTED)]
    a += [rect(728,551,648,240,INK,14),lockup(776,618,552,AMBER,PAPER),txt('Reverse / dark surfaces',752,763,14,'#BEBBB6')]
    a += [txt('02',64,848,13,ORANGE,'mono'),txt('Core palette',111,848,25,INK,'semibold')]
    swatches=[(ORANGE,'Burnt orange','#BF4300','Light accent / solid',PAPER),(AMBER,'Amber','#F99549','Dark accent',INK),(INK,'Ink','#171717','Wordmark / dark field',PAPER),(PAPER,'Paper','#FCFCFC','Light field / on solid',INK)]
    for i,(color,name,hexval,usage,fg) in enumerate(swatches):
        x=64+i*336
        a += [rect(x,874,304,118,color,12,LINE if color==PAPER else None),txt(name,x+18,913,19,fg,'semibold'),txt(hexval,x+18,947,17,fg,'mono'),txt(usage,x,1018,14,MUTED)]
    a += [txt('03',64,1087,13,ORANGE,'mono'),txt('Layouts and clear space',111,1087,25,INK,'semibold')]
    a += [rect(64,1114,408,267,'#F2EFEA',14),icon(196,1136,144),txt('Icon / compact placements',88,1352,14,MUTED)]
    a += [rect(496,1114,408,267,'#F2EFEA',14),wordmark(530,1212,340),txt('Wordmark / text-first placements',520,1352,14,MUTED)]
    a += [rect(928,1114,448,267,'#F2EFEA',14),rect(962,1176,380,132,'none',0,'#C7BFB5'),lockup(986,1200,332),txt('Keep 16 units clear on every side.',952,1352,14,MUTED)]
    a += [txt('04',64,1440,13,ORANGE,'mono'),txt('Type and scale',111,1440,25,INK,'semibold')]
    a += [wordmark(64,1469,190,INK),txt('The logo uses custom vector outlines.',64,1541,16,MUTED),txt('Geist / interfaces and headings',64,1581,22,INK,'semibold'),txt('Geist Mono / code and technical labels',64,1617,17,INK,'mono')]
    a += [icon(808,1472,16,micro=True),icon(864,1468,24),icon(928,1464,32),icon(1004,1456,48),icon(1100,1444,72),txt('16       24       32       48       72 px',804,1566,14,MUTED,'mono'),txt('Use the micro icon at 16-24 px.',804,1606,16,MUTED)]
    a += [rect(64,1670,1312,1,LINE),txt('Use',64,1713,18,INK,'semibold'),txt('Supplied proportions. Flat fills. Orange on light; amber on dark.',64,1745,16,MUTED),txt('Avoid',64,1791,18,INK,'semibold'),txt('Stretching, unapproved fonts, extra effects, or recoloring individual parts.',64,1823,16,MUTED),txt('Built by Powerhouse',64,1880,13,MUTED,'mono'),txt('Docture brand kit / 1.0',1112,1880,13,MUTED,'mono')]
    sheet=svg(w,h,''.join(a),'Docture brand sheet','G5 icon, semibold wordmark, palette, layouts, typography, and usage rules.',PAPER)
    write('brand-sheet.svg',sheet)
    png('brand-sheet.png',sheet)
    pdf=ROOT/'brand-sheet.pdf'
    drawing=svg2rlg(BytesIO(sheet.encode()))
    c=canvas.Canvas(str(pdf),pagesize=(w*.5,h*.5),pageCompression=1)
    c.setTitle('Docture brand sheet')
    c.setAuthor('Docture / Powerhouse')
    c.setSubject('G5 icon and approved semibold wordmark')
    c.scale(w*.5/drawing.width,h*.5/drawing.height)
    renderPDF.draw(drawing,c,0,0)
    c.showPage();c.save()
    return sheet


def make_tokens():
    data={'name':'Docture','version':'1.0.0','colors':{
        'brand':{'oklch':'oklch(0.55 0.17 41)','hex':ORANGE},
        'brandDark':{'oklch':'oklch(0.76 0.15 55)','hex':AMBER},
        'brandOnSolid':{'oklch':'oklch(0.99 0 0)','hex':PAPER},
        'ink':{'hex':INK},'paper':{'hex':PAPER}},
        'geometry':{'iconCanvas':128,'horizontalCanvas':[SW,SH],'clearSpace':16,'minimumHorizontalWidth':140,'minimumStandardIconSize':24,'minimumMicroIconSize':16},
        'typography':{'logo':'Custom outlined semibold wordmark','interface':'Geist','code':'Geist Mono'}}
    write('tokens/brand.json',json.dumps(data,indent=2)+'\n')
    write('tokens/brand.css',''':root {
  --docture-brand: oklch(0.55 0.17 41);
  --docture-brand-solid: oklch(0.55 0.17 41);
  --docture-brand-on-solid: oklch(0.99 0 0);
  --docture-ink: #171717;
  --docture-paper: #FCFCFC;
  --docture-font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --docture-font-mono: "Geist Mono", ui-monospace, monospace;
}
[data-theme="dark"], .dark {
  --docture-brand: oklch(0.76 0.15 55);
}
''')
    palette={'metadata':{'name':'Docture'},'colors':[]}
    for name,color in [('Burnt orange',ORANGE),('Amber',AMBER),('Ink',INK),('Paper',PAPER)]:
        palette['colors'].append({'name':name,'hex':color})
    write('tokens/palette.json',json.dumps(palette,indent=2)+'\n')
    gpl='GIMP Palette\nName: Docture\nColumns: 4\n#\n'
    for color,name in [(ORANGE,'Burnt orange'),(AMBER,'Amber'),(INK,'Ink'),(PAPER,'Paper')]:
        rgb=[int(color[i:i+2],16) for i in [1,3,5]]
        gpl+=' '.join(str(v) for v in rgb)+'\t'+name+'\n'
    write('tokens/docture.gpl',gpl)


def make_gallery(sheet):
    previews=[]
    for name in ['primary','on-dark','black','white','brand']:
        bg=INK if name in ['on-dark','white'] else PAPER
        logo=(ROOT/f'logos/horizontal/docture-horizontal-{name}.svg').read_text()
        previews.append(f'<div class="sample" style="background:{bg}">{logo}<small>{name}</small></div>')
    fontcss=''
    for face in ['geist-400','geist-600']:
        data=base64.b64encode((ROOT/f'fonts/{face}.ttf').read_bytes()).decode()
        weight=face.rsplit('-',1)[1]
        fontcss+=f'@font-face{{font-family:Geist;src:url(data:font/ttf;base64,{data});font-weight:{weight}}}'
    css='''*{box-sizing:border-box}html,body{margin:0}body{font-family:Geist,var(--font-sans,Arial,sans-serif);color:var(--foreground,#eee)}.sheet>svg{width:100%;height:auto;display:block;border-radius:var(--radius,12px)}.samples{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.sample{padding:24px 18px;border-radius:var(--radius,12px)}.sample>svg{width:100%;height:auto;display:block}.sample small{display:block;font-size:10px;color:#888;margin-top:12px}.sample:last-child{grid-column:1/-1}.title{font-size:12px;letter-spacing:.08em;color:var(--muted-foreground,#999);margin:0 0 16px}@media(max-width:520px){.samples{grid-template-columns:1fr}}'''
    inline=f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Docture brand kit</title><style>{fontcss}{css}</style></head><body><p class="title">DOCTURE / BRAND KIT 1.0</p><div class="sheet">{sheet}</div><div class="samples">'+''.join(previews)+'</div></body></html>'
    write('brand-preview.html',inline)
    standalone=inline.replace('</head>','<style>body{max-width:1100px;margin:auto;padding:32px;background:#111;color:#eee}</style></head>')
    write('brand-sheet.html',standalone)


def make_inventory():
    files=[]
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file() or path.suffix=='.zip' or path.name in ['manifest.json','verification.json'] or '__pycache__' in path.parts:
            continue
        data=path.read_bytes()
        files.append({'path':path.relative_to(ROOT).as_posix(),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    write('manifest.json',json.dumps({'brand':'Docture','version':'1.0.0','files':files},indent=2)+'\n')


def archive():
    with zipfile.ZipFile(ROOT/'docture-brand-kit.zip','w',zipfile.ZIP_DEFLATED) as z:
        for path in sorted(ROOT.rglob('*')):
            if path.is_file() and path.suffix!='.zip' and '__pycache__' not in path.parts:
                z.write(path,'docture-brand-kit/'+path.relative_to(ROOT).as_posix())


def main():
    if '--archive-only' in __import__('sys').argv:
        archive()
        print('Archived the existing verified kit.')
        return
    make_logos();make_favicons();make_social();make_tokens()
    sheet=make_sheet();make_gallery(sheet);make_inventory()
    if '--archive' in __import__('sys').argv:archive()
    print('Generated Docture brand kit in',ROOT)


if __name__=='__main__':main()
