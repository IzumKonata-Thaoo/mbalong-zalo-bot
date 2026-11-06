const URL_FIELDS=["oriUrl","originUrl","hdUrl","normalUrl","href","url","thumbUrl","thumb"];

function record(value:unknown):Record<string,unknown>|null {
  return value!==null&&typeof value==="object"&&!Array.isArray(value) ? value as Record<string,unknown> : null;
}

function parseObject(value:unknown):Record<string,unknown>|null {
  const direct=record(value);
  if(direct)return direct;
  if(typeof value!=="string")return null;
  try{return record(JSON.parse(value));}catch{return null;}
}

export function extractZaloPhoto(content:unknown):{caption:string;url?:string} {
  const source=parseObject(content);
  if(!source)return {caption:typeof content==="string"?content:""};
  const nested=[source,parseObject(source.params),parseObject(source.metadata)].filter((item):item is Record<string,unknown>=>Boolean(item));
  const caption=nested.map((item)=>[item.title,item.description,item.caption].find((value)=>typeof value==="string"&&value.trim())).find(Boolean);
  for(const item of nested)for(const field of URL_FIELDS){
    const value=item[field];
    if(typeof value==="string"&&/^https?:\/\//i.test(value))return {caption:typeof caption==="string"?caption:"",url:value};
  }
  return {caption:typeof caption==="string"?caption:""};
}
