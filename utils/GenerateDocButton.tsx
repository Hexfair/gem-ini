"use client";

import React, { useState } from "react";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun,
  convertMillimetersToTwip,
} from "docx";

// Типы входных данных
export type Item = {
  text: string;
  images: string[]; // URL картинок
  figureCaption?: string; // подпись: "Рис. ХХХ"
};
export type Block = {
  subtitle: string;
  items: Item[];
};
export type Section = {
  title: string;
  data: Block[];
};

// Параметры страницы и отступов
const A4_MM = { width: 210, height: 297 };
// Поля: верх/низ — 2 см, левое — 3 см, правое — 1.5 см
const MARGINS_MM = { top: 20, bottom: 20, left: 30, right: 15 };
const RED_LINE_MM = 12.5; // 1.25 см — красная строка и левый отступ у H2
const TOC_L2_INDENT_CM = 0.75; // отступ подпунктов в оглавлении (Heading 2)

// Величины для изображений
const ONE_IMG_LONG_SIDE_CM = 8; // 1 картинка: длинная сторона = 8 см
const TWO_IMG_MAX_WIDTH_CM = 7.7; // 2 картинки в ряд: ширина каждой ≤ 7.7 см

// Утилиты
const ptToTwip = (pt: number) => Math.round(pt * 20);
const mmToInches = (mm: number) => mm / 25.4;
const inchesToPx = (inches: number) => Math.round(inches * 96);
const mmToPx = (mm: number) => inchesToPx(mmToInches(mm));
const cmToPx = (cm: number) => Math.round((cm / 2.54) * 96);

// Пустая строка точной высоты (EXACT), без внешних интервалов
const blankLineExact = (pt: number) =>
  new Paragraph({
    spacing: {
      before: 0,
      after: 0,
      line: ptToTwip(pt),
      lineRule: LineRuleType.EXACT,
    },
    children: [new TextRun({ text: " ", size: pt * 2 })], // size в полупунктах
  });

// Текстовые параграфы (выравнивание по ширине + красная строка 1.25 см)
const textParagraphs = (text?: string) => {
  if (!text) return [];
  const indent = { firstLine: convertMillimetersToTwip(RED_LINE_MM) };
  return String(text)
    .split(/\r?\n/)
    .map(
      (line) =>
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { before: 0, after: 0 },
          indent,
          children: [new TextRun({ text: line })],
        })
    );
};

// Проксируем URL (используй свой /api/image)
const toProxied = (url: string) =>
  url.startsWith("/api/image") || url.startsWith("data:")
    ? url
    : `/api/image?url=${encodeURIComponent(url)}`;

// Натуральные размеры картинки в браузере
function getNaturalSize(
  blob: Blob
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const out = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(img.src);
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Cannot load image"));
    };
    img.src = URL.createObjectURL(blob);
  });
}

// Скачиваем картинку и получаем байты + натуральные размеры
async function fetchImageData(url: string) {
  const res = await fetch(toProxied(url));
  if (!res.ok) throw new Error(`Image fetch failed: ${url} (${res.status})`);
  const blob = await res.blob();
  const [arrayBuffer, natural] = await Promise.all([
    blob.arrayBuffer(),
    getNaturalSize(blob),
  ]);
  const data = new Uint8Array(arrayBuffer);
  return { data, natural };
}

// Масштабирование: 1 картинка (длинная сторона = 8 см)
function scaleForSingle(nw: number, nh: number) {
  const longPx = cmToPx(ONE_IMG_LONG_SIDE_CM);
  if (nh > nw) {
    const height = longPx;
    const width = Math.max(1, Math.round((nw * height) / nh));
    return { width, height };
  } else {
    const width = longPx;
    const height = Math.max(1, Math.round((nh * width) / nw));
    return { width, height };
  }
}

// Масштабирование: 2 картинки в ряд (ширина ≤ 7.7 см)
function scaleForPair(nw: number, nh: number) {
  const maxW = cmToPx(TWO_IMG_MAX_WIDTH_CM);
  if (nw <= maxW) return { width: nw, height: nh };
  const width = maxW;
  const height = Math.max(1, Math.round((nh * width) / nw));
  return { width, height };
}

