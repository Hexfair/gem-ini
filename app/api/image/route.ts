// app/api/image/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import sharp from "sharp";

const DEFAULT_TIMEOUT_MS = Number(process.env.IMAGE_PROXY_TIMEOUT_MS ?? 8000);
const MAX_SIZE_BYTES = Number(
  process.env.IMAGE_PROXY_MAX_SIZE ?? 15 * 1024 * 1024
); // 15MB
// РЕКОМЕНДУЕТСЯ указать список доменов через env, иначе прокси будет «открытым»
const ALLOWLIST = (process.env.IMAGE_PROXY_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Простейший плейсхолдер PNG через SVG (без зависимостей кроме sharp)
async function placeholderPng(
  w = 1024,
  h = 768,
  label = "Image unavailable",
  bg = "#EEEEEE",
  fg = "#777777"
): Promise<Buffer> {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="${bg}"/>
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(
            16,
            Math.floor(Math.min(w, h) / 20)
          )}" fill="${fg}">
      ${label}
    </text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function isSupportedContentType(ct?: string | null) {
  if (!ct) return false;
  const t = ct.toLowerCase();
  return /(image\/(jpeg|jpg|png|gif|bmp|webp|avif|svg\+xml|svg))/.test(t);
}

function mustConvertToPng(ct?: string | null) {
  if (!ct) return true;
  const t = ct.toLowerCase();
  // всё, кроме jpeg/png, конвертируем в PNG для совместимости с Word
  return !/(image\/(jpeg|jpg|png))/.test(t);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const ref = searchParams.get("ref") || undefined; // необязательный реферер
  const timeoutMs = Number(searchParams.get("timeout") ?? DEFAULT_TIMEOUT_MS);
  const fb = (searchParams.get("fallback") || "placeholder").toLowerCase(); // placeholder | empty
  const phW = Number(searchParams.get("w") ?? 1024);
  const phH = Number(searchParams.get("h") ?? 768);
  const phLabel = searchParams.get("label") || "Image unavailable";

  if (!url) return new Response("Missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return new Response("Bad url", { status: 400 });
  }

  // Белый список доменов
  if (ALLOWLIST.length && !ALLOWLIST.includes(target.hostname.toLowerCase())) {
    return new Response("Forbidden host", { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        accept:
          "image/jpeg,image/jpg,image/png,image/gif,image/bmp,image/webp,image/avif;q=0.9,*/*;q=0.1",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        referer: ref || `${target.origin}`,
      },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!upstream.ok) {
      // Нет доступа: возвращаем плейсхолдер/пустой ответ (не 4xx, чтобы клиент не падал)
      if (fb === "empty") return new Response(null, { status: 204 });
      const png = await placeholderPng(phW, phH, phLabel);
      return new Response(png, {
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store",
          "x-upstream-status": String(upstream.status),
          "x-fallback": "placeholder",
        },
      });
    }

    // Проверка размера (если указал сервер)
    const len = upstream.headers.get("content-length");
    if (len && Number(len) > MAX_SIZE_BYTES) {
      if (fb === "empty") return new Response(null, { status: 204 });
      const png = await placeholderPng(phW, phH, "Too large");
      return new Response(png, {
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store",
          "x-upstream-status": String(upstream.status),
          "x-fallback": "too-large",
        },
      });
    }

    // Скачиваем буфер
    const buf = Buffer.from(await upstream.arrayBuffer());
    let contentType = upstream.headers.get("content-type")?.toLowerCase() || "";

    // Если пришло «не картинка» либо тип подозрительный — конвертируем в PNG
    if (!isSupportedContentType(contentType) || mustConvertToPng(contentType)) {
      const out = await sharp(buf).toColourspace("srgb").png().toBuffer();
      return new Response(out, {
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store",
          "x-upstream-status": String(upstream.status),
        },
      });
    }

    // Для jpeg/png отдаём как есть (можно включить нормализацию в sRGB при желании)
    return new Response(buf, {
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
        "x-upstream-status": String(upstream.status),
      },
    });
  } catch (e) {
    // Сетевой таймаут/ошибка — плейсхолдер
    if (fb === "empty") return new Response(null, { status: 204 });
    const png = await placeholderPng(phW, phH, phLabel);
    return new Response(png, {
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-fallback": "network-error",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
