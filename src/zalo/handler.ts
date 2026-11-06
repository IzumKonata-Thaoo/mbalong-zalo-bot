import { config } from "../config.js";
import { repository } from "../db.js";
import { answerGroup, summarizeGroup } from "../ai/assistant.js";
import { handleTaiXiu } from "../games/tai-xiu.js";
import { KeyedSerialQueue } from "../queue.js";
import { downloadZaloImage } from "../ai/image.js";
import { handleMusic } from "../music/service.js";
import type { IncomingGroupMessage } from "../types.js";
import { zaloClient } from "./client.js";

const queue = new KeyedSerialQueue(25);

async function processMessage(message: IncomingGroupMessage, question: string) {
  try {
    const gameResponse = message.imageUrl ? null : handleTaiXiu(question);
    if (gameResponse) {
      await zaloClient.send(message.groupId, gameResponse, message.raw);
      return;
    }

    let musicResponse = null;
    try {
      musicResponse = message.imageUrl
        ? null
        : await handleMusic(message.groupId, message.senderId, question);
    } catch (error) {
      if (
        error instanceof Error &&
        /(SoundCloud|nhạc|music|yt-dlp)/i.test(error.message)
      ) {
        await zaloClient.send(
          message.groupId,
          `Không thể xử lý nhạc: ${error.message}`,
          message.raw,
        );
        return;
      }
      throw error;
    }
    if (musicResponse) {
      await zaloClient.send(
        message.groupId,
        musicResponse.message,
        message.raw,
      );
      if (musicResponse.soundCloudTrackUrl)
        try {
          await zaloClient.sendVoiceFromStream(
            message.groupId,
            musicResponse.soundCloudTrackUrl,
          );
        } catch (error) {
          console.error("Music voice delivery error", error);
          await zaloClient.send(
            message.groupId,
            `Không phát được preview qua ghi âm Zalo: ${error instanceof Error ? error.message : "lỗi không xác định"}`,
          );
        }
      return;
    }

    const wantsSummary = /^\s*(hãy\s+)?(tóm tắt|tom tat|summary)\b/i.test(
      question,
    );
    const response = wantsSummary
      ? `📝 TÓM TẮT CUỘC TRÒ CHUYỆN\n\n${await summarizeGroup(message.groupId)}`
      : `✦ ${config.BOT_NAME}\n\n${await answerGroup(message.groupId, message.senderName, question, message.imageUrl ? [await downloadZaloImage(message.imageUrl)] : [])}`;
    repository.saveMessage(
      message.groupId,
      message.messageId,
      message.senderId,
      message.senderName,
      "user",
      message.imageUrl ? `[Ảnh] ${question}` : question,
    );
    repository.saveMessage(
      message.groupId,
      null,
      zaloClient.ownId,
      config.BOT_NAME,
      "assistant",
      response,
    );
    await zaloClient.send(message.groupId, response, message.raw);
  } catch (error) {
    console.error("Message handling error", error);
    const imageError =
      message.imageUrl &&
      error instanceof Error &&
      /(ảnh|URL)/i.test(error.message)
        ? `MbaLong không đọc được ảnh: ${error.message}`
        : null;
    await zaloClient
      .send(
        message.groupId,
        imageError ??
          "MbaLong gặp lỗi khi xử lý yêu cầu này. Admin hãy kiểm tra model có hỗ trợ ảnh, cấu hình AI hoặc log máy chủ.",
        message.raw,
      )
      .catch(() => {});
  }
}

export function startMessageHandler() {
  zaloClient.on("group-message", (message: IncomingGroupMessage) => {
    if (
      !repository.group(message.groupId)?.enabled ||
      !zaloClient.isMentioned(message)
    )
      return;
    const question =
      zaloClient.stripOwnMention(message) ||
      (message.imageUrl
        ? "Hãy xem ảnh này và giải thích hoặc giải bài trong ảnh."
        : "");
    if (!question) return;
    void queue
      .enqueue(message.groupId, () => processMessage(message, question))
      .catch(async (error) => {
        console.error("Message queue error", error);
        await zaloClient
          .send(
            message.groupId,
            "Nhóm đang có quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.",
            message.raw,
          )
          .catch(() => {});
      });
  });
}
