// app/api/process-all/route.ts
import { runParser, TelegramPost } from "@/lib/parser";
import { processChunkWithAI } from "@/lib/ai";

export const dynamic = "force-dynamic";

const NUM_CHUNKS = 1;
const API_DELAY_SECONDS = 65;
const API_DELAY_MS = API_DELAY_SECONDS * 1000;

function sendEvent(
  controller: ReadableStreamDefaultController,
  eventName: string,
  data: object
) {
  controller.enqueue(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function formatPostsToString(posts: TelegramPost[]): string {
  return posts
    .map(
      (p) =>
        `Источник: ${p.channel}\nАвтор: ${p.author}\nДата: ${
          p.datetimeMsk
        }\n\n${p.text}\n\nИзображения: ${p.images.join(", ")}\n\n---\n\n`
    )
    .join("");
}

function splitTextIntoChunks(text: string, numChunks: number): string[] {
  const chunks: string[] = [];
  const chunkSize = Math.ceil(text.length / numChunks);
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}

export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      const dispatch = (event: string, data: object) => {
        console.log(`SSE Event: ${event}`, data);
        sendEvent(controller, event, data);
      };

      try {
        dispatch("progress", {
          message: "Начинаю парсинг Telegram-каналов...",
        });

        const parsingProgressCallback = (details: {
          channel: string;
          index: number;
          total: number;
        }) => {
          const channelNumber = details.index + 1;
          dispatch("progress", {
            message: `Парсинг канала ${channelNumber}/${details.total}: ${details.channel}...`,
          });
        };

        const posts = await runParser(parsingProgressCallback);

        if (posts.length === 0) {
          throw new Error(
            "Не найдено ни одного поста. Проверьте каналы и время."
          );
        }
        dispatch("progress", {
          message: `Парсинг завершен. Собрано ${posts.length} постов.`,
        });

        const largeString = formatPostsToString(posts);
        const chunks = splitTextIntoChunks(largeString, NUM_CHUNKS);

        dispatch("progress", {
          message: `Текст разбит на ${NUM_CHUNKS} частей. Начинаю обработку в Gemini...`,
        });

        const allPartialResults = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const chunkNumber = i + 1;

          dispatch("progress", {
            message: `Отправляю часть ${chunkNumber}/${NUM_CHUNKS} на анализ...`,
          });

          const result = await processChunkWithAI(chunk);
          allPartialResults.push(result);

          dispatch("progress", {
            message: `Часть ${chunkNumber}/${NUM_CHUNKS} успешно обработана.`,
          });

          if (chunkNumber < chunks.length) {
            dispatch("progress", {
              message: `Пауза ${API_DELAY_SECONDS} секунд из-за ограничений API...`,
            });
            await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
          }
        }

        const finalJson = allPartialResults.flat();
        dispatch("progress", {
          message:
            "Анализ всех частей завершен. Отправляю данные для генерации документа...",
        });
        dispatch("final_data", { jsonData: finalJson });
      } catch (error: any) {
        console.error("Error in SSE stream:", error);
        dispatch("error", {
          message: error.message || "Произошла неизвестная ошибка на сервере",
        });
      } finally {
        console.log("Closing SSE stream");
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
