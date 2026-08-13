import { proxySpiderByteRequest } from '@/lib/spiderbyte-bff';

type RouteContext = { params: Promise<{ path: string[] }> };

export const runtime = 'nodejs';

export async function GET(request: Request, context: RouteContext) {
  return proxySpiderByteRequest(request, 'v2', context.params);
}

export async function POST(request: Request, context: RouteContext) {
  return proxySpiderByteRequest(request, 'v2', context.params);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxySpiderByteRequest(request, 'v2', context.params);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxySpiderByteRequest(request, 'v2', context.params);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxySpiderByteRequest(request, 'v2', context.params);
}
