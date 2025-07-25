'use client';

import { useState } from 'react';
import './globals.css';

export default function Home() {
    const [input, setInput] = useState('');
    const [output, setOutput] = useState('');
    const [loading, setLoading] = useState(false);

    const handleClick = async () => {
        if (!input.trim()) return;

        setLoading(true);
        try {
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ contents: input }),
            });

            const data = await res.json();
            setOutput(data.text || 'Ошибка получения ответа');
        } catch (error) {
            console.error('Ошибка:', error);
            setOutput('Произошла ошибка при отправке запроса');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container">
            <div className="content">
                <div className="header">
                    <h1>Google Gemini API</h1>
                    <p>Введите текст и получите ответ от ИИ</p>
                </div>

                <div className="card">
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
                            onChange={(e) => setInput(e.target.value)}
                        />
                    </div>

                    <div className="button-container">
                        <button
                            onClick={handleClick}
                            disabled={loading || !input.trim()}
                            className="button"
                        >
                            {loading ? 'Отправка...' : 'Отправить запрос'}
                        </button>
                    </div>

                    <div className="form-group">
                        <label htmlFor="output" className="label">
                            Ответ от ИИ
                        </label>
                        <textarea
                            id="output"
                            rows={10}
                            className="textarea"
                            placeholder="Ответ появится здесь..."
                            value={output}
                            readOnly
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}