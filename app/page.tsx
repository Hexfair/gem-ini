"use client";

import { useState, useEffect } from "react";
import "./globals.css";
// Импортируем ваш компонент кнопки, но использовать будем его логику
import GenerateDocButton, { Section } from "@/utils/GenerateDocButton";

// Т.к. GenerateDocButton - компонент, а нам нужна логика,
// вы можете либо переделать его в hook/функцию, либо вызвать его невидимым.
// Проще всего скопировать его логику прямо сюда.

import { Packer } from "docx";
// Предположим, что buildDocFromJson экспортируется из файла с кнопкой
import { buildDocFromJson } from "@/utils/GenerateDocButton";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [finalJsonData, setFinalJsonData] = useState<Section[] | null>(null);

  const handleStart = async () => {
    setLoading(true);
    setError("");
    setProgressMessage("Подключение к серверу...");
    setFinalJsonData(null);

    const eventSource = new EventSource("/api/process-all");

    eventSource.onmessage = (event) => {
      // Это общее событие, мы будем использовать именованные
      console.log("Received generic message:", event.data);
    };

    eventSource.addEventListener("progress", (event) => {
      const data = JSON.parse(event.data);
      setProgressMessage(data.message);
    });

    eventSource.addEventListener("final_data", (event) => {
      const data = JSON.parse(event.data);
      setFinalJsonData(data.jsonData); // Сохраняем финальные данные
      setProgressMessage("Данные получены! Начинаю генерацию документа...");
      eventSource.close(); // Завершаем соединение
    });

    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      setError("Ошибка соединения с сервером. Попробуйте снова.");
      setLoading(false);
      eventSource.close();
    };
  };

  // Этот эффект запустится, когда finalJsonData будет получен
  useEffect(() => {
    if (finalJsonData) {
      const generateAndDownload = async () => {
        try {
          // Вызываем логику из вашего GenerateDocButton
          const doc = await buildDocFromJson(finalJsonData);
          const blob = await Packer.toBlob(doc);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `report_${new Date().toISOString().split("T")[0]}.docx`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);

          setProgressMessage("Документ успешно сгенерирован и скачан!");
        } catch (e) {
          console.error(e);
          setError("Не удалось сформировать DOCX документ.");
        } finally {
          setLoading(false);
        }
      };

      generateAndDownload();
    }
  }, [finalJsonData]);

  return (
    <div className="container">
      <div className="content">
        <div className="header">
          <h1>Анализатор новостей</h1>
          <p>Нажмите "Старт" для сбора, анализа и формирования отчета</p>
        </div>

        <div className="card">
          <div className="button-container">
            <button onClick={handleStart} disabled={loading} className="button">
              {loading ? "В процессе..." : "Старт"}
            </button>
          </div>

          {loading && (
            <div className="progress-bar">
              <div className="spinner"></div>
              <p>{progressMessage}</p>
            </div>
          )}

          {!loading && progressMessage && !error && (
            <div className="success-message">{progressMessage}</div>
          )}

          {error && <div className="error-message">Ошибка: {error}</div>}
        </div>
      </div>
    </div>
  );
}
