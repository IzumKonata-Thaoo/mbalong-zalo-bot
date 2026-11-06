import { ai } from "./provider.js";
import { buildPrompt } from "./prompt.js";
import { research, shouldResearch } from "./search.js";
import { repository } from "../db.js";
import {getAISettings} from "../settings.js";
import type {ChatImage} from "../types.js";

export async function answerGroup(groupId:string, senderName:string, question:string, images:ChatImage[] = []) {
  const sources = shouldResearch(question) ? await research(question).catch(() => []) : [];
  return ai.generate(buildPrompt({senderName,question,summary:repository.summary(groupId)?.content,recent:repository.recentMessages(groupId,18),sources,customSystemPrompt:getAISettings().systemPrompt,images}));
}

export async function summarizeGroup(groupId:string) {
  const previous = repository.summary(groupId);
  const rows = repository.messagesAfter(groupId, previous?.through_message_id ?? 0, 120);
  if (!rows.length) return previous?.content ?? "Chưa có nội dung để tóm tắt.";
  const transcript = rows.map((m)=>`${m.sender_name}: ${m.content}`).join("\n");
  const result = await ai.generate([
    {role:"system",content:"Tóm tắt cuộc trò chuyện nhóm bằng tiếng Việt. Nêu chủ đề, quyết định, việc cần làm, người phụ trách nếu có. Không bịa. Tối đa 500 từ."},
    {role:"user",content:`Tóm tắt cũ:\n${previous?.content ?? "(không có)"}\n\nNội dung mới:\n${transcript}`}
  ],{temperature:0.2,maxTokens:900});
  repository.saveSummary(groupId,result,Number(rows.at(-1)?.id ?? 0));
  return result;
}
