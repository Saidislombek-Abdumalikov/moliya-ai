// Vercel schedules in UTC; Moliya's reporting day is Asia/Tashkent (UTC+5).
export function dueScheduledReports(now: Date): Array<{type:'weekly'|'monthly';startDate:string;endDate:string}> {
  const local = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const year = local.getUTCFullYear(), month = local.getUTCMonth(), day = local.getUTCDate();
  const localStart = (d: Date) => new Date(d.getTime() - 5 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.UTC(year, month, day + 1) - 1);
  const reports: Array<{type:'weekly'|'monthly';startDate:string;endDate:string}> = [];
  if (local.getUTCDay() === 0) reports.push({
    type: 'weekly',
    startDate: localStart(new Date(Date.UTC(year, month, day - 6))),
    endDate: localStart(end)
  });
  if (new Date(Date.UTC(year, month, day + 1)).getUTCDate() === 1) reports.push({
    type: 'monthly',
    startDate: localStart(new Date(Date.UTC(year, month, 1))),
    endDate: localStart(end)
  });
  return reports;
}
