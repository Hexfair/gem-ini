// lib/parser.ts

import * as cheerio from "cheerio";
//@ts-ignore
import type { Cheerio, Element } from "cheerio";
import { promises as fs } from "fs";
import path from "path";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export interface TelegramPost {
  channel: string;
  author: string;
  datetime: Date;
  datetimeMsk: string;
  text: string;
  images: string[];
  videos: string[];
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
};
const mskTimeZone = "Europe/Moscow";

function normalizeHttps(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("http://"))
    return "https://" + url.substring("http://".length);
  return url;
}

function extractUrlsFromStyle(styleValue: string | null | undefined): string[] {
  if (!styleValue) return [];
  const matches = [...styleValue.matchAll(/url\((?:'|")?(.*?)(?:'|")?\)/g)];
  return matches.map((match) => match[1]).filter(Boolean);
}

function selectMainTextBlock(
  $: cheerio.CheerioAPI,
  root: Cheerio<Element>
): Cheerio<Element> | null {
  const textBlocks = root.find(".tgme_widget_message_text.js-message_text");
  if (textBlocks.length > 0) {
    return textBlocks.last();
  }
  const allTexts = root.find(".tgme_widget_message_text");
  if (allTexts.length === 0) return null;
  const reversedElements = allTexts.toArray().reverse();
  for (const el of reversedElements) {
    const $el = $(el);
    if (!$el.hasClass("js-message_reply_text")) {
      return $el;
    }
  }
  return null;
}

function extractMediaFromElement(
  $: cheerio.CheerioAPI,
  root: Cheerio<Element>
): { images: string[]; videos: string[] } {
  const imageUrls = new Set<string>();
  const videoUrls = new Set<string>();
  const selectors = [
    ".tgme_widget_message_text.js-message_text",
    ".media_supported_cont",
    ".tgme_widget_message_grouped_wrap",
    ".tgme_widget_message_video_player",
    ".tgme_widget_message_photo_wrap",
  ];

  selectors.forEach((selector) => {
    const block = root.find(selector);
    if (block.length > 0) {
      const clone = block.clone();
      clone.find(".tgme_widget_message_reply, .js-message_reply_text").remove();

      clone.find("img[src]").each((_, el) => {
        const src = $(el).attr("src");
        if (src && !/telegram\.org\/img\/emoji|userpic|avatar/.test(src)) {
          imageUrls.add(normalizeHttps(src));
        }
      });

      clone.find("[style]").each((_, el) => {
        const style = $(el).attr("style");
        if (style) {
          extractUrlsFromStyle(style).forEach((url) => {
            if (!/emoji|userpic|avatar|svg/.test(url)) {
              imageUrls.add(normalizeHttps(url));
            }
          });
        }
      });

      clone.find("video[src]").each((_, el) => {
        videoUrls.add(normalizeHttps($(el).attr("src")));
      });

      clone.find("video source[src]").each((_, el) => {
        videoUrls.add(normalizeHttps($(el).attr("src")));
      });
    }
  });

  return { images: Array.from(imageUrls), videos: Array.from(videoUrls) };
}

async function fetchSinglePostAndExtract(
  dataPost: string
): Promise<{ text: string | null; images: string[]; videos: string[] }> {
  const url = `https://t.me/${dataPost}?single`;
  console.log(`Загружаем одиночный пост: ${url}`);
  try {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    const mainSpan = selectMainTextBlock($, $("body"));
    const text = mainSpan
      ? mainSpan
          .text()
          .trim()
          .replace(/\n\s*\n/g, "\n")
      : null;
    const { images, videos } = extractMediaFromElement($, $("body"));
    return { text, images, videos };
  } catch (error) {
    console.error(`Ошибка при загрузке ${url}:`, error);
    return { text: null, images: [], videos: [] };
  }
}

async function parseChannelByDatetime(
  channel: string,
  startDatetime: Date
): Promise<TelegramPost[]> {
  const url = `https://t.me/s/${channel}`;
  console.log(`Парсим канал: ${url}`);
  try {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    const messages = $(".tgme_widget_message");
    const results: TelegramPost[] = [];
    for (const msgEl of messages.toArray()) {
      const $msg = $(msgEl);
      const timeTag = $msg.find("time[datetime]");
      if (!timeTag.length) continue;
      const datetimeAttr = timeTag.attr("datetime");
      if (!datetimeAttr) continue;
      const msgTime = new Date(datetimeAttr);
      if (isNaN(msgTime.getTime()) || msgTime < startDatetime) {
        continue;
      }
      let text: string | null = null;
      const mainSpan = selectMainTextBlock($, $msg);
      if (mainSpan) {
        text = mainSpan
          .text()
          .trim()
          .replace(/\n\s*\n/g, "\n");
      }
      let { images, videos } = extractMediaFromElement($, $msg);
      if (!text) {
        const dataPost = $msg.attr("data-post");
        if (dataPost) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const singlePost = await fetchSinglePostAndExtract(dataPost);
          text = singlePost.text;
          if (images.length === 0 && videos.length === 0) {
            images = singlePost.images;
            videos = singlePost.videos;
          }
        }
      }
      if (!text) continue;
      const author =
        $msg.find(".tgme_widget_message_owner_name").text().trim() || channel;
      results.push({
        channel,
        author,
        datetime: msgTime,
        datetimeMsk: formatInTimeZone(
          msgTime,
          mskTimeZone,
          "yyyy-MM-dd HH:mm:ss zzz"
        ),
        text,
        images,
        videos,
      });
    }
    return results;
  } catch (error) {
    console.error(`Ошибка при загрузке канала ${channel}:`, error);
    return [];
  }
}

export async function runParser(
  onProgress?: (details: {
    channel: string;
    index: number;
    total: number;
  }) => void
): Promise<TelegramPost[]> {
  const channelsPath = path.join(process.cwd(), "channels.txt");
  const data = await fs.readFile(channelsPath, "utf-8");
  const channels = data
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (channels.length === 0) {
    throw new Error("Файл 'channels.txt' пуст или не найден.");
  }

  console.log(`Загружено ${channels.length} каналов: ${channels.join(", ")}`);

  const now = new Date();
  const startOfDayLocal = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0
  );
  const startDatetimeUTC = fromZonedTime(startOfDayLocal, mskTimeZone);

  console.log(
    `Парсим сообщения с ${formatInTimeZone(
      startDatetimeUTC,
      mskTimeZone,
      "yyyy-MM-dd HH:mm zzz"
    )}`
  );

  let allResults: TelegramPost[] = [];

  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];

    if (onProgress) {
      onProgress({ channel, index: i, total: channels.length });
    }

    console.log(
      `\n--- Обработка канала ${i + 1}/${channels.length}: ${channel} ---\n`
    );
    const channelResults = await parseChannelByDatetime(
      channel,
      startDatetimeUTC
    );
    allResults.push(...channelResults);
    console.log(`Собрано ${channelResults.length} постов с канала ${channel}.`);

    if (i < channels.length - 1) {
      console.log("Пауза 1 секунда...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  allResults.sort((a, b) => b.datetime.getTime() - a.datetime.getTime());

  console.log(
    `\nИТОГО: Собрано ${allResults.length} постов из ${channels.length} каналов.`
  );
  return allResults;
}
