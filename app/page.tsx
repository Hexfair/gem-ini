"use client";

import { useState } from "react";
import "./globals.css";
import GenerateDocButton from "@/utils/GenerateDocButton";

// Доступные модели
const MODELS = [
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
];

export default function Home() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id); // По умолчанию первая модель

  const handleClick = async () => {
    if (!input.trim()) {
      setError("Пожалуйста, введите текст");
      return;
    }

    setLoading(true);
    setError("");
    setOutput("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: input,
          model: selectedModel,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Ошибка при отправке запроса");
      }

      setOutput(data.text || "Получен пустой ответ");
    } catch (err: any) {
      console.error("Ошибка:", err);
      setError(err.message || "Произошла ошибка при отправке запроса");
      setOutput("");
    } finally {
      setLoading(false);
    }
  };

  const data = [
    {
      title: "Первый раздел документа",
      data: [
        {
          subtitle: "Введение в тему",
          text: "Это основной текст для первого подраздела. Он описывает важные аспекты и детали. Текст будет автоматически переноситься по словам, если он не помещается в одну строку. Это очень удобно для форматирования больших объемов информации.",
          images: [
            "https://pngicon.ru/file/uploads/popugaj.png",
            "/images/image2.png",
          ], // Путь от папки public
        },
        {
          subtitle: "Основные положения",
          text: "Здесь мы рассматриваем ключевые моменты. Шрифт Times New Roman размером 14 пунктов является стандартом для многих официальных документов.",
          images: ["/images/image3.png"],
        },
      ],
    },
    {
      title: "Второй раздел документа",
      data: [
        {
          subtitle: "Анализ данных",
          text: "Текст второго раздела. Мы анализируем полученные данные и делаем выводы. Поля страницы установлены как стандартные для формата А4.",
          images: [], // Можно оставлять пустым, если картинок нет
        },
      ],
    },
    {
      title: "Третий раздел: Заключение",
      data: [
        {
          subtitle: "Выводы и рекомендации",
          text: "В заключительной части мы подводим итоги проделанной работы и даем рекомендации для дальнейших действий. Весь документ оформлен в едином стиле согласно требованиям.",
          images: ["/images/image4.png"],
        },
      ],
    },
  ] as const;

  return (
    <div className="container">
      <div className="content">
        <div className="header">
          <h1>Google Gemini API Пример</h1>
          <p>Введите текст и получите ответ от ИИ</p>
        </div>

        <div className="card">
          <div className="form-group">
            <label htmlFor="model" className="label">
              Выберите модель
            </label>
            <select
              id="model"
              className="select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={loading}
            >
              {MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="input" className="label">
              Входной текст
            </label>
            <textarea
              id="input"
              rows={6}
              className="textarea"
              placeholder="Введите текст для обработки..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError("");
              }}
            />
          </div>

          <div className="button-container">
            <button
              onClick={handleClick}
              disabled={loading || !input.trim()}
              className="button"
            >
              {loading ? "Отправка..." : "Отправить запрос"}
            </button>
          </div>

          {error && <div className="error-message">Ошибка: {error}</div>}

          <div className="form-group">
            <label htmlFor="output" className="label">
              Ответ от ИИ
            </label>
            <textarea
              id="output"
              rows={10}
              className="textarea"
              placeholder={
                loading ? "Генерация ответа..." : "Ответ появится здесь..."
              }
              value={output}
              readOnly
            />
          </div>
          <GenerateDocButton data={data as any} filename="output.docx" />
        </div>
      </div>
    </div>
  );
}
