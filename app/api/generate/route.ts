
import { GoogleGenAI } from '@google/genai';
import { NextRequest } from 'next/server';

// Поддерживаемые модели
const SUPPORTED_MODELS = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
];

export async function POST(request: NextRequest) {
    try {
        // Устанавливаем таймаут для запроса
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 секунд

        const body = await request.json();
        const { contents, model } = body;

        if (!contents) {
            return Response.json(
                { error: 'Текст не может быть пустым' },
                { status: 400 }
            );
        }

        if (!model) {
            return Response.json(
                { error: 'Модель не указана' },
                { status: 400 }
            );
        }

        if (!SUPPORTED_MODELS.includes(model)) {
            return Response.json(
                { error: 'Указанная модель не поддерживается' },
                { status: 400 }
            );
        }

        if (!process.env.GOOGLE_API_KEY) {
            clearTimeout(timeoutId);
            return Response.json(
                { error: 'API ключ не найден в переменных окружения' },
                { status: 500 }
            );
        }

        try {

            const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
            const response = await ai.models.generateContent({
                model: "gemini-2.5-pro",
                contents: contents,
            });

            const text = response.text;
            clearTimeout(timeoutId);
            return Response.json({ text });
        } catch (apiError: any) {
            clearTimeout(timeoutId);

            // Более детальная обработка ошибок API
            if (apiError.message?.includes('timeout') || apiError.message?.includes('deadline')) {
                return Response.json(
                    { error: 'Превышено время ожидания ответа от ИИ' },
                    { status: 408 }
                );
            }

            console.error('Gemini API Error:', apiError);
            return Response.json(
                { error: `Ошибка API: ${apiError.message || 'Неизвестная ошибка'}` },
                { status: 500 }
            );
        }
    } catch (error: any) {
        console.error('Server Error:', error);
        return Response.json(
            { error: `Серверная ошибка: ${error.message || 'Неизвестная ошибка'}` },
            { status: 500 }
        );
    }
}



