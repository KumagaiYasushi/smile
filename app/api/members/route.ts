import { eventApi } from '@/lib/event-api';
export async function GET(request: Request) { return eventApi(request, store => store.members()); }