// Создание ImageRun (обход TS-конфликтов assertion-ом)
function createImageRun(data: Uint8Array, width: number, height: number) {
  const options = {
    data,
    transformation: { width, height },
  } as unknown as ConstructorParameters<typeof ImageRun>[0];
  return new ImageRun(options);
}

// Подпись "Рис. ХХХ" (12 пт), центр
function captionParagraph(caption?: string) {
  const text = `Рис. ${caption ?? "ХХХ"}`;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [
      new TextRun({ text, size: 24 /* 12 пт */, color: "000000", bold: false }),
    ],
  });
}

// Параграф с двумя картинками в одну строку (центр, между ними 2 пробела)
function pairRowParagraph(
  a: { data: Uint8Array; natural: { width: number; height: number } },
  b: { data: Uint8Array; natural: { width: number; height: number } }
) {
  const aScaled = scaleForPair(a.natural.width, a.natural.height);
  const bScaled = scaleForPair(b.natural.width, b.natural.height);

  const imgA = createImageRun(a.data, aScaled.width, aScaled.height);
  const imgB = createImageRun(b.data, bScaled.width, bScaled.height);

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [imgA, new TextRun({ text: "  " }), imgB],
  });
}

// Параграф с одной картинкой (центр)
function singleRowParagraph(item: {
  data: Uint8Array;
  natural: { width: number; height: number };
}) {
  const scaled = scaleForSingle(item.natural.width, item.natural.height);
  const img = createImageRun(item.data, scaled.width, scaled.height);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [img],
  });
}

// Группа картинок: чётные → пары построчно; нечётные → пары + последняя одиночная
async function imagesGroupParagraphs(urls: string[]): Promise<Paragraph[]> {
  const items = await Promise.all(urls.map((u) => fetchImageData(u)));
  const rows: Paragraph[] = [];
  let i = 0;
  for (; i + 1 < items.length; i += 2) {
    rows.push(pairRowParagraph(items[i], items[i + 1]));
  }
  if (i < items.length) {
    rows.push(singleRowParagraph(items[i]));
  }
  return rows;
}

