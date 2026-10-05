import json,re,sys,os,soundfile as sf,numpy as np
from kokoro_onnx import Kokoro
D=sys.argv[1]; os.chdir(D)
k=Kokoro('/tmp/kokoro/kokoro-v1.0.onnx','/tmp/kokoro/voices-v1.0.bin')
from kokoro_onnx.tokenizer import Tokenizer
tok=Tokenizer()
L=json.load(open('script.json')); V={'N':'af_heart','B':'am_michael'}
PHONEMES={'Schönberg':'ʃˈɜːnbɛɹk','do re mi':'dˈoʊ ɹˈɛ mˈiː'}
SR=24000; t=0.9; chunks=[]; lines=[]; subs=[]; prev=None
for l in L:
    # Pronunciation fixes via phoneme overrides (the English voice misreads these):
    # "Schönberg": no ø in English, so the closest vowel (ʃˈɜːn-) and a German-style ending (-bɛɹk);
    # "do re mi": solfège "doh, reh, mee", not "doo, ree, my".
    hit = next((w for w in PHONEMES if w in l['say']), None)
    if hit:
        ph = (' ' + PHONEMES[hit] + ' ').join(tok.phonemize(x, lang='en-us').strip() for x in l['say'].split(hit)).strip()
        print('phonemes:', ph)
        a,sr=k.create(ph,voice=V[l['sp']],speed=0.97 if l['sp']=='N' else 1.0,lang='en-us',is_phonemes=True)
    else:
        a,sr=k.create(l['say'],voice=V[l['sp']],speed=0.97 if l['sp']=='N' else 1.0,lang='en-us')
    t+=0 if prev is None else (0.55 if prev!=l['sp'] else 0.35)
    d=len(a)/sr
    lines.append({'sp':l['sp'],'scene':l['scene'],'start':round(t,3),'dur':round(d,3),'pause':l.get('pause',0)})
    chunks.append((t,a))
    parts=[p.strip() for p in re.split(r'(?<=[.?!])\s+',l['show']) if p.strip()]
    # A very short sentence ("Sure.") would flash by: show it together with the next one.
    for j in range(len(parts)-2,-1,-1):
        if len(parts[j])<8: parts[j:j+2]=[parts[j]+' '+parts[j+1]]
    n=sum(len(p) for p in parts); t0=t
    for p in parts:
        dd=d*len(p)/n; subs.append([round(t0,3),round(t0+dd,3),l['sp'],p]); t0+=dd
    t+=d+l.get('pause',0); prev=l['sp']
total=t+1.8
out=np.zeros(int(total*SR),dtype=np.float32)
for st,a in chunks: o=int(st*SR); out[o:o+len(a)]+=a
sf.write('narration.wav',out,SR,subtype='PCM_16')
json.dump({'lines':lines,'subs':subs,'total':total},open('timeline.json','w'),ensure_ascii=False)
print('total',round(total,1),[(i,x['scene'],x['start']) for i,x in enumerate(lines)])
