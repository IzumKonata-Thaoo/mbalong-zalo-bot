import { config } from "../config.js";
import type { SearchResult } from "../types.js";

const timeSensitive = /\b(hôm nay|hiện tại|mới nhất|giá|thời tiết|tin tức|lịch|tỷ giá|ai đang|bao nhiêu|search|tìm trên mạng|tra cứu)\b/i;
export const shouldResearch = (query: string) => timeSensitive.test(query);

export async function research(query: string): Promise<SearchResult[]> {
  if (!config.SEARCH_API_KEY) return [];
  const response = await fetch(config.SEARCH_API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json", Authorization:`Bearer ${config.SEARCH_API_KEY}` },
    body: JSON.stringify({ api_key: config.SEARCH_API_KEY, query, search_depth:"advanced", max_results:5, include_answer:false })
  });
  if (!response.ok) throw new Error(`Search API ${response.status}`);
  const json = await response.json() as {results?:SearchResult[]};
  return (json.results ?? []).slice(0,5).map((r) => ({title:r.title,url:r.url,content:r.content.slice(0,1200)}));
}
