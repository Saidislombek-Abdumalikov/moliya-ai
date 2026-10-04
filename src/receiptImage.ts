import {blobDataUrl} from './audioRecorder';
// Phone photos routinely exceed the serverless request limit. Resize before upload.
export async function prepareReceiptImage(file:File):Promise<string>{
  if(file.size>25*1024*1024)throw new Error('IMAGE_TOO_LARGE');
  const url=URL.createObjectURL(file);
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('IMAGE_UNSUPPORTED'));img.src=url;
    });
    if(!image.naturalWidth || !image.naturalHeight)throw new Error('IMAGE_UNSUPPORTED');
    const scale=Math.min(1,2000/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('IMAGE_UNSUPPORTED');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    for(const quality of [0.9,0.75,0.6]){
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob && blob.size<=2*1024*1024)return blobDataUrl(blob);
    }
    throw new Error('IMAGE_TOO_LARGE');
  }finally{URL.revokeObjectURL(url)}
}
