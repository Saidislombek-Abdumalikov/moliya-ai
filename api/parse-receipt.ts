import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Image, mimeType } = req.body || {};
    if (!base64Image) {
      return res.status(400).json({ error: 'Missing base64Image' });
    }

    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const imageMime = mimeType || 'image/jpeg';

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
    if (apiKey) {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Analyze this receipt image (Uzbekistan/Global receipt) and extract:
- type: 'expense'
- amount: total paid number in UZS currency (e.g. 50000, 120000)
- category: string ('Oziq-ovqat', 'Transport', 'Kiyim', 'Kommunal', 'Sog\'liq', 'Ta\'lim', 'Boshqa')
- title: store name or main item (e.g. 'Korzinka', 'Makro', 'Taksi')
- note: summary of purchased items`;

      let response;
      try {
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              inlineData: {
                mimeType: imageMime,
                data: cleanBase64
              }
            },
            prompt
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                category: { type: Type.STRING },
                title: { type: Type.STRING },
                note: { type: Type.STRING },
              },
              required: ["type", "amount", "category", "title"],
            }
          }
        });
      } catch (err) {
        console.warn('Gemini 2.5 flash vision parse failed, trying gemini-1.5-flash:', err);
        response = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: [
            {
              inlineData: {
                mimeType: imageMime,
                data: cleanBase64
              }
            },
            prompt
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                category: { type: Type.STRING },
                title: { type: Type.STRING },
                note: { type: Type.STRING },
              },
              required: ["type", "amount", "category", "title"],
            }
          }
        });
      }

      if (response && response.text) {
        const parsed = JSON.parse(response.text);
        if (parsed.amount) {
          const fmtAmt = parsed.amount.toLocaleString('en-US').replace(/,/g, ' ');
          return res.status(200).json({
            type: parsed.type || 'expense',
            amount: fmtAmt,
            category: parsed.category || 'Oziq-ovqat',
            title: parsed.title || 'Chek xarajati',
            note: parsed.note || parsed.title || 'Chek rasmi tahlil qilindi',
          });
        }
      }
    }
  } catch (e) {
    console.error('Error in /api/parse-receipt:', e);
  }

  return res.status(500).json({ error: 'Receipt parsing failed' });
}
