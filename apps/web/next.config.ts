import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  // poc-core ships TypeScript source.
  transpilePackages: ['@v-copilot/poc-core'],
};

export default withWorkflow(nextConfig);
