export const RESTIC_CHECK_INTERVAL_MS=5*86400000;
export function needsFullCheck(record,repositoryId,now=new Date()){const at=Date.parse(record?.last_successful_check_at);return record?.repository_id!==repositoryId||!Number.isFinite(at)||at>now.getTime()+60000||now.getTime()-at>=RESTIC_CHECK_INTERVAL_MS}