// Сборка документа с первой страницей «Содержание»
export async function buildDocFromJson(sectionsData: Section[]) {
  const tocChildren: Array<Paragraph | TableOfContents> = [];
  const contentChildren: Paragraph[] = [];

  // Заголовок «СОДЕРЖАНИЕ»
  tocChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      children: [
        new TextRun({
          text: "СОДЕРЖАНИЕ",
          bold: false,
          size: 28,
          color: "000000",
        }),
      ],
    })
  );
  tocChildren.push(blankLineExact(14));

  // Поле оглавления (уровни H1–H2), ссылки отключены
  tocChildren.push(
    new TableOfContents("", {
      hyperlink: false,
      headingStyleRange: "1-2",
    })
  );

  // Контент: H1/H2 помечаем HeadingLevel для TOC
  for (let i = 0; i < sectionsData.length; i++) {
    const section = sectionsData[i] ?? ({ title: "", data: [] } as Section);
    const sectionNumber = `${i + 1}.`;
    const title = String(section.title ?? "").toUpperCase();

    // H1 — по центру
    contentChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: `${sectionNumber} ${title}` })],
      })
    );

    const blocks = Array.isArray(section.data) ? section.data : [];

    // Между H1 и первым H2 — 14 пт
    if (blocks.length > 0) {
      contentChildren.push(blankLineExact(14));
    }

    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[j] ?? ({ subtitle: "", items: [] } as Block);
      const subNumber = `${i + 1}.${j + 1}`;
      const subtitle = String(block.subtitle ?? "");
      const items = Array.isArray(block.items) ? block.items : [];

      // H2 — левый отступ 1.25 см
      contentChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 0, after: 0 },
          indent: { left: convertMillimetersToTwip(RED_LINE_MM) },
          children: [new TextRun({ text: `${subNumber} ${subtitle}` })],
        })
      );

      // Между H2 и содержимым — 4 пт (если есть элементы)
      if (items.length > 0) {
        contentChildren.push(blankLineExact(4));
      }

      for (let k = 0; k < items.length; k++) {
        const item = items[k] ?? ({ text: "", images: [] } as Item);
        const imgs = Array.isArray(item.images) ? item.images : [];

        // Текст
        const textParas = textParagraphs(item.text);
        contentChildren.push(...textParas);

        // Между текстом и картинкой(ами) — 14 пт (если есть и то, и то)
        if (textParas.length > 0 && imgs.length > 0) {
          contentChildren.push(blankLineExact(14));
        }

        // Картинки: пары по строкам + возможная одиночная последняя
        if (imgs.length > 0) {
          const imgRows = await imagesGroupParagraphs(imgs);
          contentChildren.push(...imgRows);

          // Подпись к группе изображений текущего item (только из item.figureCaption)
          contentChildren.push(captionParagraph(item.figureCaption));
        }

        // Если в блоке несколько items — разделяем пустой строкой (14 пт)
        if (k < items.length - 1) {
          contentChildren.push(blankLineExact(14));
        }
      }

      // Разделитель между блоками (H2) — 14 пт (кроме последнего в разделе)
      if (j < blocks.length - 1) {
        contentChildren.push(blankLineExact(14));
      }
    }

    // Между разделами — 2 строки по 14 пт
    if (
      i < sectionsData.length - 1 &&
      (sectionsData[i].data?.length ?? 0) > 0
    ) {
      contentChildren.push(blankLineExact(14));
      contentChildren.push(blankLineExact(14));
    }
  }

  const doc = new Document({
    features: { updateFields: false }, // ручное обновление TOC для стабильности
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 28, color: "000000" }, // 14 пт
        },
      },
      // Переопределяем стили заголовков и TOC
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 28,
            color: "000000",
            bold: true,
          },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: "Times New Roman",
            size: 28,
            color: "000000",
            bold: true,
          },
          paragraph: {
            spacing: { before: 0, after: 0 },
            indent: { left: convertMillimetersToTwip(RED_LINE_MM) },
          },
        },
        // TOC уровни — чёрные и не жирные; TOC2 с отступом 0.75 см
        {
          id: "TOC1",
          name: "TOC 1",
          basedOn: "Normal",
          run: {
            font: "Times New Roman",
            size: 28,
            color: "000000",
            bold: false,
          },
        },
        {
          id: "TOC2",
          name: "TOC 2",
          basedOn: "Normal",
          run: {
            font: "Times New Roman",
            size: 28,
            color: "000000",
            bold: false,
          },
          paragraph: {
            indent: { left: convertMillimetersToTwip(TOC_L2_INDENT_CM * 10) }, // 0.75 см = 7.5 мм
          },
        },
      ],
    },
    sections: [
      // 1-я страница: Содержание
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(A4_MM.width),
              height: convertMillimetersToTwip(A4_MM.height),
            },
            margin: {
              top: convertMillimetersToTwip(MARGINS_MM.top),
              right: convertMillimetersToTwip(MARGINS_MM.right),
              bottom: convertMillimetersToTwip(MARGINS_MM.bottom),
              left: convertMillimetersToTwip(MARGINS_MM.left),
            },
          },
        },
        children: tocChildren as unknown as Paragraph[], // приведение типов для TOC
      },
      // 2-я страница и далее: основной контент
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(A4_MM.width),
              height: convertMillimetersToTwip(A4_MM.height),
            },
            margin: {
              top: convertMillimetersToTwip(MARGINS_MM.top),
              right: convertMillimetersToTwip(MARGINS_MM.right),
              bottom: convertMillimetersToTwip(MARGINS_MM.bottom),
              left: convertMillimetersToTwip(MARGINS_MM.left),
            },
          },
        },
        children: contentChildren,
      },
    ],
  });

  return doc;
}

type Props = {
  data: Section[];
  filename?: string;
};

export default function GenerateDocButton({
  data,
  filename = "document.docx",
}: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    try {
      setLoading(true);
      const doc = await buildDocFromJson(data);
      const blob = await Packer.toBlob(doc);

      // Автоскачивание
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error(e);
      alert("Не удалось сформировать документ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleClick} disabled={loading}>
      {loading ? "Формирование..." : "Скачать DOCX"}
    </button>
  );
}
