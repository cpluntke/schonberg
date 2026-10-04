const { chromium } = require('/home/user/schonberg/node_modules/@playwright/test'); const { spawn } = require('child_process'); const fs=require('fs');
const D=process.argv[2], OUT=process.argv[3], STILLS=process.argv[4];
const TL=JSON.parse(fs.readFileSync(D+'/timeline.json','utf8'));
fs.writeFileSync(D+'/video_r.html', fs.readFileSync(D+'/video.html','utf8').replace('__TIMELINE__', JSON.stringify(TL)));
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--allow-file-access-from-files']}); const p=await b.newPage({viewport:{width:1280,height:720}});
 const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto('file://'+D+'/video_r.html'); await p.evaluate(()=>window.ready);
 if(STILLS){ for(const t of STILLS.split(',').map(Number)){ await p.evaluate(t=>renderAt(t),t); await p.screenshot({path:`${D}/still_${t}.png`}); } console.log('errors',errs); await b.close(); return; }
 const FPS=30, N=Math.ceil(TL.total*FPS);
 const ff=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(FPS),'-c:v','mjpeg','-i','-','-i',D+'/narration.wav',
   '-c:v','libx264','-preset','slow','-crf','26','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-shortest','-movflags','+faststart',OUT],{stdio:['pipe','inherit','inherit']});
 for(let i=0;i<N;i++){
   const d=await p.evaluate(t=>{renderAt(t);return document.getElementById('c').toDataURL('image/jpeg',0.92);}, i/FPS);
   const buf=Buffer.from(d.split(',')[1],'base64'); if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));
 }
 ff.stdin.end(); await new Promise(r=>ff.on('close',r)); await b.close(); console.log('frames',N,'errors',errs);
})();
