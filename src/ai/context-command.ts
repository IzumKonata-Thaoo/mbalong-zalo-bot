/**
 * `@MbaLong /xoacontext` (aliases: /reset, /clear, /newchat, "/xoa context",
 * "/xóa ngữ cảnh") wipes the group's AI memory: stored chat turns and summary.
 */
export function isClearContextCommand(input: string): boolean {
  const text = input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
  return /^\/(xoacontext|xoa\s*(context|ngu\s*canh|bo\s*nho)|reset|clear|newchat)\s*$/.test(text);
}
