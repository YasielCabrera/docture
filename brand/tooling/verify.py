"""Verify the actual vector, bitmap, favicon, and PDF deliverables."""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image
from pypdf import PdfReader
import numpy as np
import resvg_py

ROOT=Path(__file__).resolve().parents[1]
NS='{http://www.w3.org/2000/svg}'


def check(condition,message):
    if not condition:raise AssertionError(message)


def luminance(hexval):
    rgb=[int(hexval[i:i+2],16)/255 for i in (1,3,5)]
    linear=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    return sum(a*b for a,b in zip(linear,[.2126,.7152,.0722]))


def main():
    svgfiles=list(ROOT.rglob('*.svg'))
    pngfiles=list(ROOT.rglob('*.png'))
    for path in svgfiles:
        root=ET.parse(path).getroot()
        view=list(map(float,root.attrib['viewBox'].split()))
        check(len(view)==4 and all(math.isfinite(v) for v in view) and min(view[2:])>0,f'Invalid canvas: {path}')
        for node in root.iter():
            tag=node.tag.rsplit('}',1)[-1]
            check(tag not in ['script','image','foreignObject','text'],f'Non-outline content: {path}: {tag}')
            for key,val in node.attrib.items():
                check(not key.startswith('on'),f'Event handler: {path}')
                if key.rsplit('}',1)[-1] in ['href','src']:
                    check(val.startswith('#'),f'External reference: {path}')
        rendered=Image.open(BytesIO(resvg_py.svg_to_bytes(svg_string=path.read_text(),width=256))).convert('RGBA')
        check(rendered.getchannel('A').getbbox() is not None,f'Empty SVG render: {path}')
    for path in pngfiles:
        im=Image.open(path)
        im.verify()
        with Image.open(path) as im:
            check(min(im.size)>0,f'Empty PNG: {path}')
            if 'png' in path.relative_to(ROOT).parts:
                expected=int(path.stem.rsplit('-',1)[1])
                check(im.width==expected,f'Incorrect PNG width: {path}')
                alpha=im.convert('RGBA').getchannel('A')
                check(alpha.getextrema()==(0,255),f'Logo transparency: {path}')
                bbox=alpha.getbbox()
                if im.width>=128:
                    check(bbox[0]>0 and bbox[1]>0 and bbox[2]<im.width and bbox[3]<im.height,f'Clipped logo: {path}: {bbox}, {im.size}')
            if path.parent.name=='social':
                size=next(value for key,value in [('open-graph',(1200,630)),('github-social',(1280,640)),('presentation-cover',(1600,900)),('avatar',(1024,1024))] if path.name.startswith(key))
                check(im.size==size,f'Social dimensions: {path}')
    ico=Image.open(ROOT/'favicons'/'favicon.ico')
    check(ico.ico.sizes()=={(16,16),(32,32),(48,48)},'ICO must contain 16, 32, and 48 px frames')
    for size in [16,32,48,96]:
        check(Image.open(ROOT/f'favicons/favicon-{size}x{size}.png').size==(size,size),'Incorrect favicon PNG size')
    for file,size in [('apple-touch-icon.png',180),('android-chrome-192x192.png',192),('android-chrome-512x512.png',512),('maskable-icon-512x512.png',512)]:
        check(Image.open(ROOT/'favicons'/file).size==(size,size),f'App icon size: {file}')
    manifest=json.loads((ROOT/'favicons'/'site.webmanifest').read_text())
    for item in manifest['icons']:
        check((ROOT/'favicons'/item['src']).is_file(),'Manifest icon missing')
    mask=np.array(Image.open(ROOT/'favicons'/'maskable-icon-512x512.png').convert('RGB'))
    y,x=np.where((mask.min(axis=2)>220))
    check(np.max((x-256)**2+(y-256)**2)<(512*.4)**2,'Maskable artwork leaves the safe circle')
    for theme in ['primary','on-dark','black','white','brand','current-color']:
        for layout in ['horizontal','stacked','icon','icon-micro','wordmark','endorsed']:
            check((ROOT/f'logos/{layout}/docture-{layout}-{theme}.svg').is_file(),f'Missing {layout} {theme}')
    colorcss=(ROOT/'tokens'/'brand.css').read_text()
    docscss=(ROOT.parent/'apps/docs/app/global.css')
    tokens=['oklch(0.55 0.17 41)','oklch(0.76 0.15 55)','oklch(0.99 0 0)']
    check(all(t in colorcss for t in tokens),'Missing authoritative palette token')
    if docscss.exists():
        docs_palette=docscss.read_text()
        if '@import "./brand.css";' in docs_palette:
            docs_palette+=docscss.with_name('brand.css').read_text()
        check(all(t in docs_palette for t in tokens),'Palette differs from current docs')
    ratios={}
    for name,fg,bg in [('orange-on-paper','#BF4300','#FCFCFC'),('amber-on-ink','#F99549','#171717'),('paper-on-orange','#FCFCFC','#BF4300'),('ink-on-paper','#171717','#FCFCFC')]:
        a,b=sorted([luminance(fg),luminance(bg)])
        ratio=(b+.05)/(a+.05)
        check(ratio>=3,f'Insufficient logo contrast: {name}')
        ratios[name]=round(ratio,2)
    pdf=PdfReader(ROOT/'brand-sheet.pdf')
    check(len(pdf.pages)==1,'Brand sheet must be one page')
    check(tuple(float(pdf.pages[0].mediabox[i]) for i in [2,3])==(720,960),'Unexpected PDF page size')
    check(shutil.which('pdftoppm'),'PDF verification needs Poppler pdftoppm')
    with tempfile.TemporaryDirectory() as tmp:
        target=Path(tmp)/'sheet'
        subprocess.run(['pdftoppm','-scale-to','1440','-singlefile','-png',str(ROOT/'brand-sheet.pdf'),str(target)],check=True,capture_output=True)
        rendered=Image.open(target.with_suffix('.png')).convert('RGB')
        expected=Image.open(ROOT/'brand-sheet.png').convert('RGB').resize(rendered.size,Image.Resampling.LANCZOS)
        difference=np.abs(np.array(rendered).astype(float)-np.array(expected).astype(float))
        check(difference.mean()<3,'PDF rendering does not match the SVG/PNG sheet')
    for license in ['OFL-geist.txt','OFL-geistmono.txt']:
        check('SIL OPEN FONT LICENSE' in (ROOT/'fonts'/license).read_text(),'Missing original font license')
    inventory=json.loads((ROOT/'manifest.json').read_text())
    for item in inventory['files']:
        path=ROOT/item['path']
        check(path.exists(),f'Inventory path missing: {path}')
        check(hashlib.sha256(path.read_bytes()).hexdigest()==item['sha256'],f'Stale checksum: {path}')
    report={'status':'passed','svgFilesRendered':len(svgfiles),'pngFilesOpened':len(pngfiles),
        'checks':['Outlined SVGs render without external dependencies','All color and layout variants exist','Transparent logo PNGs are unclipped','Raster dimensions match filenames and placement templates','ICO frames and manifest icon paths are valid','Maskable artwork stays inside the safe circle','Palette matches the documentation tokens when source is present','PDF page size and actual rendering match the brand sheet','Supporting font licenses are included','Inventory checksums match the delivered files'],
        'graphicContrastRatios':ratios,'notes':['Logo lettering is a geometric reconstruction of the approved raster concept.','The deployed website assets are checked separately with the documentation app asset check.']}
    (ROOT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
