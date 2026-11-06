export interface MentionSpan { uid?: string; pos?: number; len?: number }

export function findIdentityMentionUid(
  mentions:MentionSpan[],
  ownId:string,
  resolve:(id:string)=>string=(id)=>id,
) {
  if(!ownId)return "";
  const canonicalOwnId=resolve(ownId);
  const match=mentions.find((mention)=>{
    const uid=String(mention.uid??"");
    return Boolean(uid)&&resolve(uid)===canonicalOwnId;
  });
  return String(match?.uid??"");
}

export function hasExactMention(mentions:MentionSpan[],ownId:string) {
  return Boolean(ownId)&&mentions.some((mention)=>String(mention.uid)===ownId);
}

export function stripExactMention(content:string,mentions:MentionSpan[],ownId:string) {
  let text=content;
  const spans=mentions.filter((m)=>String(m.uid)===ownId&&Number.isInteger(m.pos)&&Number.isInteger(m.len)).sort((a,b)=>(b.pos??0)-(a.pos??0));
  for(const span of spans)text=text.slice(0,span.pos)+text.slice((span.pos??0)+(span.len??0));
  return text.replace(/^\s*[:,–—-]?\s*/,"").trim();
}
