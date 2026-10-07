import next from 'eslint-config-next';

const config = [{ ignores: ['.next/**', 'next-env.d.ts'] }, ...next];

export default config;
