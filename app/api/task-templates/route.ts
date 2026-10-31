import { eventApi } from '@/lib/event-api';
export async function GET(request: Request) { return eventApi(request, store => store.templates()); }
export async function POST(request: Request) { return eventApi(request, async (store, actor) => store.saveTemplate(await request.json(), actor), 201); }
