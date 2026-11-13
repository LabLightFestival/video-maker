'use strict';
const $=id=>document.getElementById(id);
const video=$('source'),previewPlayer=$('preview-player'),previewPlay=$('preview-play'),teacher=$('teacher-source'),outro=$('outro'),canvas=$('canvas'),ctx=canvas.getContext('2d');
const fields=['province','region','teachers','subject'].map($);
const form=$('form'),button=$('generate'),cancel=$('cancel'),status=$('status'),wrap=$('progress-wrap'),bar=$('bar'),percent=$('percent'),result=$('result'),download=$('download'),resultVideo=$('result-video'),playbackNote=$('playback-note'),upload=$('teacher-video'),timeLimit=$('time-limit'),fileInfo=$('file-info'),introDownload=$('intro-download'),introStatus=$('intro-download-status'),introCancel=$('intro-download-cancel'),introReady=$('intro-download-ready'),introScreenHint=$('intro-screen-hint');
// The final four-second still is already part of the intro video, with its music.
// Recording runs in real time, so scene start-up, seeks and flush delays add to the output length;
// RECORD_OVERHEAD_SECONDS keeps a maximum-length upload from tipping over the 5-minute cap.
const HOLD=0, MAX_SECONDS=300, MAX_EXPERIMENT_SECONDS=265, RECORD_OVERHEAD_SECONDS=5, MAX_BYTES=100000000;
// The recorder needs real frames before playback starts (otherwise the first moments are blank), and the Web Audio
// to MediaRecorder path lags behind the video, so the very end needs extra time for the last music to arrive.
const PREROLL_MS=400, END_TAIL_MS=1000, EXTRA_RECORD_SECONDS=(PREROLL_MS+END_TAIL_MS)/1000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function preRoll(stream){
 const track=stream.getVideoTracks()[0],end=performance.now()+PREROLL_MS;
 while(performance.now()<end&&!stopRequested){render(false);try{track&&track.requestFrame&&track.requestFrame()}catch(e){}await sleep(33)}
}
// Metadata known at build time: keeps the upload duration check available without fetching either video.
const INTRO_SECONDS=24.066426, OUTRO_SECONDS=5;

// همان منطق سایت مرجع: توقف پس از رسیدن به آغاز دور بعدی.
const coinStage=$('reference-coin');
let coinSpinning=true,coinStopPending=false,coinTick=0;
function coinAnimations(){return coinStage.getAnimations({subtree:true}).filter(a=>(a.animationName||'').startsWith('logo-coin'))}
coinStage.addEventListener('click',()=>{
 const anims=coinAnimations();if(!anims.length)return;
 if(coinSpinning){
  coinStopPending=true;coinSpinning=false;coinStage.setAttribute('aria-pressed','false');
  let lastT=-1;
  function waitForFullTurn(){
   if(!coinStopPending)return;
   const running=coinAnimations();const main=running.find(a=>a.animationName==='logo-coin-turn');if(!main)return;
   const duration=Number(main.effect?.getComputedTiming().duration)||11000;
   const t=(Number(main.currentTime)||0)%duration;
   if(lastT>=0&&t<lastT){
    running.forEach(a=>{a.pause();a.currentTime=Math.floor((Number(a.currentTime)||0)/duration)*duration});
    coinStopPending=false;coinStage.title='برای ادامه چرخش کلیک کنید';return;
   }
   lastT=t;coinTick=requestAnimationFrame(waitForFullTurn);
  }
  coinStage.title='لوگو در پایان دور ثابت می‌شود';coinTick=requestAnimationFrame(waitForFullTurn);
 }else{
  coinStopPending=false;cancelAnimationFrame(coinTick);anims.forEach(a=>a.play());coinSpinning=true;coinStage.setAttribute('aria-pressed','true');coinStage.title='برای توقف در پایان دور کلیک کنید';
 }
});

