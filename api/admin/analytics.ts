import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabaseClient.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      // Admin authentication
      const ADMIN_KEY = process.env.ADMIN_SECRET_KEY;
      if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const now = new Date();
      
      const dayAgo = new Date(now);
      dayAgo.setHours(dayAgo.getHours() - 24);
      
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      const [
        { count: totalQueries, error: totalErr },
        { count: todayQueries, error: todayErr },
        { count: weekQueries, error: weekErr },
        { data: logs, error: logsErr }
      ] = await Promise.all([
        supabase.from('ai_logs').select('id', { count: 'exact', head: true }),
        supabase.from('ai_logs').select('id', { count: 'exact', head: true }).gte('timestamp', dayAgo.toISOString()),
        supabase.from('ai_logs').select('id', { count: 'exact', head: true }).gte('timestamp', weekAgo.toISOString()),
        supabase.from('ai_logs').select('timestamp, query_type, user_id, is_premium')
      ]);

      if (totalErr) throw totalErr;
      if (todayErr) throw todayErr;
      if (weekErr) throw weekErr;
      if (logsErr) throw logsErr;

      const categoryBreakdown: Record<string, number> = {};
      const userCounts: Record<string, number> = {};
      const premiumVsFree = { premium: 0, free: 0 };
      
      const hourlyHeatmap = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
      const dailyTrendMap: Record<string, number> = {};
      
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        dailyTrendMap[dateStr] = 0;
      }

      if (logs) {
        for (const log of logs) {
          if (log.query_type) {
            categoryBreakdown[log.query_type] = (categoryBreakdown[log.query_type] || 0) + 1;
          }
          
          if (log.user_id) {
            userCounts[log.user_id] = (userCounts[log.user_id] || 0) + 1;
          }
          
          if (log.is_premium) {
            premiumVsFree.premium++;
          } else {
            premiumVsFree.free++;
          }
          
          if (log.timestamp) {
            const logDate = new Date(log.timestamp);
            if (logDate >= weekAgo) {
              const hour = logDate.getHours();
              hourlyHeatmap[hour].count++;
              
              const dateStr = log.timestamp.split('T')[0];
              if (dailyTrendMap[dateStr] !== undefined) {
                dailyTrendMap[dateStr]++;
              }
            }
          }
        }
      }

      const dailyTrend = Object.keys(dailyTrendMap).sort().map(date => ({
        date,
        count: dailyTrendMap[date]
      }));

      const topUsers = Object.entries(userCounts)
        .map(([user_id, count]) => ({ user_id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return res.status(200).json({
        totalQueries: totalQueries || 0,
        todayQueries: todayQueries || 0,
        weekQueries: weekQueries || 0,
        categoryBreakdown,
        hourlyHeatmap,
        dailyTrend,
        topUsers,
        premiumVsFree
      });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};
      
      if (action === 'reset') {
        const { error } = await supabase
          .from('ai_logs')
          .delete()
          .not('id', 'is', null);
          
        if (error) throw error;
        
        return res.status(200).json({ success: true, message: 'All analytics data cleared' });
      }
      
      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
