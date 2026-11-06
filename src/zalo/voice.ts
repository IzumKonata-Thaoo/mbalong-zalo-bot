export function buildGroupVoicePayload(input: {
  groupId: string;
  voiceUrl: string;
  fileSize: number;
  imei: string;
  clientId?: string;
}) {
  return {
    grid: input.groupId,
    visibility: 0,
    ttl: 0,
    zsource: -1,
    msgType: 3,
    clientId: input.clientId ?? Date.now().toString(),
    msgInfo: JSON.stringify({
      voiceUrl: input.voiceUrl,
      m4aUrl: input.voiceUrl,
      fileSize: input.fileSize,
    }),
    imei: input.imei,
  };
}
