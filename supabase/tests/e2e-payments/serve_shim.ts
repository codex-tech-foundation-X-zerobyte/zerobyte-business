export const serve = (handler: (r: Request) => Response | Promise<Response>) => Deno.serve({ port: Number(Deno.env.get('PORT')), hostname: '127.0.0.1', onListen: () => {} }, handler)
