import type {ChatImage} from "../types.js";

const MAX_IMAGE_BYTES=12*1024*1024;
const ALLOWED_MIME=new Set<ChatImage["mimeType"]>(["image/jpeg","image/png","image/webp","image/gif"]);
const ALLOWED_ZALO_HOSTS=["zalo.me","zalo.vn","zaloapp.com","zaloapp.vn","zadn.vn","zdn.vn"];

function safeZaloUrl(input:string):URL {
  const url=new URL(input);
  if(url.protocol==="http:")url.protocol="https:";
  const host=url.hostname.toLowerCase();
  if(url.protocol!=="https:"||url.username||url.password||!ALLOWED_ZALO_HOSTS.some((suffix)=>host===suffix||host.endsWith(`.${suffix}`)))throw new Error("URL ảnh Zalo không hợp lệ");
  return url;
}

async function fetchWithSafeRedirects(input:string,signal:AbortSignal):Promise<Response> {
  let url=safeZaloUrl(input);
  for(let redirect=0;redirect<=3;redirect++){
    const response=await fetch(url,{signal,redirect:"manual",headers:{"User-Agent":"MbaLong-Zalo-Bot/1.0"}});
    if(response.status<300||response.status>=400)return response;
    const location=response.headers.get("location");
    if(!location)throw new Error("Ảnh Zalo chuyển hướng không hợp lệ");
    url=safeZaloUrl(new URL(location,url).toString());
  }
  throw new Error("Ảnh Zalo chuyển hướng quá nhiều lần");
}

export async function downloadZaloImage(url:string):Promise<ChatImage> {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
    const response=await fetchWithSafeRedirects(url,controller.signal);
    if(!response.ok)throw new Error(`Không tải được ảnh Zalo (${response.status})`);
    const mime=response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() as ChatImage["mimeType"]|undefined;
    if(!mime||!ALLOWED_MIME.has(mime))throw new Error("Định dạng ảnh không được hỗ trợ (chỉ JPEG, PNG, WEBP, GIF)");
    const declared=Number(response.headers.get("content-length")??0);
    if(declared>MAX_IMAGE_BYTES)throw new Error("Ảnh vượt quá giới hạn 12 MB");
    if(!response.body)throw new Error("Ảnh Zalo không có dữ liệu");
    const chunks:Uint8Array[]=[];let size=0;
    for await(const chunk of response.body){
      size+=chunk.byteLength;
      if(size>MAX_IMAGE_BYTES)throw new Error("Ảnh vượt quá giới hạn 12 MB");
      chunks.push(chunk);
    }
    return {mimeType:mime,data:Buffer.concat(chunks).toString("base64")};
  }finally{clearTimeout(timeout);}
}
