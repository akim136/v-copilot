// The local World re-queues the runs a stopped dev server left pending or running only when it is started,
// and nothing else starts it. The Vercel World has no start; a deployment never runs this.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL) return;
  const { getWorld } = await import('workflow/runtime');
  const world = await getWorld();
  await world.start?.();
}
