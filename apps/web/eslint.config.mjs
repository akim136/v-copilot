import next from 'eslint-config-next';

const config = [{ ignores: ['.next/**', 'next-env.d.ts', 'app/.well-known/workflow/**'] }, ...next];

export default config;
