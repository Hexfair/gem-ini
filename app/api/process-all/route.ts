// app/api/process-all/route.ts
import { runParser, TelegramPost } from "@/lib/parser";
import { processChunkWithAI } from "@/lib/ai";

export const dynamic = "force-dynamic"; // Обязательно для SSE

// Функция для отправки событий в SSE-поток
function sendEvent(
  controller: ReadableStreamDefaultController,
  eventName: string,
  data: object
) {
  controller.enqueue(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Функция для форматирования постов в одну строку
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

// Функция для разбивки текста на части
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
      // Отправляет событие и логгирует его
      const dispatch = (event: string, data: object) => {
        console.log(`SSE Event: ${event}`, data);
        sendEvent(controller, event, data);
      };

      try {
        // --- ШАГ 1: ПАРСИНГ ---
        dispatch("progress", {
          message: "Начинаю парсинг Telegram-каналов...",
        });
        const posts = await runParser();
        if (posts.length === 0) {
          throw new Error(
            "Не найдено ни одного поста. Проверьте каналы и время."
          );
        }
        dispatch("progress", {
          message: `Собрано ${posts.length} постов. Готовлю к анализу...`,
        });

        const largeString = formatPostsToString(posts);

        // --- ШАГ 2: ОБРАБОТКА НЕЙРОСЕТЬЮ ---
        const NUM_CHUNKS = 8;
        const chunks = splitTextIntoChunks(largeString, NUM_CHUNKS);

        dispatch("progress", {
          message: `Текст разбит на ${NUM_CHUNKS} частей. Отправляю на обработку...`,
        });

        const promises = chunks.map((chunk, index) =>
          processChunkWithAI(chunk).then((result) => {
            dispatch("progress", {
              message: `Обработана часть ${index + 1}/${NUM_CHUNKS}`,
            });
            return result;
          })
        );

        const allResults = await Promise.all(promises);

        // --- ШАГ 3: СБОРКА РЕЗУЛЬТАТА ---
        // Просто "сплющиваем" массив массивов в один
        const finalJson = allResults.flat();

        dispatch("progress", {
          message:
            "Анализ завершен. Отправляю данные для генерации документа...",
        });

        // --- ШАГ 4: ОТПРАВКА ФИНАЛЬНЫХ ДАННЫХ ---
        dispatch("final_data", { jsonData: finalJson });
      } catch (error: any) {
        console.error("Error in SSE stream:", error);
        dispatch("error", {
          message: error.message || "Произошла неизвестная ошибка на сервере",
        });
      } finally {
        // --- ШАГ 5: ЗАКРЫТИЕ ПОТОКА ---
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
