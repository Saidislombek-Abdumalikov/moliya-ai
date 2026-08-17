import type { VercelRequest, VercelResponse } from '@vercel/node';

const PROJECT_ID = "arctic-pad-sn56p";
const DATABASE_ID = "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a";
const REST_BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: Fetch AI usage logs for Admin Dashboard analytics
  if (req.method === 'GET') {
    try {
      const restUrl = `${REST_BASE_URL}/ai_global_logs?pageSize=100`;
      const restRes = await fetch(restUrl);

      if (!restRes.ok) {
        return res.status(200).json({ success: true, logs: [] });
      }

      const json: any = await restRes.json();
      const documents = json.documents || [];
      const logsList: any[] = [];

      for (const docObj of documents) {
        const nameParts = (docObj.name || '').split('/');
        const logId = nameParts[nameParts.length - 1];
        const fields = docObj.fields || {};

        logsList.push({
          id: logId,
          userId: fields.userId?.stringValue || 'guest',
          queryType: fields.queryType?.stringValue || 'text',
          promptSummary: fields.promptSummary?.stringValue || '',
          isPremium: fields.isPremium?.booleanValue || false,
          timestamp: fields.timestamp?.stringValue || new Date().toISOString()
        });
      }

      return res.status(200).json({ success: true, count: logsList.length, logs: logsList });
    } catch (e: any) {
      console.error('Error fetching AI logs:', e);
      return res.status(500).json({ error: 'Failed to fetch AI logs', details: e?.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
