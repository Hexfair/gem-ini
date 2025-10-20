"use client";

import React, { useState } from "react";
import {
  AlignmentType,
  Document,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
  convertMillimetersToTwip,
} from "docx";

// Типы входных данных
type Block = {
  subtitle: string;
  text: string;
  images: string[];
};
type Section = {
  title: string;
  data: Block[];
};

// Параметры страницы и отступов
const A4_MM = { width: 210, height: 297 };
const MARGINS_MM = { top: 20, bottom: 20, left: 30, right: 15 }; // 2 см, 2 см, 3 см, 1.5 см
const RED_LINE_MM = 12.5; // 1.25 см — красная строка и левый отступ у H2

// Утилиты
const ptToTwip = (pt: number) => Math.round(pt * 20);
const mmToInches = (mm: number) => mm / 25.4;
const inchesToPx = (inches: number) => inches * 96;

// Ширина области контента (для масштабирования изображений)
const contentWidthPx = Math.floor(
  inchesToPx(mmToInches(A4_MM.width - (MARGINS_MM.left + MARGINS_MM.right)))
); // ~622 px

// Пустая строка заданной высоты (EXACT) без внешних интервалов
const blankLineExact = (pt: number) =>
  new Paragraph({
    spacing: {
      before: 0,
      after: 0,
      line: ptToTwip(pt),
      lineRule: LineRuleType.EXACT,
    },
    children: [new TextRun({ text: " ", size: pt * 2 })],
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

// Натуральные размеры картинки (в браузере)
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

// Загрузка изображения -> ImageRun (обход типового бага типов docx)
async function imageRunFromUrl(
  url: string,
  maxWidthPx = contentWidthPx
): Promise<ImageRun> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed: ${url} (${res.status})`);

  const blob = await res.blob();
  const [arrayBuffer, natural] = await Promise.all([
    blob.arrayBuffer(),
    getNaturalSize(blob),
  ]);

  let w = natural.width;
  let h = natural.height;
  if (w > maxWidthPx) {
    h = Math.round((h * maxWidthPx) / w);
    w = maxWidthPx;
  }

  const options = {
    data: new Uint8Array(arrayBuffer),
    transformation: { width: w, height: h },
  } as unknown as ConstructorParameters<typeof ImageRun>[0];

  return new ImageRun(options);
}

async function buildDocFromJson(sections: Section[]) {
  const children: Paragraph[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i] ?? ({ title: "", data: [] } as Section);
    const sectionNumber = `${i + 1}.`;
    const title = String(section.title ?? "").toUpperCase();

    // H1 — по центру, без внешних интервалов
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({ text: `${sectionNumber} ${title}`, bold: true }),
        ],
      })
    );

    const blocks = Array.isArray(section.data) ? section.data : [];

    // Между H1 и первым H2 — 14 пт (если есть подблоки)
    if (blocks.length > 0) {
      children.push(blankLineExact(14));
    }

    for (let j = 0; j < blocks.length; j++) {
      const block =
        blocks[j] ?? ({ subtitle: "", text: "", images: [] } as Block);
      const subNumber = `${i + 1}.${j + 1}`;
      const subtitle = String(block.subtitle ?? "");

      // H2 — левый отступ 1.25 см, без внешних интервалов
      children.push(
        new Paragraph({
          spacing: { before: 0, after: 0 },
          indent: { left: convertMillimetersToTwip(RED_LINE_MM) },
          children: [
            new TextRun({ text: `${subNumber} ${subtitle}`, bold: true }),
          ],
        })
      );

      // Между H2 и текстом — 4 пт (EXACT)
      children.push(blankLineExact(4));

      // Текст (красная строка 1.25 см)
      const textParas = textParagraphs(block.text);
      children.push(...textParas);

      // Между текстом и первой картинкой — 14 пт (если есть и то, и то)
      const imgs = Array.isArray(block.images) ? block.images : [];
      if (textParas.length > 0 && imgs.length > 0) {
        children.push(blankLineExact(14));
      }

      // Картинки под текстом
      for (const url of imgs) {
        try {
          const imgRun = await imageRunFromUrl(url);
          children.push(new Paragraph({ children: [imgRun] }));
        } catch {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `Не удалось загрузить изображение: ${url}`,
                }),
              ],
            })
          );
        }
      }

      // Разделитель между подблоками — 14 пт (кроме последнего в разделе)
      if (j < blocks.length - 1) {
        children.push(blankLineExact(14));
      }
    }

    // Между последним подблоком раздела и следующим H1 — 2 строки по 14 пт
    if (i < sections.length - 1 && blocks.length > 0) {
      children.push(blankLineExact(14));
      children.push(blankLineExact(14));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Times New Roman",
            size: 28, // 14 pt
            color: "000000",
          },
        },
      },
    },
    sections: [
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
        children,
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