let recording=false,stopRequested=false,recorder=null,audioCtx=null,audioDest=null,audioSources=[],resultUrl=null,uploadUrl=null,sizeExceeded=false,timeExceeded=false,raf=0;
let previewActive=false,previewPlaying=false,previewRaf=0,previewHoldStart=null,previewHoldElapsed=0,previewToken=0;
let introMode=false,introUrl=null,loadingController=null;
let wakeSentinel=null,wakeRequesting=false;
async function keepScreenAwake(){
 if(!recording||document.visibilityState!=='visible'||!navigator.wakeLock||wakeSentinel||wakeRequesting)return;
 wakeRequesting=true;
 try{const lock=await navigator.wakeLock.request('screen');if(!recording){await lock.release()}else{wakeSentinel=lock;lock.addEventListener('release',()=>{if(wakeSentinel===lock)wakeSentinel=null},{once:true})}}catch(e){}finally{wakeRequesting=false}
}
async function releaseWakeLock(){const lock=wakeSentinel;wakeSentinel=null;if(lock){try{await lock.release()}catch(e){}}}
document.addEventListener('visibilitychange',()=>{if(recording&&document.visibilityState==='visible')void keepScreenAwake()});
const fontReady=document.fonts.load('700 27px BTitr');
const poster=new Image();poster.src='preview.jpg?v=new-intro-19';poster.onload=()=>{if(!recording&&!previewActive)render()};
// A non-black frame from the opening fade keeps the first captured frame visible.
const firstFrame=new Image();firstFrame.src='start-frame.jpg?v=32';
const fa=n=>Math.round(n).toLocaleString('fa-IR');
function timeString(s){s=Math.max(0,Math.floor(s));return `${fa(Math.floor(s/60))} دقیقه و ${fa(s%60)} ثانیه`}
function roundedRect(x,y,w,h,r){
 ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
// Match the original rows: the pill and label fade in with the template boxes,
// then the red year enters in sequence with the other user details.
function drawSchoolYearBox(frame,animated,part='both'){
 const t=frame.currentTime||0, y=693;
 const boxRaw=animated?Math.max(0,Math.min(1,(t-17.65)/.85)):1;
 const textRaw=animated?Math.max(0,Math.min(1,(t-18.4-4*.16)/.65)):1;
 if(part!=='text'&&boxRaw>0){
  ctx.save();ctx.globalAlpha=boxRaw;
  ctx.save();roundedRect(380,y-24,514,48,23);ctx.clip();
  if(poster.complete&&poster.naturalWidth){
   // Sample a clean, text-free section of the original subject pill.
   ctx.drawImage(poster,400,615,225,46,380,y-24,514,48);
  }else{
   const gradient=ctx.createLinearGradient(0,y-24,0,y+24);
   gradient.addColorStop(0,'#eeeadd');gradient.addColorStop(1,'#d8d5c9');ctx.fillStyle=gradient;ctx.fillRect(380,y-24,514,48);
  }
  ctx.restore();ctx.textBaseline='middle';ctx.font='700 27px BTitr, Tahoma, sans-serif';ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#203e25';ctx.fillText('سال تحصیلی:',875,y+1);
  ctx.translate(919,y);ctx.strokeStyle='#b39b49';ctx.lineWidth=1.5;
  for(const angle of [0,Math.PI/3,-Math.PI/3]){ctx.beginPath();ctx.ellipse(0,0,17,7.5,angle,0,2*Math.PI);ctx.stroke()}
  ctx.beginPath();ctx.arc(0,0,4.1,0,2*Math.PI);ctx.fillStyle='#557735';ctx.fill();ctx.strokeStyle='#d6bc63';ctx.stroke();ctx.restore();
 }
 if(part!=='box'&&textRaw>0){
  const eased=1-Math.pow(1-textRaw,3);ctx.save();ctx.globalAlpha=eased;ctx.textBaseline='middle';ctx.font='700 27px BTitr, Tahoma, sans-serif';
  ctx.fillStyle='#cf2029';ctx.direction='ltr';ctx.textAlign='left';ctx.shadowColor='rgba(110,12,20,0.18)';ctx.shadowBlur=2;
  ctx.fillText('۱۴۰۵ - ۱۴۰۶',580,y+1+(1-eased)*6);ctx.restore();
 }
}
function render(showText=true,animated=false,previewFrame=null){
 const frame=previewFrame||video;
 if((previewFrame||recording)&&frame.currentTime<0.3){
  if(firstFrame.complete&&firstFrame.naturalWidth)ctx.drawImage(firstFrame,0,0,1280,720);
  else{ctx.fillStyle='#f1ece0';ctx.fillRect(0,0,1280,720)}
 }else if(previewFrame){if(frame.readyState<2)return;ctx.drawImage(frame,0,0,1280,720);}
 else if(!recording&&poster.complete&&poster.naturalWidth)ctx.drawImage(poster,0,0,1280,720);
 else {if(frame.readyState<2)return;ctx.drawImage(frame,0,0,1280,720);}
 if(showText||animated)drawSchoolYearBox(frame,animated);
 if(!showText)return;
 ctx.save();ctx.direction='rtl';ctx.textAlign='right';ctx.textBaseline='middle';
 const labels=['استان:','منطقه:','نام دبیر / دبیران:','موضوع آزمایش:'];
 fields.forEach((field,i)=>{
  const text=field.value.trim().replace(/\s+/g,' ');if(!text)return;
  // Fade and slide each line gently into its own box, in sequence.
  const raw=animated?Math.max(0,Math.min(1,(frame.currentTime-18.4-i*0.16)/0.65)):1;
  if(raw<=0)return;
  const eased=1-Math.pow(1-raw,3);
  const x=[794,794,670,687][i], y=[461,519,578,637][i];
  ctx.save();ctx.globalAlpha=eased;
  let size=27;ctx.font=`700 ${size}px BTitr, Tahoma, sans-serif`;
  let width=ctx.measureText(text).width;
  // The original pill begins at x=380. Expand it leftwards only when needed.
  const initialWidth=x-400;
  let left=380;
  if(width>initialWidth){
   left=Math.max(18,Math.min(380,x-width-22));
   const available=x-left-18;
   while(width>available&&size>16){size--;ctx.font=`700 ${size}px BTitr, Tahoma, sans-serif`;width=ctx.measureText(text).width;}
   // Replace the original bar with a wider, matching rounded pill, and redraw its original label.
   const gradient=ctx.createLinearGradient(0,y-24,0,y+24);
   gradient.addColorStop(0,'#eeeadd');gradient.addColorStop(1,'#d8d5c9');
   roundedRect(left,y-24,892-left,48,23);ctx.fillStyle=gradient;ctx.fill();
   ctx.fillStyle='#203e25';ctx.font='700 27px BTitr, Tahoma, sans-serif';
   ctx.fillText(labels[i],875,y+1);
  }
  ctx.fillStyle='#cf2029';ctx.font=`700 ${size}px BTitr, Tahoma, sans-serif`;
  // A maximum width prevents unusually long text from crossing the edge of the box.
  ctx.shadowColor='rgba(110,12,20,0.18)';ctx.shadowBlur=2;
  ctx.fillText(text,x,y+1+(1-eased)*6,x-left-18);
  ctx.restore();
 });
 ctx.restore();
}
async function seek(el,t){
 if(Math.abs(el.currentTime-t)<.02&&el.readyState>=2)return;
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('آماده‌سازی ویدیو بیش از حد طول کشید.'))},15000);const done=()=>{cleanup();resolve()};const fail=()=>{cleanup();reject(new Error('خطا در خواندن ویدیو.'))};function cleanup(){clearTimeout(timer);el.removeEventListener('seeked',done);el.removeEventListener('error',fail)}el.addEventListener('seeked',done,{once:true});el.addEventListener('error',fail,{once:true});el.currentTime=t;});
}
async function preview(){if(recording)return;if(previewActive)render(previewPlayer.currentTime>=18.4||previewPlayer.ended,true,previewPlayer);else render()}
function clipLength(el,fallback){return Number.isFinite(el.duration)&&el.duration>0?el.duration:fallback}
function maxTeacherDuration(){return Math.min(MAX_EXPERIMENT_SECONDS,Math.max(0,MAX_SECONDS-clipLength(video,INTRO_SECONDS)-clipLength(outro,OUTRO_SECONDS)-HOLD-RECORD_OVERHEAD_SECONDS))}
function startClipLoading(el){if(!el.hasAttribute('src')){el.preload='auto';el.src=el.dataset.src;el.load()}}
function ensureClip(el,signal){
 if(signal?.aborted)return Promise.reject(new DOMException('لغو شد','AbortError'));
 if(el.hasAttribute('src')&&el.readyState>=2&&!el.error)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let timer;
  const cleanup=()=>{clearTimeout(timer);el.removeEventListener('loadeddata',ready);el.removeEventListener('error',fail);signal?.removeEventListener('abort',abort)};
  const resetStatic=()=>{if(el.dataset.src){el.removeAttribute('src');el.load()}};
  const ready=()=>{cleanup();resolve()};
  const fail=()=>{cleanup();resetStatic();reject(new Error(el===teacher?'خواندن ویدیوی آزمایش ممکن نشد؛ فایل دیگری را امتحان کنید.':'بارگذاری سکانس آماده انجام نشد؛ اتصال اینترنت را بررسی کنید.'))};
  const abort=()=>{cleanup();if(el.readyState<2)resetStatic();reject(new DOMException('لغو شد','AbortError'))};
  el.addEventListener('loadeddata',ready,{once:true});el.addEventListener('error',fail,{once:true});signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{cleanup();resetStatic();reject(new Error('بارگذاری ویدیو بیش از حد طول کشید؛ اتصال اینترنت یا فایل را بررسی کنید.'))},90000);
  el.preload='auto';
  if(el.dataset.src&&(!el.hasAttribute('src')||el.error)){resetStatic();startClipLoading(el)}
  else if(el.hasAttribute('src'))el.load();
  else{cleanup();reject(new Error('فایل ویدیو انتخاب نشده است.'));return}
  if(el.readyState>=2)ready();
 });
}
function checkUpload(){
 const max=maxTeacherDuration();
 if(max===null){timeLimit.textContent='در حال محاسبه حداکثر مدت مجاز ویدیوی آزمایش...';upload.setCustomValidity('ابتدا باید ویدیوهای آغازین و پایانی آماده شوند.');return false}
 timeLimit.textContent=`حداکثر مدت مجاز ویدیوی آزمایش: ${timeString(max)}. با احتساب سکانس آغازین ۲۰ ثانیه، مکث ۴ ثانیه و سکانس پایانی ۵ ثانیه.`;
 if(!upload.files.length){upload.setCustomValidity('');fileInfo.textContent='';return false}
 if(!Number.isFinite(teacher.duration)||teacher.duration<=0||!teacher.videoWidth){upload.setCustomValidity('مدت ویدیوی آزمایش هنوز مشخص نیست یا فایل قابل پخش نیست.');return false}
 if(teacher.duration>Math.floor(max)){
  const msg=`مدت ویدیوی شما ${timeString(teacher.duration)} است و از حد مجاز ${timeString(max)} بیشتر است. لطفاً ویدیوی کوتاه‌تری انتخاب کنید.`;
  upload.setCustomValidity(msg);fileInfo.className='file-info error';fileInfo.textContent=msg;return false;
 }
 upload.setCustomValidity('');fileInfo.className='file-info';fileInfo.textContent=`مدت ویدیوی آزمایش: ${timeString(teacher.duration)} · مجموع تقریبی: ${timeString(clipLength(video,INTRO_SECONDS)+HOLD+teacher.duration+clipLength(outro,OUTRO_SECONDS))} از ۵ دقیقه`;return true;
}
fields.forEach(f=>f.addEventListener('input',()=>{if(f.tagName==='INPUT')f.setCustomValidity(f.value&&!f.value.trim()?'این فیلد نمی‌تواند فقط فاصله باشد.':'');if(!recording){if(introUrl){URL.revokeObjectURL(introUrl);introUrl=null;introReady.hidden=true;introStatus.textContent='برای دریافت اطلاعات جدید، پیش‌نمایش را دوباره بسازید.'}preview()}}));

