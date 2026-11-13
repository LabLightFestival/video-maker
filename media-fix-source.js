/* Browser-local media re-packaging using Mediabunny 1.66.0 (MPL-2.0).
 * Source: https://github.com/Vanilagy/mediabunny/tree/v1.66.0
 * The wrapper is project source, not a modification to Mediabunny. */
import { Input, Output, Conversion, BlobSource, BufferTarget, ALL_FORMATS, Mp4OutputFormat, WebMOutputFormat } from 'mediabunny';

/** Rebuild the media container's duration and seek index without transcoding. */
export async function makeSeekable(blob) {
 const type=blob.type.split(';')[0].trim().toLowerCase();
 if(type!=='video/mp4'&&type!=='video/webm')throw new Error('فرمت فایل برای ساخت نوار زمان پشتیبانی نمی‌شود.');
 const input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});
 try{
  const [video,audio]=await Promise.all([input.getPrimaryVideoTrack(),input.getPrimaryAudioTrack()]);
  if(!video||!audio)throw new Error('فایل باید هم تصویر و هم صدا داشته باشد.');
  const format=type==='video/mp4'?new Mp4OutputFormat({fastStart:'in-memory'}):new WebMOutputFormat();
  const target=new BufferTarget();
  const output=new Output({format,target});
  const conversion=await Conversion.init({input,output,tracks:'primary',copy:{mode:'forced'},trim:{start:0},showWarnings:false});
  if(!conversion.isValid||conversion.discardedTracks.length)throw new Error('مرورگر نتوانست ویدیو و صدا را بدون تغییر کیفیت آماده کند.');
  await conversion.execute();
  if(!target.buffer||target.buffer.byteLength===0)throw new Error('ساخت فایل قابل جابه‌جایی ناموفق بود.');
  return new Blob([target.buffer],{type});
 }finally{input.dispose()}
}
