import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';
import { requireAdminAuth } from '../_adminAuthHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdminAuth(req, res)) return;
  try {

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('app_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'update') {
        const { id, title, message, emoji, type, target_audience, image_url, action_url, is_active } = req.body;
        
        if (!id) {
          return res.status(400).json({ error: 'Missing notification ID' });
        }

        const updates: any = {};
        if (title !== undefined) updates.title = title;
        if (message !== undefined) updates.message = message;
        if (emoji !== undefined) updates.emoji = emoji;
        if (type !== undefined) updates.type = type;
        if (target_audience !== undefined) updates.target_audience = target_audience;
        if (image_url !== undefined) updates.image_url = image_url;
        if (action_url !== undefined) updates.action_url = action_url;
        if (is_active !== undefined) updates.is_active = is_active;

        const { data, error } = await supabase
          .from('app_notifications')
          .update(updates)
          .eq('id', id)
          .select()
          .maybeSingle();

        if (error) {
          return res.status(500).json({ error: error.message });
        }

        return res.status(200).json(data);
      }

      if (action === 'delete') {
        const { id } = req.body;

        if (!id) {
          return res.status(400).json({ error: 'Missing notification ID' });
        }

        const { error } = await supabase
          .from('app_notifications')
          .delete()
          .eq('id', id);

        if (error) {
          return res.status(500).json({ error: error.message });
        }

        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
