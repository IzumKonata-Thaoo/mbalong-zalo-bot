export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`/api${path}`,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  if(response.status===401){window.dispatchEvent(new Event("auth:expired"));throw new Error("Phiên đăng nhập hết hạn");}
  const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||"Yêu cầu thất bại");return body;
}
