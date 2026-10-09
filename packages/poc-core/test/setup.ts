// Tests never make live model, Vercel, Sandbox or PSI calls: any real network request fails the test.
globalThis.fetch = () => Promise.reject(new Error('tests must not make network requests'));
