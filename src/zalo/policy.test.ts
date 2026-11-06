import {describe,expect,it} from "vitest";
import {findIdentityMentionUid,hasExactMention,stripExactMention} from "./policy.js";

describe("Zalo reply policy",()=>{
  it("accepts only the bot UID, not a matching-looking name",()=>{
    expect(hasExactMention([{uid:"bot-1",pos:0,len:5}],"bot-1")).toBe(true);
    expect(hasExactMention([{uid:"someone-else",pos:0,len:5}],"bot-1")).toBe(false);
    expect(hasExactMention([],"bot-1")).toBe(false);
  });
  it("removes only the exact bot mention from the question",()=>{
    expect(stripExactMention("@MbaLong: thời tiết hôm nay?",[{uid:"bot-1",pos:0,len:8}],"bot-1")).toBe("thời tiết hôm nay?");
  });
  it("matches the bot mention when login, group and global IDs are aliases",()=>{
    const aliases:Record<string,string>={"bot-login":"bot-global","bot-group":"bot-global"};
    const resolve=(id:string)=>aliases[id]??id;
    expect(findIdentityMentionUid([{uid:"bot-group",pos:0,len:8}],"bot-login",resolve)).toBe("bot-group");
  });
});
