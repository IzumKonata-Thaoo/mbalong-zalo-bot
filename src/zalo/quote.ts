export interface SendableZaloQuote {
  content: unknown;
  msgType: string;
  propertyExt: unknown;
  uidFrom: string;
  msgId: string;
  cliMsgId: string;
  ts: string;
  ttl: number;
}

export function normalizeZaloQuote(input: unknown): SendableZaloQuote | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value: any = (input as any).data ?? input;
  if (
    value.content !== undefined &&
    value.msgType &&
    value.uidFrom &&
    value.msgId !== undefined
  )
    return {
      content: value.content,
      msgType: String(value.msgType),
      propertyExt: value.propertyExt,
      uidFrom: String(value.uidFrom),
      msgId: String(value.msgId),
      cliMsgId: String(value.cliMsgId ?? value.msgId),
      ts: String(value.ts ?? Date.now()),
      ttl: Number(value.ttl) || 0,
    };
  if (
    value.msg !== undefined &&
    value.ownerId &&
    value.globalMsgId !== undefined
  )
    return {
      content: String(value.msg),
      msgType: "webchat",
      propertyExt: undefined,
      uidFrom: String(value.ownerId),
      msgId: String(value.globalMsgId),
      cliMsgId: String(value.cliMsgId ?? value.globalMsgId),
      ts: String(value.ts ?? Date.now()),
      ttl: Number(value.ttl) || 0,
    };
  return undefined;
}