function updatePreviewButton(){
 previewPlay.textContent=previewPlaying?'❚❚':'▶';
 previewPlay.setAttribute('aria-label',previewPlaying?'توقف موقت پیش‌نمایش':'پخش پیش‌نمایش سکانس آغازین');
 previewPlay.title=previewPlaying?'توقف موقت':'پخش پیش‌نمایش';
}
function stopPreview(){
 ++previewToken;previewPlayer.pause();cancelAnimationFrame(previewRaf);previewActive=false;previewPlaying=false;previewHoldStart=null;previewHoldElapsed=0;previewPlay.disabled=false;updatePreviewButton();
}
function previewTick(){
 if(!previewPlaying)return;
 render(previewPlayer.currentTime>=18.4||previewPlayer.ended,true,previewPlayer);
 if(previewPlayer.ended){
  if(previewHoldStart===null)previewHoldStart=performance.now();
  if(previewHoldElapsed+(performance.now()-previewHoldStart)/1000>=HOLD){stopPreview();preview();return}
 }
 previewRaf=requestAnimationFrame(previewTick);
}
previewPlay.addEventListener('click',async()=>{
 if(recording)return;
 if(previewPlaying){
  ++previewToken;previewPlayer.pause();cancelAnimationFrame(previewRaf);
  if(previewHoldStart!==null)previewHoldElapsed+=(performance.now()-previewHoldStart)/1000;
  previewHoldStart=null;previewPlaying=false;updatePreviewButton();return;
 }
 const token=++previewToken;previewPlay.disabled=true;status.textContent='';resultVideo.pause();
 try{
  if(!previewActive){previewActive=true;previewHoldStart=null;previewHoldElapsed=0;startClipLoading(previewPlayer);if(previewPlayer.currentTime>0)previewPlayer.currentTime=0;}
  if(!previewPlayer.ended)await previewPlayer.play();
  if(token!==previewToken){previewPlayer.pause();return}
  previewPlaying=true;updatePreviewButton();previewRaf=requestAnimationFrame(previewTick);
 }catch(e){if(token===previewToken){stopPreview();if(previewPlayer.error){previewPlayer.removeAttribute('src');previewPlayer.load()}status.textContent='پخش پیش‌نمایش ممکن نشد. لطفاً دوباره تلاش کنید.';preview()}}
 finally{if(token===previewToken)previewPlay.disabled=false}
});
video.addEventListener('loadedmetadata',()=>{preview();checkUpload()});outro.addEventListener('loadedmetadata',checkUpload);
checkUpload();
video.addEventListener('error',()=>{status.textContent='سکانس آغازین بارگذاری نشد؛ فایل video.mp4 را بررسی کنید.'});
outro.addEventListener('error',()=>{timeLimit.textContent='سکانس پایانی بارگذاری نشد؛ فایل outro.mp4 را بررسی کنید.';upload.setCustomValidity('سکانس پایانی بارگذاری نشده است.')});
fontReady.then(()=>preview()).catch(()=>{status.textContent='فونت بی‌تیتر بارگذاری نشد.'});
upload.addEventListener('change',()=>{
 if(uploadUrl)URL.revokeObjectURL(uploadUrl);uploadUrl=null;teacher.removeAttribute('src');teacher.load();fileInfo.className='file-info';fileInfo.textContent='';
 if(!upload.files.length){checkUpload();return}
 upload.setCustomValidity('در حال بررسی ویدیوی انتخاب‌شده');fileInfo.textContent='در حال بررسی مدت ویدیو...';uploadUrl=URL.createObjectURL(upload.files[0]);teacher.src=uploadUrl;teacher.load();
});
teacher.addEventListener('loadedmetadata',checkUpload);
teacher.addEventListener('error',()=>{if(!upload.files.length)return;const msg='این فایل قابل پخش نیست. لطفاً یک ویدیوی MP4 یا WebM سازگار با مرورگر انتخاب کنید.';upload.setCustomValidity(msg);fileInfo.className='file-info error';fileInfo.textContent=msg});
function findType(){if(!window.MediaRecorder)return '';return ['video/mp4;codecs=avc1.42E01F,mp4a.40.2','video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1.64001F,mp4a.40.2','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t))||''}
function paintScene(el){ctx.fillStyle='#000';ctx.fillRect(0,0,1280,720);const scale=Math.min(1280/el.videoWidth,720/el.videoHeight),w=el.videoWidth*scale,h=el.videoHeight*scale;ctx.drawImage(el,(1280-w)/2,(720-h)/2,w,h)}
function progress(value,total){const p=Math.max(0,Math.min(100,100*value/total));if(introMode)introStatus.textContent=`در حال ساخت پیش‌نمایش... ${fa(p)}٪` ;else{bar.style.width=p+'%';percent.textContent=fa(p)+'٪'}}
// Budget the video bitrate by total duration, leaving headroom under 100 MB.
const OUTPUT_AUDIO_BPS=160000, MAX_VIDEO_BPS=6000000;
function bitrateForDuration(seconds){
 return Math.max(1000000,Math.min(MAX_VIDEO_BPS,Math.floor(MAX_BYTES*.82*8/Math.max(1,seconds)-OUTPUT_AUDIO_BPS)));
}
// Do not offer recordings with corrupt/inflated timestamps as successful downloads.
async function verifyRecording(blob,expected,requireHeader=false){
 const url=URL.createObjectURL(blob), probe=document.createElement('video');probe.preload='metadata';probe.muted=true;
 try{
  const duration=await new Promise((resolve,reject)=>{
   let timer;const cleanup=()=>{clearTimeout(timer);probe.removeEventListener('loadedmetadata',check);probe.removeEventListener('durationchange',check);probe.removeEventListener('seeked',check);probe.removeEventListener('error',fail)};
   const fail=()=>{cleanup();reject(new Error('مرورگر نتوانست فایل ساخته‌شده را بررسی کند. از Chrome یا Edge به‌روز استفاده کنید.'))};
   const check=()=>{if(Number.isFinite(probe.duration)&&probe.duration>0){const d=probe.duration;cleanup();resolve(d)}else if(probe.readyState>=1){if(requireHeader){cleanup();reject(new Error('مدت زمان ویدیو در فایل ثبت نشد؛ لطفاً با مرورگر دیگری تلاش کنید.'));return}try{probe.currentTime=1e8}catch(e){}}};
   probe.addEventListener('loadedmetadata',check);probe.addEventListener('durationchange',check);probe.addEventListener('seeked',check);probe.addEventListener('error',fail);
   timer=setTimeout(()=>{cleanup();reject(new Error('مدت فایل ساخته‌شده قابل بررسی نیست؛ مرورگر دیگری را امتحان کنید.'))},15000);
   probe.src=url;probe.load();
  });
  const tolerance=Math.max(1.5,Math.min(3,expected*.015));
  if(Math.abs(duration-expected)>tolerance||duration>MAX_SECONDS)throw new Error('زمان ویدیو با زمان واقعی هماهنگ نیست و فایل خراب ذخیره نشد. صفحه را باز نگه دارید و با مرورگر یا دستگاه دیگر دوباره امتحان کنید.');
  return duration;
 }finally{probe.removeAttribute('src');probe.load();URL.revokeObjectURL(url)}
}
// Create a normal, indexed container entirely in the browser, without re-encoding.
async function finalizeSeekable(blob,expected){
 await verifyRecording(blob,expected); // Reject distorted timestamps before re-packaging.
 let fixed;
 try{
  const {makeSeekable}=await import('./media-fix.js?v=seekable-31');
  fixed=await makeSeekable(blob);
 }catch(err){console.error('Seekable media preparation failed:',err);throw new Error('آماده‌سازی نوار زمان ویدیو ممکن نشد؛ مرورگر به‌روز یا دستگاه دیگری را امتحان کنید.');}
 if(fixed.size>MAX_BYTES)throw new Error('حجم فایل نهایی از ۱۰۰ مگابایت بیشتر شد؛ ویدیوی آزمایش کوتاه‌تری انتخاب کنید.');
 await verifyRecording(fixed,expected,true);
 // Verify that the browser can move to the middle before offering the file.
 const url=URL.createObjectURL(fixed), el=document.createElement('video');el.preload='metadata';el.muted=true;
 try{
  await new Promise((resolve,reject)=>{
   let timer;const cleanup=()=>{clearTimeout(timer);el.removeEventListener('loadedmetadata',load);el.removeEventListener('seeked',done);el.removeEventListener('error',fail)};
   const fail=()=>{cleanup();reject(new Error('مرورگر نتوانست نوار زمان ویدیو را بررسی کند.'))};
   const done=()=>{if(Math.abs(el.currentTime-expected/2)<1){cleanup();resolve()}else fail()};
   const load=()=>{try{el.currentTime=Math.min(expected/2,el.duration-.1)}catch(e){fail()}};
   el.addEventListener('loadedmetadata',load);el.addEventListener('seeked',done);el.addEventListener('error',fail);
   timer=setTimeout(fail,15000);el.src=url;el.load();
  });
 }finally{el.removeAttribute('src');el.load();URL.revokeObjectURL(url)}
 return fixed;
}
async function playScene(el,stage,completed,total,started,tailMs=120){
 if(stopRequested||sizeExceeded||timeExceeded)return;
 await seek(el,0);if(stopRequested||sizeExceeded||timeExceeded)return;
 $('progress-text').textContent=stage===0?'در حال آماده‌سازی سکانس آغازین...':stage===1?'در حال افزودن ویدیوی آزمایش...':'در حال افزودن سکانس پایانی...';
 await el.play();let holdStart=null;
 const sceneStart=performance.now(), startMedia=el.currentTime;
 await new Promise((resolve,reject)=>{
  let finished=false,lastDraw=-Infinity;
  const finish=(err)=>{if(finished)return;finished=true;el.removeEventListener('error',fail);err?reject(err):resolve()};
  const fail=()=>finish(new Error('خطا در پخش یکی از ویدیوها.'));el.addEventListener('error',fail,{once:true});
  function tick(){
   const now=performance.now();
   if(now-started>MAX_SECONDS*1000)timeExceeded=true;
   if(stopRequested||sizeExceeded||timeExceeded){finish();return}
   try{
    const elapsed=(now-sceneStart)/1000, advanced=Math.max(0,el.currentTime-startMedia);
    if(!el.ended&&elapsed-advanced>3.5){finish(new Error('پخش ویدیو از زمان واقعی عقب مانده است؛ برای جلوگیری از خروجی ناهماهنگ، ساخت متوقف شد. صفحه را باز نگه دارید، اتصال را بررسی و با دستگاه یا مرورگر دیگری امتحان کنید.'));return}
    // Canvas capture is 30 fps; avoid doing the costly full-HD composition twice per frame.
    if(now-lastDraw>=1000/30-2||el.ended){if(stage===0)render(el.currentTime>=18.4||el.ended,true);else paintScene(el);lastDraw=now;}
    if(el.ended&&holdStart===null)holdStart=performance.now();
    const held=holdStart===null?0:Math.min(stage===0?HOLD:0,(performance.now()-holdStart)/1000);
    progress(completed+(el.ended?el.duration:el.currentTime)+held,total);
    if(el.ended&&(stage!==0||held>=HOLD)){finish();return}
    raf=requestAnimationFrame(tick);
   }catch(err){finish(err)}
  }
  raf=requestAnimationFrame(tick);
 });
 // Allow Web Audio and MediaRecorder to flush the end of this scene's sound.
 if(!stopRequested&&!sizeExceeded&&!timeExceeded){
  // Keep painting the last frame while the final audio reaches the recorder.
  const tailEnd=performance.now()+tailMs;
  while(performance.now()<tailEnd&&!stopRequested&&!sizeExceeded){if(stage===0)render(true,true);else paintScene(el);await sleep(33)}
 }
 el.pause();
}

function prepareAudio(){
 audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
 if(!audioDest){audioDest=audioCtx.createMediaStreamDestination();audioSources=[video,teacher,outro].map(v=>{const source=audioCtx.createMediaElementSource(v);source.connect(audioDest);return source})}
 return audioCtx.resume();
}
introDownload.addEventListener('click',async()=>{
 if(recording)return;
 introStatus.textContent='';introReady.hidden=true;
 const missing=fields.find(f=>!f.value.trim());
 if(missing){introStatus.textContent='ابتدا استان، منطقه، نام دبیر و موضوع آزمایش را کامل کنید.';missing.focus();return}
 const mime=findType();
 if(!mime||!canvas.captureStream||!(window.AudioContext||window.webkitAudioContext)){introStatus.textContent='این مرورگر از ساخت ویدیوی MP4 با صدا پشتیبانی نمی‌کند؛ از Chrome یا Edge به‌روز استفاده کنید.';return}
 stopPreview();resultVideo.pause();previewPlay.disabled=true;introDownload.disabled=true;button.disabled=true;upload.disabled=true;fields.forEach(x=>x.disabled=true);
 recording=true;introMode=true;stopRequested=false;sizeExceeded=false;timeExceeded=false;introCancel.hidden=false;introScreenHint.hidden=false;introStatus.textContent='در حال آماده‌سازی پیش‌نمایش...';void keepScreenAwake();
 if(introUrl){URL.revokeObjectURL(introUrl);introUrl=null}let stream=null,chunks=[],bytes=0;loadingController=new AbortController();
 try{
  introStatus.textContent='در حال دریافت سکانس آغازین...';
  await Promise.all([prepareAudio(),fontReady,ensureClip(video,loadingController.signal)]);video.pause();await seek(video,0);render(false);
  stream=canvas.captureStream(30);audioDest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
  recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:bitrateForDuration(video.duration+HOLD),audioBitsPerSecond:OUTPUT_AUDIO_BPS});
  recorder.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;if(bytes>MAX_BYTES){sizeExceeded=true;chunks=[]}else if(!sizeExceeded)chunks.push(e.data)}};
  const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=ev=>reject(ev.error||new Error('خطا هنگام ساخت پیش‌نمایش.'))});
  recorder.start(500);const started=performance.now();await preRoll(stream);await playScene(video,0,0,video.duration+HOLD,started,END_TAIL_MS);
  if(recorder.state!=='inactive')recorder.stop();await stopped;
  if(stopRequested){introStatus.textContent='ساخت پیش‌نمایش لغو شد.';return}
  if(sizeExceeded||bytes>MAX_BYTES)throw new Error('حجم پیش‌نمایش بیش از ۱۰۰ مگابایت است.');
  if(timeExceeded||!chunks.length)throw new Error('ساخت پیش‌نمایش ناموفق بود؛ لطفاً دوباره تلاش کنید.');
  let blob=new Blob(chunks,{type:recorder.mimeType||mime});if(blob.size>MAX_BYTES)throw new Error('حجم پیش‌نمایش بیش از ۱۰۰ مگابایت است.');
  chunks=[];introStatus.textContent='در حال آماده‌سازی نوار زمان ویدیو...';blob=await finalizeSeekable(blob,video.duration+HOLD+EXTRA_RECORD_SECONDS);
  if(stopRequested){introStatus.textContent='ساخت پیش‌نمایش لغو شد.';return}
  introUrl=URL.createObjectURL(blob);const ext=mime.startsWith('video/mp4')?'mp4':'webm';introReady.href=introUrl;introReady.download='pishnamayesh-azmayeshgah.'+ext;introReady.hidden=false;
  introStatus.textContent='پیش‌نمایش آماده است؛ اگر دانلود شروع نشد، روی دریافت مجدد بزنید.';introReady.click();
 }catch(err){loadingController?.abort();introStatus.textContent=stopRequested?'ساخت پیش‌نمایش لغو شد.':(err.message||'ساخت پیش‌نمایش ناموفق بود.');if(recorder&&recorder.state!=='inactive')recorder.stop()}
 finally{cancelAnimationFrame(raf);video.pause();if(stream)stream.getTracks().filter(t=>t.kind==='video').forEach(t=>t.stop());recording=false;loadingController=null;void releaseWakeLock();introMode=false;previewPlay.disabled=false;introDownload.disabled=false;button.disabled=false;upload.disabled=false;fields.forEach(x=>x.disabled=false);introCancel.hidden=true;introScreenHint.hidden=true;await preview()}
});
introCancel.addEventListener('click',()=>{stopRequested=true;loadingController?.abort()});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(recording)return;status.textContent='';resultVideo.pause();resultVideo.removeAttribute('src');resultVideo.load();if(resultUrl){URL.revokeObjectURL(resultUrl);resultUrl=null;download.removeAttribute('href')}playbackNote.textContent='';result.hidden=true;
 const mime=findType();if(!mime||!canvas.captureStream||!(window.AudioContext||window.webkitAudioContext)){status.textContent='این مرورگر از ساخت ویدیوی MP4 با صدا پشتیبانی نمی‌کند؛ از Chrome یا Edge به‌روز استفاده کنید.';return}
 if(!checkUpload()){upload.reportValidity();return}
 stopPreview();previewPlay.disabled=true;introDownload.disabled=true;recording=true;stopRequested=false;sizeExceeded=false;timeExceeded=false;button.disabled=true;upload.disabled=true;fields.forEach(x=>x.disabled=true);cancel.hidden=false;wrap.hidden=false;bar.style.width='0%';percent.textContent='۰٪';void keepScreenAwake();let stream=null;let chunks=[],bytes=0;loadingController=new AbortController();
 try{
  $('progress-text').textContent='در حال دریافت سکانس‌های آماده...';
  await Promise.all([prepareAudio(),fontReady,ensureClip(video,loadingController.signal),ensureClip(teacher,loadingController.signal),ensureClip(outro,loadingController.signal)]);
  const total=video.duration+HOLD+teacher.duration+outro.duration;
  video.pause();await seek(video,0);render(false);
  stream=canvas.captureStream(30);audioDest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
  recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:bitrateForDuration(total),audioBitsPerSecond:OUTPUT_AUDIO_BPS});
  recorder.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;if(bytes>MAX_BYTES){sizeExceeded=true;chunks=[]}else if(!sizeExceeded)chunks.push(e.data)}};
  const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=ev=>reject(ev.error||new Error('خطا هنگام ساخت ویدیو.'))});
  recorder.start(500);const started=performance.now();
  await preRoll(stream);
  await playScene(video,0,0,total,started);
  await playScene(teacher,1,video.duration+HOLD,total,started);
  await playScene(outro,2,video.duration+HOLD+teacher.duration,total,started,END_TAIL_MS);
  if(recorder.state!=='inactive')recorder.stop();await stopped;
  if(sizeExceeded||bytes>MAX_BYTES)throw new Error('حجم فایل نهایی از ۱۰۰ مگابایت بیشتر شد و ذخیره نشد. لطفاً ویدیوی کوتاه‌تری انتخاب کنید.');
  if(timeExceeded||performance.now()-started>MAX_SECONDS*1000)throw new Error('به علت طول ویدیو یا تأخیر هنگام ساخت، خروجی از ۵ دقیقه بیشتر شد و ذخیره نشد. لطفاً ویدیوی کوتاه‌تری انتخاب و صفحه را باز نگه دارید.');
  if(stopRequested){status.textContent='ساخت ویدیو لغو شد.';return}
  if(!chunks.length)throw new Error('فایلی تولید نشد؛ لطفاً دوباره تلاش کنید.');
  let blob=new Blob(chunks,{type:recorder.mimeType||mime});if(blob.size>MAX_BYTES)throw new Error('حجم فایل نهایی بیش از ۱۰۰ مگابایت است.');
  chunks=[];$('progress-text').textContent='در حال آماده‌سازی نوار زمان ویدیو...';blob=await finalizeSeekable(blob,total+EXTRA_RECORD_SECONDS);
  if(stopRequested){status.textContent='ساخت ویدیو لغو شد.';return}
  if(resultUrl)URL.revokeObjectURL(resultUrl);resultUrl=URL.createObjectURL(blob);const ext=mime.startsWith('video/mp4')?'mp4':'webm';download.href=resultUrl;download.download='azmayeshgah.'+ext;
  $('format-note').textContent=`فرمت ${ext.toUpperCase()} · حجم ${(blob.size/1000000).toLocaleString('fa-IR',{maximumFractionDigits:1})} مگابایت · صدای سه سکانس`;
  resultVideo.src=resultUrl;resultVideo.muted=false;result.hidden=false;
  result.scrollIntoView({behavior:'smooth',block:'nearest'});
  try{await resultVideo.play()}catch(firstError){
   // Browsers may block autoplay with sound after a long render; try muted instead.
   resultVideo.muted=true;
   try{await resultVideo.play();playbackNote.textContent='پیش‌نمایش بی‌صدا پخش می‌شود؛ برای شنیدن صدا، از کنترل ویدیو صدا را روشن کنید.'}
   catch(secondError){resultVideo.muted=false;playbackNote.textContent='برای تماشای ویدیو، دکمه پخش را بزنید.'}
  }
 }catch(err){loadingController?.abort();status.textContent=stopRequested?'ساخت ویدیو لغو شد.':(err.message||'ساخت ویدیو ناموفق بود. لطفاً دوباره تلاش کنید.');if(recorder&&recorder.state!=='inactive')recorder.stop()}
 finally{cancelAnimationFrame(raf);[video,teacher,outro].forEach(v=>v.pause());if(stream)stream.getTracks().filter(t=>t.kind==='video').forEach(t=>t.stop());recording=false;loadingController=null;void releaseWakeLock();previewPlay.disabled=false;introDownload.disabled=false;button.disabled=false;upload.disabled=false;fields.forEach(x=>x.disabled=false);cancel.hidden=true;wrap.hidden=true;await preview()}
});
cancel.addEventListener('click',()=>{stopRequested=true;loadingController?.abort()});
