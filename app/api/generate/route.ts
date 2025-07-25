import { GoogleGenAI } from "@google/genai";
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contents } = body;

        if (!contents) {
            return Response.json(
                { error: 'Текст не может быть пустым' },
                { status: 400 }
            );
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-pro",
            contents: contents,
        });

        const text = response.text;
        console.log(text);
        return Response.json({ text });
    } catch (error) {
        console.error('API Error:', error);
        return Response.json(
            { error: 'Ошибка при генерации контента' },
            { status: 500 }
        );
    }
}

export const runtime = 'edge';